/* The app's single entry point for weather data.
 *
 * Callers never import a provider directly: they ask this module, which
 * forwards to the active provider and applies the shared forecast cache.
 * Every provider module exposes the same interface (see
 * providers/open-meteo.js).
 *
 * Open-Meteo is the only live provider. The Settings card shows it as the
 * current source and the school API as "coming soon"; there is no runtime
 * switch, so the active provider is fixed here. */
import * as openMeteo from "./providers/open-meteo.js";
import * as schoolApi from "./providers/school-api.js";
import {
  forecastCache,
  forecastCacheKey,
  airQualityDetailCache,
  airQualityDetailCacheKey,
} from "./weather-cache.js";

export const WEATHER_PROVIDERS = Object.freeze({
  [openMeteo.id]: openMeteo,
  [schoolApi.id]: schoolApi,
});

export const ACTIVE_PROVIDER_ID = openMeteo.id;

export function getActiveProvider() {
  return WEATHER_PROVIDERS[ACTIVE_PROVIDER_ID];
}

/**
 * Full forecast for one place, cached and shared per provider + coordinates.
 * @param {{signal?: AbortSignal}} [options] aborting stops this caller
 *   waiting (rejects with kind "aborted"); the request itself is cancelled
 *   only when no other caller still wants it.
 */
export function fetchForecast(loc, { signal } = {}) {
  const provider = getActiveProvider();
  return forecastCache.get(
    forecastCacheKey(provider.id, loc),
    (requestSignal) => provider.fetchForecast(loc, { signal: requestSignal }),
    signal,
  );
}

/**
 * Current conditions for several places in one request.
 * @param {Array<{lat:number, lon:number}>} locs
 * @param {"favorites"|"popular"|"nearby"|"comparison"} query which fields to ask for
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<Array<object|null>>} one snapshot per place, in order
 */
export function fetchCurrentBatch(locs, query, options) {
  return getActiveProvider().fetchCurrentBatch(locs, query, options);
}

/* European AQI per place, in order (null where unknown). */
export function fetchAirQuality(locs, options) {
  return getActiveProvider().fetchAirQuality(locs, options);
}

/**
 * The Air Quality map layer's own reading for one place — the richer,
 * multi-pollutant request, cached and shared separately from
 * fetchForecast()'s single-value `_aqi` (see weather-cache.js).
 * @param {{signal?: AbortSignal}} [options] same cancellation contract as
 *   fetchForecast(): a caller's own signal only detaches that caller.
 */
export function fetchAirQualityDetail(loc, { signal } = {}) {
  const provider = getActiveProvider();
  return airQualityDetailCache.get(
    airQualityDetailCacheKey(provider.id, loc),
    (requestSignal) => provider.fetchAirQualityDetail(loc, { signal: requestSignal }),
    signal,
  );
}
