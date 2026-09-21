/* The Map page's popular places: live batch, and demo fallback per place. */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { loadPopularWeather } from "./popular-weather.js";
import { demoWeather } from "../weather/weather-demo.js";
import { batchEntry } from "../weather/open-meteo.fixtures.js";

const PARIS = { id: "paris", lat: 48.8566, lon: 2.3522, name: { en: "Paris" } };
const TOKYO = { id: "tokyo", lat: 35.6762, lon: 139.6503, name: { en: "Tokyo" } };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const originalFetch = globalThis.fetch;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:34:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function expectedDemo(loc) {
  const w = demoWeather(loc);
  return { loc, temp: w.current.temp, code: w.current.code, isDay: w.current.isDay };
}

describe("loadPopularWeather", () => {
  it("returns temperature, code and day flag per place from one request", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    const out = await loadPopularWeather([PARIS, TOKYO]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(globalThis.fetch.mock.calls[0][0])).toBe(
      "https://api.open-meteo.com/v1/forecast?latitude=48.8566%2C35.6762&longitude=2.3522%2C139.6503&current=temperature_2m%2Cweather_code%2Cis_day",
    );
    expect(out).toEqual([
      { loc: PARIS, temp: 20, code: 61, isDay: 1 },
      { loc: TOKYO, temp: 30, code: 61, isDay: 1 },
    ]);
  });

  it("falls back to demo data for every place when the request fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadPopularWeather([PARIS, TOKYO])).resolves.toEqual([
      expectedDemo(PARIS),
      expectedDemo(TOKYO),
    ]);
  });

  it("falls back on an HTTP error", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(loadPopularWeather([PARIS])).resolves.toEqual([expectedDemo(PARIS)]);
  });

  it("falls back for the whole list when the response has too few entries", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20)]));
    await expect(loadPopularWeather([PARIS, TOKYO])).resolves.toEqual([
      expectedDemo(PARIS),
      expectedDemo(TOKYO),
    ]);
  });
});
