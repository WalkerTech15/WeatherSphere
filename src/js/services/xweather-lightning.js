/* Recent lightning near a place, through the same-origin proxy
 * (api/xweather-lightning.js on Vercel, the matching middleware in
 * vite.config.js in dev). No Xweather credential ever reaches this file. */
import {
  requestJson,
  malformed,
  WeatherError,
  WEATHER_ERROR_KINDS,
} from "../weather/weather-errors.js";

export const LIGHTNING_RADIUS_KM = 40;

/* The proxy's own failure statuses, as the kinds the panel can explain. */
const STATUS_KINDS = {
  503: WEATHER_ERROR_KINDS.unavailable,
  504: WEATHER_ERROR_KINDS.timeout,
  429: "rate_limited",
};

const isStrike = (strike) =>
  Number.isFinite(strike?.lat) &&
  Number.isFinite(strike?.lon) &&
  Math.abs(strike.lat) <= 90 &&
  Math.abs(strike.lon) <= 180;

export async function fetchXweatherLightning(loc, { signal } = {}) {
  const params = new URLSearchParams({
    lat: String(loc.lat),
    lon: String(loc.lon),
    radius: String(LIGHTNING_RADIUS_KM),
  });
  let data;
  try {
    data = await requestJson(`/api/xweather-lightning?${params}`, { signal });
  } catch (err) {
    const kind = err?.kind === WEATHER_ERROR_KINDS.http ? STATUS_KINDS[err.status] : null;
    if (kind) throw new WeatherError(kind, err.message, { status: err.status });
    throw err;
  }
  /* An HTML page (a missing route falling through to index.html) never
     parses this far; a JSON body without the strike list is still refused. */
  if (!Array.isArray(data?.strikes)) throw malformed("Malformed lightning response");
  return { ...data, strikes: data.strikes.filter(isStrike) };
}
