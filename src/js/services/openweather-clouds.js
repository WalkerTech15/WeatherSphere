/* OpenWeatherMap cloud cover, through the same-origin proxy
 * (api/openweather-clouds.js on Vercel, the matching middleware in
 * vite.config.js in dev). No OpenWeatherMap credential ever reaches this file:
 * the browser only knows the proxy's URL, and the proxy alone holds the key.
 *
 * The layer is raster tiles drawn by the map itself, so nothing here parses
 * cloud data — this module only says whether the layer can be offered, where
 * its tiles come from, and what a failed tile request means. */
import { WEATHER_ERROR_KINDS } from "../weather/weather-errors.js";

export const CLOUDS_ENDPOINT = "/api/openweather-clouds";
export const CLOUDS_ATTRIBUTION_URL = "https://openweathermap.org";
/* Cloud tiles are 256 px and stay useful only at world/regional scale; past
   this zoom the map stretches the last real tile instead of asking for more. */
export const CLOUDS_SOURCE_MAX_ZOOM = 9;
export const CLOUDS_TILE_TIMEOUT_MS = 12000;

/* MapLibre fetches tiles from a worker, where a relative URL has no base. */
export function cloudsTileTemplate(origin = globalThis.location?.origin ?? "") {
  return `${origin}${CLOUDS_ENDPOINT}?z={z}&x={x}&y={y}`;
}

/**
 * Whether the proxy has a key to call OpenWeatherMap with. Anything else —
 * no route (a static host, `vite dev` without the middleware), an HTML
 * fallback page, a network error — is "not available": the button stays
 * disabled rather than offering a layer that cannot load.
 * @returns {Promise<boolean>}
 */
export async function fetchCloudsAvailable({ signal, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`${CLOUDS_ENDPOINT}?status=1`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.available === true;
  } catch {
    return false;
  }
}

/* What a failed tile request means, from the proxy's own status codes:
   503 = key missing or rejected (401/403 upstream), 429 = rate limited,
   504 = the proxy's upstream timed out. Anything else is a plain failure. */
export function cloudsErrorKind(status) {
  if (status === 401 || status === 403 || status === 503) return "unavailable";
  if (status === 429) return "rate_limited";
  if (status === 504 || status === 408) return WEATHER_ERROR_KINDS.timeout;
  return status ? WEATHER_ERROR_KINDS.http : WEATHER_ERROR_KINDS.network;
}
