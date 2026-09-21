import { describe, it, expect } from "vitest";
import { FAVORITES_WEATHER_TTL_MS, WEATHER_CACHE_TTL_MS } from "../core/config.js";
import { forecastCache, forecastCacheKey, batchKey, isBatchFresh } from "./weather-cache.js";

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
