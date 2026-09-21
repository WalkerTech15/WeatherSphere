/* Weather caching rules in one place: which cache, how long, and how keys
 * are formed.
 *
 *   - Full forecasts: a promise cache (services/cache.js) keyed by provider
 *     and coordinates. It deduplicates in-flight requests (sidebar widget +
 *     selected city hitting the same place) and reuses a forecast for
 *     WEATHER_CACHE_TTL_MS. Failed requests are evicted so the next call
 *     retries.
 *   - Batched lists (favorites, comparison): each list remembers which set
 *     of places it last fetched and when; isBatchFresh() is the shared
 *     "same places, still fresh" check. */
import { WEATHER_CACHE_TTL_MS, FAVORITES_WEATHER_TTL_MS } from "../core/config.js";
import { createAsyncCache } from "../services/cache.js";

export const forecastCache = createAsyncCache(WEATHER_CACHE_TTL_MS);

export function forecastCacheKey(providerId, loc) {
  return `${providerId}:${loc.lat},${loc.lon}`;
}

/* Identity of a batched list: the places' ids, in order. */
export function batchKey(locs) {
  return locs.map((l) => l.id).join(",");
}

/**
 * @param {{key: string, at: number}} last what the list fetched last, and when
 * @param {string} key the batch about to be fetched
 */
export function isBatchFresh(last, key, now = Date.now(), ttlMs = FAVORITES_WEATHER_TTL_MS) {
  return key === last.key && now - last.at < ttlMs;
}

/* Test seam only. */
export function __clearWeatherCachesForTests() {
  forecastCache.clear();
}
