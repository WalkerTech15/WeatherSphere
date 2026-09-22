import { describe, it, expect, vi } from "vitest";
import { FAVORITES_WEATHER_TTL_MS, WEATHER_CACHE_TTL_MS } from "../core/config.js";
import {
  forecastCache,
  forecastCacheKey,
  airQualityDetailCache,
  airQualityDetailCacheKey,
  batchKey,
  isBatchFresh,
  createSharedRequestCache,
  createBatchLoader,
} from "./weather-cache.js";

describe("cache keys", () => {
  it("keys a forecast by provider and coordinates, not by place id", () => {
    expect(forecastCacheKey("open-meteo", { lat: 1.5, lon: -2, id: "a" })).toBe(
      "open-meteo:1.5,-2",
    );
    expect(forecastCacheKey("open-meteo", { lat: 1.5, lon: -2, id: "b" })).toBe(
      forecastCacheKey("open-meteo", { lat: 1.5, lon: -2, id: "a" }),
    );
  });

  it("separates providers so one never serves another's data", () => {
    const loc = { lat: 1, lon: 2 };
    expect(forecastCacheKey("open-meteo", loc)).not.toBe(forecastCacheKey("school-api", loc));
  });

  it("identifies a batch by its ids, in order", () => {
    expect(batchKey([{ id: "paris" }, { id: "tokyo" }])).toBe("paris,tokyo");
    expect(batchKey([{ id: "tokyo" }, { id: "paris" }])).toBe("tokyo,paris");
    expect(batchKey([])).toBe("");
  });
});

describe("isBatchFresh", () => {
  const last = { key: "paris,tokyo", at: 1_000_000 };

  it("is fresh for the same batch inside the TTL", () => {
    expect(isBatchFresh(last, "paris,tokyo", last.at + FAVORITES_WEATHER_TTL_MS - 1)).toBe(true);
  });

  it("is stale at and after the TTL", () => {
    expect(isBatchFresh(last, "paris,tokyo", last.at + FAVORITES_WEATHER_TTL_MS)).toBe(false);
  });

  it("is stale for a different batch even inside the TTL", () => {
    expect(isBatchFresh(last, "paris", last.at + 1)).toBe(false);
  });

  it("is stale before anything has been fetched", () => {
    expect(isBatchFresh({ key: "", at: 0 }, "paris", 10)).toBe(false);
  });
});

describe("forecast cache", () => {
  it("uses the shared weather TTL and dedups by key", async () => {
    forecastCache.clear();
    let calls = 0;
    const factory = () => Promise.resolve(++calls);
    await forecastCache.get("k", factory);
    await forecastCache.get("k", factory);
    expect(calls).toBe(1);
    expect(WEATHER_CACHE_TTL_MS).toBe(5 * 60000);
  });
});

describe("air quality detail cache", () => {
  it("keys by provider and coordinates, same shape as the forecast cache", () => {
    expect(airQualityDetailCacheKey("open-meteo", { lat: 1.5, lon: -2 })).toBe("open-meteo:1.5,-2");
  });

  it("is a separate cache instance from the forecast cache", () => {
    expect(airQualityDetailCache).not.toBe(forecastCache);
  });

  it("dedups by key and is never populated by a forecast request for the same key", async () => {
    airQualityDetailCache.clear();
    forecastCache.clear();
    const key = airQualityDetailCacheKey("open-meteo", { lat: 1, lon: 2 });
    let calls = 0;
    await airQualityDetailCache.get(key, () => Promise.resolve(++calls));
    await airQualityDetailCache.get(key, () => Promise.resolve(++calls));
    expect(calls).toBe(1);
    expect(forecastCache.has(key)).toBe(false);
  });
});

/* A request the test resolves or rejects by hand, recording the signal the
   cache handed to the factory. */
function deferredRequest() {
  const out = { calls: 0, signals: [] };
  out.factory = (signal) => {
    out.calls++;
    out.signals.push(signal);
    return new Promise((resolve, reject) => {
      out.resolve = resolve;
      out.reject = reject;
    });
  };
  return out;
}

