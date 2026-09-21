/* Favorites' batched weather: live values, demo fallback on any failure, and
 * the freshness rule that avoids refetching the same list. */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";

vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-home.js", () => ({ renderHero: vi.fn() }));
vi.mock("../ui/render-favorites.js", () => ({ renderFavorites: vi.fn() }));
vi.mock("../ui/render-comparison.js", () => ({ refreshComparison: vi.fn() }));

import { state } from "../core/state.js";
import { FAVORITES_WEATHER_TTL_MS } from "../core/config.js";
import { demoWeather } from "../weather/weather-demo.js";
import { batchEntry } from "../weather/open-meteo.fixtures.js";
import { renderFavorites } from "../ui/render-favorites.js";
import * as favorites from "./favorites.js";

const PARIS = { id: "paris", lat: 48.8566, lon: 2.3522, name: { en: "Paris" } };
const TOKYO = { id: "tokyo", lat: 35.6762, lon: 139.6503, name: { en: "Tokyo" } };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:34:00Z"));
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
});
afterAll(() => {
  vi.useRealTimers();
  globalThis.localStorage = originalStorage;
});
beforeEach(() => {
  state.favorites = [PARIS, TOKYO];
  renderFavorites.mockClear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function expectedDemo(loc) {
  const w = demoWeather(loc);
  return {
    temp: w.current.temp,
    code: w.current.code,
    isDay: w.current.isDay,
    humidity: w.current.humidity,
    wind: w.current.windSpeed,
    hi: w.daily[0].hi,
    lo: w.daily[0].lo,
  };
}

describe("loadFavWeather", () => {
  it("stores live values per favorite from one batched request", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await favorites.loadFavWeather(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain(
      "latitude=48.8566%2C35.6762&longitude=2.3522%2C139.6503",
    );
    expect(favorites.favWx).toEqual({
      paris: { temp: 20, code: 61, isDay: 1, humidity: 55, wind: 12, hi: 24, lo: 14 },
      tokyo: { temp: 30, code: 61, isDay: 1, humidity: 55, wind: 12, hi: 34, lo: 24 },
    });
    expect(renderFavorites).toHaveBeenCalledTimes(1);
  });

  it("falls back to demo data for every favorite when the request throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await favorites.loadFavWeather(true);
    expect(favorites.favWx).toEqual({ paris: expectedDemo(PARIS), tokyo: expectedDemo(TOKYO) });
    expect(renderFavorites).toHaveBeenCalledTimes(1);
  });

  it("falls back on an HTTP error", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await favorites.loadFavWeather(true);
    expect(favorites.favWx).toEqual({ paris: expectedDemo(PARIS), tokyo: expectedDemo(TOKYO) });
  });

  it("falls back for the whole list when a favorite has no entry in the response", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20)]));
    await favorites.loadFavWeather(true);
    expect(favorites.favWx).toEqual({ paris: expectedDemo(PARIS), tokyo: expectedDemo(TOKYO) });
  });

  it("accepts the single-object response used for one favorite", async () => {
    state.favorites = [PARIS];
    globalThis.fetch = vi.fn(async () => ok(batchEntry(11)));
    await favorites.loadFavWeather(true);
    expect(favorites.favWx.paris.temp).toBe(11);
  });

  it("does nothing for an empty list", async () => {
    state.favorites = [];
    globalThis.fetch = vi.fn();
    await favorites.loadFavWeather(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips the request while the same list is still fresh, unless forced", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await favorites.loadFavWeather(true);
    await favorites.loadFavWeather();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await favorites.loadFavWeather(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches when the list changes or the TTL expires", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await favorites.loadFavWeather(true);
    state.favorites = [TOKYO, PARIS];
    await favorites.loadFavWeather();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + FAVORITES_WEATHER_TTL_MS + 1);
    await favorites.loadFavWeather();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
