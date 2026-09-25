/* Xweather lightning proxy — the Vercel serverless function behind
 * /api/xweather-lightning, and (through lightningResponse) the Vite dev
 * middleware in vite.config.js. Both answer with the one contract below, so
 * the frontend has a single code path.
 *
 * Credentials: XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET are read from
 * server environment variables only — never a VITE_ variable, never a
 * response body, never a log line. The upstream URL carries them, so it is
 * never logged or echoed either.
 *
 * Upstream: GET https://data.api.xweather.com/lightning/closest?p=lat,lon
 * (the `closest` action takes its location from `p`; a location in the path
 * is answered with HTTP 200, success:false, "no_location"). Each result puts
 * the position in `loc.lat` / `loc.long` and the flash in `ob.pulse`.
 *
 * Xweather reports failures two ways, and both are mapped here:
 *   - HTTP 401 / 429 / 5xx;
 *   - HTTP 200 with `success: false` and an error code (invalid_client,
 *     maxhits_min, …). `success: true` with `warn_no_data` is a valid, empty
 *     answer — "no strikes nearby", never an error.
 * https://www.xweather.com/docs/weather-api/getting-started/responses
 */
const ENDPOINT = "https://data.api.xweather.com/lightning/closest";
const SOURCE = "https://www.xweather.com/docs/weather-api/endpoints/lightning";
const TIMEOUT_MS = 8000;
/* The standard endpoint's maximum radius is 100 km. */
const MAX_RADIUS_KM = 100;
const DEFAULT_RADIUS_KM = 40;
const MAX_STRIKES = 1000;
const SUCCESS_CACHE = "public, max-age=30, stale-while-revalidate=60";

const AUTH_CODES = new Set(["invalid_client", "unauthorized_namespace", "insufficient_scope"]);
const RATE_CODES = new Set(["maxhits", "maxhits_min", "maxhits_daily"]);

function number(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function reply(status, body, headers = {}) {
  return {
    status,
    body,
    headers: { "Cache-Control": status === 200 ? SUCCESS_CACHE : "no-store", ...headers },
  };
}

/* The browser is not the party that is unauthorized: a rejected credential is
   a server configuration problem, so it is reported as "unavailable". */
const unavailable = () => reply(503, { error: "unavailable" });
const rateLimited = () => reply(429, { error: "rate_limited" }, { "Retry-After": "60" });
const upstreamError = () => reply(502, { error: "upstream_error" });
const timedOut = () => reply(504, { error: "timeout" });

const isTimeout = (error) => error?.name === "TimeoutError" || error?.name === "AbortError";

/* One upstream result → the browser's strike shape, or null when it has no
   usable position. Only these fields ever reach the browser. */
export function toStrike(item) {
  const lat = number(item?.loc?.lat, -90, 90);
  const lon = number(item?.loc?.long ?? item?.loc?.lon, -180, 180);
  if (lat === null || lon === null) return null;
  const pulse = item?.ob?.pulse;
  return {
    lat,
    lon,
    type: typeof pulse?.type === "string" ? pulse.type.toLowerCase().slice(0, 8) : "",
    amperage: Number.isFinite(pulse?.peakamp) ? pulse.peakamp : null,
  };
}

/**
 * Validates the query, calls Xweather and maps every outcome onto
 * `{ status, headers, body }`. It never throws.
 * @param {Record<string, unknown>} query lat, lon, optional radius (km)
 * @param {{clientId?: string, clientSecret?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 */
export async function lightningResponse(query, options = {}) {
  const { clientId, clientSecret, fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const lat = number(query?.lat, -90, 90);
  const lon = number(query?.lon, -180, 180);
  if (lat === null || lon === null) return reply(400, { error: "invalid_coordinates" });
  const radius = number(query?.radius, 1, MAX_RADIUS_KM) ?? DEFAULT_RADIUS_KM;
  if (!clientId || !clientSecret) return unavailable();

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    p: `${lat},${lon}`,
    radius: `${radius}km`,
    limit: String(MAX_STRIKES),
    client_id: clientId,
    client_secret: clientSecret,
  });

  let upstream;
  try {
    upstream = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return isTimeout(error) ? timedOut() : upstreamError();
  }
  if (upstream.status === 401 || upstream.status === 403) return unavailable();
  if (upstream.status === 429) return rateLimited();
  if (!upstream.ok) return upstreamError();

  let payload;
  try {
    payload = await upstream.json();
  } catch (error) {
    return isTimeout(error) ? timedOut() : upstreamError();
  }

  const code = typeof payload?.error?.code === "string" ? payload.error.code : "";
  if (payload?.success === false) {
    if (AUTH_CODES.has(code)) return unavailable();
    if (RATE_CODES.has(code)) return rateLimited();
    return upstreamError();
  }
  if (payload?.success !== true || !Array.isArray(payload.response)) return upstreamError();

  const strikes = payload.response.map(toStrike).filter(Boolean).slice(0, MAX_STRIKES);
  return reply(200, {
    provider: "Xweather",
    source: SOURCE,
    updatedAt: new Date().toISOString(),
    radiusKm: radius,
    strikes,
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const result = await lightningResponse(req.query, {
    clientId: process.env.XWEATHER_CLIENT_ID,
    clientSecret: process.env.XWEATHER_CLIENT_SECRET,
  });
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  return res.status(result.status).json(result.body);
}
