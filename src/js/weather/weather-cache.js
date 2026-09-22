/* Weather caching rules in one place: which cache, how long, and how keys
 * are formed.
 *
 *   - Full forecasts: a shared-request cache keyed by provider and
 *     coordinates. Callers asking for the same place share ONE request
 *     (sidebar widget + selected city hitting the same place), and a
 *     forecast is reused for WEATHER_CACHE_TTL_MS. Failed requests are
 *     evicted so the next call retries. A caller may pass an AbortSignal to
 *     stop waiting; the request itself is only cancelled once nobody is
 *     waiting for it any more.
 *   - Batched lists (favorites, comparison): each list remembers which set
 *     of places it last fetched and when; isBatchFresh() is the shared
 *     "same places, still fresh" check. */
import { WEATHER_CACHE_TTL_MS, FAVORITES_WEATHER_TTL_MS } from "../core/config.js";
import { createLatestOnly } from "../core/latest-only.js";
import { abortedError } from "./weather-errors.js";

/**
 * A TTL cache of requests that several callers can share and cancel.
 *
 * `get(key, factory, signal)` returns the cached request for `key`, or starts
 * `factory(requestSignal)`. Each caller's `signal` only detaches THAT caller
 * (its promise rejects with an "aborted" WeatherError). The shared request is
 * aborted — and forgotten, so the next caller starts fresh — only when every
 * caller has detached. A caller with no signal can never be detached, so the
 * request always finishes for it.
 */
export function createSharedRequestCache(ttlMs) {
  const entries = new Map();

  function start(key, factory) {
    const controller = new AbortController();
    const entry = { at: Date.now(), controller, waiting: 0, pinned: false, settled: false };
    entry.promise = factory(controller.signal);
    entry.promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    entries.set(key, entry);
    return entry;
  }

  function detach(key, entry, signal) {
    entry.waiting++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        done = true;
        entry.waiting--;
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (done) return;
        finish();
        if (entry.waiting === 0 && !entry.pinned && !entry.settled) {
          entry.controller.abort();
          if (entries.get(key) === entry) entries.delete(key);
        }
        reject(abortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => {
          if (done) return;
          finish();
          resolve(value);
        },
        (err) => {
          if (done) return;
          finish();
          reject(err);
        },
      );
    });
  }

  return {
    get(key, factory, signal) {
      if (signal?.aborted) return Promise.reject(abortedError());
      let entry = entries.get(key);
      if (!entry || Date.now() - entry.at >= ttlMs) entry = start(key, factory);
      if (entry.settled) return entry.promise;
      if (!signal) {
        entry.pinned = true;
        return entry.promise;
      }
      return detach(key, entry, signal);
    },
    /** Whether a request for `key` is cached or in flight (tests/diagnostics). */
    has(key) {
      return entries.has(key);
    },
    clear() {
      entries.clear();
    },
  };
}

export const forecastCache = createSharedRequestCache(WEATHER_CACHE_TTL_MS);

export function forecastCacheKey(providerId, loc) {
  return `${providerId}:${loc.lat},${loc.lon}`;
}

/* The Air Quality map layer's own cache — deliberately separate from
   forecastCache (a different key space, a different Map instance), so an
   Air Quality request is never confused with, and never evicts or is
   evicted by, an ordinary forecast for the same coordinates. Same TTL and
   sharing/cancellation behaviour as forecasts: re-selecting the still-fresh
   place while switching layers back and forth reuses the one request. */
export const airQualityDetailCache = createSharedRequestCache(WEATHER_CACHE_TTL_MS);

export function airQualityDetailCacheKey(providerId, loc) {
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

/**
 * One loader per batched list (favorites, comparison).
 *
 * `load(key, force, task)` runs `task(isStale, signal)` — see
 * core/latest-only.js. A non-forced call for the batch that is already
 * loading joins that load instead of sending the same request again. Any
 * other call supersedes it: the older load is aborted and can no longer
 * write its result, so an older answer never overwrites a newer list.
 */
export function createBatchLoader() {
  const runLatest = createLatestOnly();
  let pending = null; // { key, promise } for the load in flight
  return function load(key, force, task) {
    if (!force && pending?.key === key) return pending.promise;
    const promise = runLatest(task);
    pending = { key, promise };
    const clear = () => {
      if (pending?.promise === promise) pending = null;
    };
    promise.then(clear, clear);
    return promise;
  };
}

/* Test seam only. */
export function __clearWeatherCachesForTests() {
  forecastCache.clear();
  airQualityDetailCache.clear();
}
