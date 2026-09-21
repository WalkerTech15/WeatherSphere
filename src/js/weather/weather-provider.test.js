/* The provider boundary: one active provider, both providers exposing the
 * same interface, forecast caching, and the school-API placeholder staying
 * inert. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  WEATHER_PROVIDERS,
  ACTIVE_PROVIDER_ID,
  getActiveProvider,
  fetchForecast,
  fetchCurrentBatch,
  fetchAirQuality,
} from "./weather-provider.js";
import * as openMeteo from "./providers/open-meteo.js";
import * as schoolApi from "./providers/school-api.js";
import { __clearWeatherCachesForTests } from "./weather-cache.js";
import { forecastPayload, batchEntry, aqiEntry } from "./open-meteo.fixtures.js";

const PARIS = { lat: 48.8566, lon: 2.3522 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const originalFetch = globalThis.fetch;

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url) => {
    calls.push(String(url));
    return handler(String(url));
  });
  return calls;
}

const forecastCalls = (calls) => calls.filter((u) => !u.includes("air-quality"));

beforeEach(() => __clearWeatherCachesForTests());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider registry", () => {
  it("keeps Open-Meteo as the active provider", () => {
    expect(ACTIVE_PROVIDER_ID).toBe("open-meteo");
    expect(getActiveProvider()).toBe(openMeteo);
  });

  it("registers both providers under their own ids", () => {
    expect(Object.keys(WEATHER_PROVIDERS)).toEqual(["open-meteo", "school-api"]);
  });

  it("gives every provider the same interface", () => {
    for (const provider of Object.values(WEATHER_PROVIDERS)) {
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.available).toBe("boolean");
      expect(typeof provider.fetchForecast).toBe("function");
      expect(typeof provider.fetchCurrentBatch).toBe("function");
      expect(typeof provider.fetchAirQuality).toBe("function");
    }
  });
});

describe("school API placeholder", () => {
  it("is marked unavailable and is not the active provider", () => {
    expect(schoolApi.available).toBe(false);
    expect(getActiveProvider()).not.toBe(schoolApi);
  });

  it("rejects every call as unavailable without touching the network", async () => {
    globalThis.fetch = vi.fn();
    await expect(schoolApi.fetchForecast(PARIS)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(schoolApi.fetchCurrentBatch([PARIS], "favorites")).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(schoolApi.fetchAirQuality([PARIS])).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("fetchForecast", () => {
  const respond = (url) => (url.includes("air-quality") ? ok(aqiEntry(30)) : ok(forecastPayload()));

  it("serves a second request for the same coordinates from the cache", async () => {
    const calls = stubFetch(respond);
    const first = await fetchForecast(PARIS);
    const second = await fetchForecast({ ...PARIS, id: "other-id" });
    expect(second).toBe(first);
    expect(forecastCalls(calls)).toHaveLength(1);
  });

  it("deduplicates concurrent requests for the same coordinates", async () => {
    const calls = stubFetch(respond);
    const [a, b] = await Promise.all([fetchForecast(PARIS), fetchForecast(PARIS)]);
    expect(a).toBe(b);
    expect(forecastCalls(calls)).toHaveLength(1);
  });

  it("keeps different coordinates apart", async () => {
    const calls = stubFetch(respond);
    await fetchForecast(PARIS);
    await fetchForecast(TOKYO);
    expect(forecastCalls(calls)).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const calls = stubFetch((url) => {
      if (url.includes("air-quality")) return ok(aqiEntry(1));
      return fail ? { ok: false, status: 500 } : ok(forecastPayload());
    });
    await expect(fetchForecast(PARIS)).rejects.toMatchObject({ kind: "http" });
    fail = false;
    await expect(fetchForecast(PARIS)).resolves.toHaveProperty("current");
    expect(forecastCalls(calls)).toHaveLength(2);
  });
});

describe("batched requests", () => {
  it("forwards current-conditions batches to the active provider", async () => {
    const calls = stubFetch(() => ok([batchEntry(20), batchEntry(30)]));
    const out = await fetchCurrentBatch([PARIS, TOKYO], "popular");
    expect(calls).toHaveLength(1);
    expect(out.map((s) => s.temp)).toEqual([20, 30]);
  });

  it("forwards air-quality batches to the active provider", async () => {
    const calls = stubFetch(() => ok([aqiEntry(5), aqiEntry(6)]));
    await expect(fetchAirQuality([PARIS, TOKYO])).resolves.toEqual([5, 6]);
    expect(calls).toHaveLength(1);
  });

  it("does not cache batches — callers own their own freshness rules", async () => {
    const calls = stubFetch(() => ok([batchEntry(20)]));
    await fetchCurrentBatch([PARIS], "nearby");
    await fetchCurrentBatch([PARIS], "nearby");
    expect(calls).toHaveLength(2);
  });
});

describe("fetchForecast cancellation", () => {
  /* fetch that answers only when the test says so, and rejects when its
     signal aborts — the way a real fetch does */
  function controlledFetch() {
    const pending = [];
    globalThis.fetch = vi.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          pending.push({ url: String(url), signal, resolve });
        }),
    );
    return pending;
  }

  it("cancels both the forecast and its air-quality request when the only caller leaves", async () => {
    const pending = controlledFetch();
    const controller = new AbortController();
    const request = fetchForecast(PARIS, { signal: controller.signal });
    expect(pending).toHaveLength(2);
    controller.abort();
    await expect(request).rejects.toMatchObject({ kind: "aborted" });
    expect(pending.every((p) => p.signal.aborted)).toBe(true);
  });

  it("keeps the request alive for a second caller when the first leaves", async () => {
    const pending = controlledFetch();
    const first = new AbortController();
    const a = fetchForecast(PARIS, { signal: first.signal });
    const b = fetchForecast(PARIS, { signal: new AbortController().signal });
    expect(forecastCalls(pending.map((p) => p.url))).toHaveLength(1);
    first.abort();
    await expect(a).rejects.toMatchObject({ kind: "aborted" });
    for (const p of pending) {
      p.resolve(ok(p.url.includes("air-quality") ? aqiEntry(12) : forecastPayload()));
    }
    const wx = await b;
    expect(wx.current.temp).toBe(18.4);
    await expect(wx._aqi).resolves.toBe(12);
  });

  it("starts a fresh request for the same place after a cancelled one", async () => {
    const pending = controlledFetch();
    const controller = new AbortController();
    const a = fetchForecast(PARIS, { signal: controller.signal });
    controller.abort();
    await a.catch(() => {});
    fetchForecast(PARIS);
    expect(forecastCalls(pending.map((p) => p.url))).toHaveLength(2);
  });
});

describe("the school API cannot be reached through the app entry points", () => {
  it("routes every entry point to Open-Meteo", async () => {
    const calls = stubFetch((url) =>
      url.includes("air-quality") ? ok([aqiEntry(1)]) : ok(forecastPayload()),
    );
    await fetchForecast(PARIS);
    expect(calls.every((u) => u.includes("open-meteo.com"))).toBe(true);
  });
});
