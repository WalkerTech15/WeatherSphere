/* OpenWeatherMap cloud-tile proxy — the Vercel serverless function behind
 * /api/openweather-clouds, and (through cloudsResponse) the Vite dev
 * middleware in vite.config.js. Both answer with the one contract below, so
 * the frontend has a single code path.
 *
 * Credential: OPENWEATHER_API_KEY is read from a server environment variable
 * only — never a VITE_ variable, never a response body, never a log line.
 * OpenWeatherMap takes the key as an `appid` query parameter, so the upstream
 * URL is never logged or echoed either.
 *
 * Two request shapes, both GET:
 *   ?z=&x=&y=   one PNG tile from the official `clouds_new` layer
 *   ?status=1   { available: boolean } — whether the key is configured, so the
 *               browser can keep the Clouds button disabled without ever
 *               seeing the key. It makes no upstream request.
 *
 * Upstream: https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png
 * https://openweathermap.org/api/weathermaps
 */
const ENDPOINT = "https://tile.openweathermap.org/map/clouds_new";
const TIMEOUT_MS = 8000;
/* The Weather Maps documentation does not state a maximum zoom. Slippy-map
   tiles stop being useful long before 12, and the cap also bounds what an
   anonymous caller can make this proxy request. */
export const MAX_TILE_ZOOM = 12;
/* Cloud cover is a satellite/model composite refreshed every few minutes. */
const TILE_CACHE = "public, max-age=600, stale-while-revalidate=300";
const MAX_TILE_BYTES = 512 * 1024;

const DIGITS = /^(0|[1-9][0-9]{0,7})$/;

function integer(value) {
  return typeof value === "string" && DIGITS.test(value) ? Number(value) : null;
}

/**
 * Strict z/x/y check: plain non-negative decimal integers, z within the
 * supported range, x and y inside the 2^z grid. Anything else — "1e2", "-1",
 * "0x1", "3.5", " 3", arrays from a repeated parameter — is refused.
 * @returns {{z: number, x: number, y: number} | null}
 */
export function parseTile(query) {
  const z = integer(query?.z);
  const x = integer(query?.x);
  const y = integer(query?.y);
  if (z === null || x === null || y === null || z > MAX_TILE_ZOOM) return null;
  const size = 2 ** z;
  return x < size && y < size ? { z, x, y } : null;
}

/* The upstream URL for a validated tile. Built from numbers only, so no query
   text is ever interpolated into it. */
export function tileUrl({ z, x, y }, apiKey) {
  const url = new URL(`${ENDPOINT}/${z}/${x}/${y}.png`);
  url.searchParams.set("appid", apiKey);
  return url;
}

function json(status, body, headers = {}) {
  return { status, body, json: true, headers: { "Cache-Control": "no-store", ...headers } };
}

/* A rejected key is a server configuration problem, not the browser's:
   reported as "unavailable" (503), never as an auth failure the visitor could
   act on. */
const unavailable = () => json(503, { error: "unavailable" });
const rateLimited = () => json(429, { error: "rate_limited" }, { "Retry-After": "60" });
const upstreamError = () => json(502, { error: "upstream_error" });
const timedOut = () => json(504, { error: "timeout" });

const isTimeout = (error) => error?.name === "TimeoutError" || error?.name === "AbortError";

/**
 * Validates the request, calls OpenWeatherMap and maps every outcome onto
 * `{ status, headers, body, json }`. `body` is a Buffer for a tile and a plain
 * object when `json` is true. It never throws.
 * @param {Record<string, unknown>} query z, x, y — or status=1
 * @param {{apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 */
export async function cloudsResponse(query, options = {}) {
  const { apiKey, fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;

  if (query?.status === "1") {
    return json(200, { available: Boolean(apiKey) }, { "Cache-Control": "public, max-age=60" });
  }
  const tile = parseTile(query);
  if (!tile) return json(400, { error: "invalid_tile" });
  if (!apiKey) return unavailable();

  let upstream;
  try {
    upstream = await fetchImpl(tileUrl(tile, apiKey), {
      headers: { Accept: "image/png" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return isTimeout(error) ? timedOut() : upstreamError();
  }
  if (upstream.status === 401 || upstream.status === 403) return unavailable();
  if (upstream.status === 429) return rateLimited();
  if (!upstream.ok) return upstreamError();

  let bytes;
  try {
    bytes = Buffer.from(await upstream.arrayBuffer());
  } catch (error) {
    return isTimeout(error) ? timedOut() : upstreamError();
  }
  /* Only a PNG leaves here — an HTML or JSON body from a misbehaving upstream
     is never relayed to the browser as an image. */
  const isPng = bytes.length > 8 && bytes.subarray(1, 4).toString("latin1") === "PNG";
  if (!isPng || bytes.length > MAX_TILE_BYTES) return upstreamError();

  return {
    status: 200,
    body: bytes,
    json: false,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": TILE_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const result = await cloudsResponse(req.query, { apiKey: process.env.OPENWEATHER_API_KEY });
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  return result.json
    ? res.status(result.status).json(result.body)
    : res.status(result.status).send(result.body);
}
