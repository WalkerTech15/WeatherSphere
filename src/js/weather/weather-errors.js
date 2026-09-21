/* Request transport and failure classification for weather providers.
 *
 * Every provider request goes through requestJson(), so the timeout, the
 * HTTP-status check and the "body is not JSON" check exist once. A failure
 * always rejects with a WeatherError whose `kind` says what went wrong.
 * What to DO about a failure (demo data, a blank row, an error notice) stays
 * with each caller — this module only reports it. */
import { FETCH_TIMEOUT_MS } from "../core/config.js";
import { isOffline } from "../services/offline.js";

export const WEATHER_ERROR_KINDS = Object.freeze({
  timeout: "timeout",
  offline: "offline",
  network: "network",
  http: "http",
  malformed: "malformed",
  unavailable: "unavailable",
});

export class WeatherError extends Error {
  constructor(kind, message, { status = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WeatherError";
    this.kind = kind;
    this.status = status;
  }
}

export const isWeatherError = (err) => err instanceof WeatherError;

/* Maps whatever fetch() threw onto a WeatherError. An abort from a timeout
   signal surfaces as "TimeoutError" (or "AbortError" in older engines). */
export function classifyFetchError(err) {
  if (isWeatherError(err)) return err;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new WeatherError(WEATHER_ERROR_KINDS.timeout, "Request timed out", { cause: err });
  }
  if (isOffline()) {
    return new WeatherError(WEATHER_ERROR_KINDS.offline, "Offline", { cause: err });
  }
  return new WeatherError(WEATHER_ERROR_KINDS.network, "Network error", { cause: err });
}

export function malformed(message = "Malformed response") {
  return new WeatherError(WEATHER_ERROR_KINDS.malformed, message);
}

export function unavailable(providerId) {
  return new WeatherError(WEATHER_ERROR_KINDS.unavailable, `${providerId} is not available`);
}

/**
 * GET a URL and parse its JSON body.
 * @param {URL|string} url
 * @param {{signal?: AbortSignal}} [options] a caller-owned signal (e.g. one
 *   timeout shared by two requests); defaults to a fresh FETCH_TIMEOUT_MS one.
 */
export async function requestJson(url, { signal } = {}) {
  let res;
  try {
    res = await fetch(url, { signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    throw classifyFetchError(err);
  }
  if (!res.ok) {
    throw new WeatherError(WEATHER_ERROR_KINDS.http, "HTTP " + res.status, {
      status: res.status,
    });
  }
  try {
    return await res.json();
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw classifyFetchError(err);
    throw malformed();
  }
}
