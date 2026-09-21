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
  /* the caller cancelled (a newer selection replaced this one) — not a failure */
  aborted: "aborted",
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

export function abortedError() {
  return new WeatherError(WEATHER_ERROR_KINDS.aborted, "Request cancelled");
}

/* A signal that aborts as soon as any of `signals` does, carrying that
   signal's reason. AbortSignal.any() where the browser has it; a small
   listener-based stand-in otherwise (Safari < 17.4, Firefox < 124). */
export function anySignal(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

const isTimeoutReason = (reason) => reason?.name === "TimeoutError";

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
 * GET a URL and parse its JSON body. Every request gets its own
 * FETCH_TIMEOUT_MS timeout; a caller signal is combined with it, so the
 * request stops at whichever comes first.
 * @param {URL|string} url
 * @param {{signal?: AbortSignal}} [options] a caller-owned signal — a
 *   cancellation (rejects with kind "aborted") or a timeout shared by
 *   several requests (rejects with kind "timeout").
 */
export async function requestJson(url, { signal } = {}) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? anySignal([signal, timeout]) : timeout;
  /* A cancellation is reported as such, never as a timeout or a network
     failure — callers skip their fallback for it. */
  const toError = (err) =>
    signal?.aborted && !isTimeoutReason(signal.reason) ? abortedError() : classifyFetchError(err);

  let res;
  try {
    res = await fetch(url, { signal: combined });
  } catch (err) {
    throw toError(err);
  }
  if (!res.ok) {
    throw new WeatherError(WEATHER_ERROR_KINDS.http, "HTTP " + res.status, {
      status: res.status,
    });
  }
  try {
    return await res.json();
  } catch (err) {
    if (combined.aborted || err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw toError(err);
    }
    throw malformed();
  }
}