describe("createSharedRequestCache", () => {
  it("shares one request between concurrent callers", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const a = cache.get("k", req.factory);
    const b = cache.get("k", req.factory, new AbortController().signal);
    req.resolve("wx");
    await expect(a).resolves.toBe("wx");
    await expect(b).resolves.toBe("wx");
    expect(req.calls).toBe(1);
  });

  it("reuses a settled result within the TTL and refetches after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const cache = createSharedRequestCache(1000);
      let calls = 0;
      const factory = () => Promise.resolve(++calls);
      await cache.get("k", factory);
      await cache.get("k", factory, new AbortController().signal);
      expect(calls).toBe(1);
      vi.setSystemTime(Date.now() + 1000);
      await cache.get("k", factory);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets a failed request so the next caller retries", async () => {
    const cache = createSharedRequestCache(60_000);
    let calls = 0;
    const factory = () =>
      ++calls === 1 ? Promise.reject(new Error("down")) : Promise.resolve("ok");
    await expect(cache.get("k", factory)).rejects.toThrow("down");
    await expect(cache.get("k", factory)).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("detaches only the caller that cancels while others keep waiting", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const leaving = new AbortController();
    const a = cache.get("k", req.factory, leaving.signal);
    const b = cache.get("k", req.factory, new AbortController().signal);
    leaving.abort();
    await expect(a).rejects.toMatchObject({ kind: "aborted" });
    expect(req.signals[0].aborted).toBe(false);
    req.resolve("wx");
    await expect(b).resolves.toBe("wx");
  });

  it("aborts and forgets the request once every caller has cancelled", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const one = new AbortController();
    const two = new AbortController();
    const a = cache.get("k", req.factory, one.signal);
    const b = cache.get("k", req.factory, two.signal);
    one.abort();
    expect(req.signals[0].aborted).toBe(false);
    two.abort();
    expect(req.signals[0].aborted).toBe(true);
    await expect(a).rejects.toMatchObject({ kind: "aborted" });
    await expect(b).rejects.toMatchObject({ kind: "aborted" });
    expect(cache.has("k")).toBe(false);
    /* the next caller starts a fresh request instead of joining a dead one */
    cache.get("k", req.factory);
    expect(req.calls).toBe(2);
  });

  it("never cancels a request a caller without a signal is waiting for", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const pinned = cache.get("k", req.factory);
    const leaving = new AbortController();
    const a = cache.get("k", req.factory, leaving.signal);
    leaving.abort();
    await expect(a).rejects.toMatchObject({ kind: "aborted" });
    expect(req.signals[0].aborted).toBe(false);
    req.resolve("wx");
    await expect(pinned).resolves.toBe("wx");
  });

  it("rejects straight away for an already-cancelled signal without starting a request", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const done = new AbortController();
    done.abort();
    await expect(cache.get("k", req.factory, done.signal)).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(req.calls).toBe(0);
  });

  it("ignores a cancellation that arrives after the result", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const late = new AbortController();
    const a = cache.get("k", req.factory, late.signal);
    req.resolve("wx");
    await expect(a).resolves.toBe("wx");
    late.abort();
    expect(req.signals[0].aborted).toBe(false);
    expect(cache.has("k")).toBe(true);
  });

  it("passes a request failure through to a caller with a signal", async () => {
    const cache = createSharedRequestCache(60_000);
    const req = deferredRequest();
    const a = cache.get("k", req.factory, new AbortController().signal);
    req.reject(Object.assign(new Error("HTTP 500"), { kind: "http" }));
    await expect(a).rejects.toMatchObject({ kind: "http" });
  });
});

describe("createBatchLoader", () => {
  const later = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };

  it("joins the load already in flight for the same batch", async () => {
    const load = createBatchLoader();
    const gate = later();
    const task = vi.fn(async () => {
      await gate.promise;
      return "done";
    });
    const a = load("paris,tokyo", true, task);
    const b = load("paris,tokyo", false, task);
    expect(b).toBe(a);
    gate.resolve();
    await expect(b).resolves.toBe("done");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("starts again once the previous load has finished", async () => {
    const load = createBatchLoader();
    const task = vi.fn(async () => "done");
    await load("k", false, task);
    await load("k", false, task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("cancels the older load when a different batch is requested", async () => {
    const load = createBatchLoader();
    const signals = [];
    const gate = later();
    const older = load("paris", false, async (isStale, signal) => {
      signals.push(signal);
      await gate.promise;
      return isStale() ? "stale" : "paris";
    });
    const newer = load("paris,tokyo", false, async () => "paris,tokyo");
    expect(signals[0].aborted).toBe(true);
    gate.resolve();
    await expect(newer).resolves.toBe("paris,tokyo");
    await expect(older).resolves.toBeNull();
  });

  it("a forced call replaces an in-flight load of the same batch", async () => {
    const load = createBatchLoader();
    const signals = [];
    const task = vi.fn(async (isStale, signal) => {
      signals.push(signal);
      return "x";
    });
    const first = load("k", false, task);
    const second = load("k", true, task);
    expect(second).not.toBe(first);
    expect(signals[0].aborted).toBe(true);
    await second;
    expect(task).toHaveBeenCalledTimes(2);
  });
});
