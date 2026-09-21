/* Per-consumer shapes and the shared hour lookup. Each toXxx function must
 * reproduce exactly what its list stored before the weather layer existed. */
import { describe, it, expect } from "vitest";
import {
  currentHourIndex,
  snapshotFromForecast,
  toFavoriteWeather,
  toPopularWeather,
  toNearbyWeather,
  toComparisonWeather,
} from "./weather-normalizer.js";

const SNAP = {
  temp: 20,
  feels: 18.5,
  humidity: 55,
  windSpeed: 12,
  code: 61,
  isDay: 1,
  hi: 24,
  lo: 14,
  rainProb: 56,
  rainProbMax: 35,
  uvMax: 5.5,
  timezone: "Europe/Paris",
};

describe("currentHourIndex", () => {
  const times = ["2026-09-21T13:00", "2026-09-21T14:00", "2026-09-21T15:00"];

  it("matches on the date-and-hour prefix", () => {
    expect(currentHourIndex(times, "2026-09-21T14:45")).toBe(1);
    expect(currentHourIndex(times, "2026-09-21T15:00")).toBe(2);
  });

  it("falls back to 0 when nothing matches", () => {
    expect(currentHourIndex(times, "2027-01-01T00:00")).toBe(0);
  });

  it("falls back to 0 for missing input", () => {
    expect(currentHourIndex(undefined, "2026-09-21T14:00")).toBe(0);
    expect(currentHourIndex(times, undefined)).toBe(0);
    expect(currentHourIndex(times, null)).toBe(0);
    expect(currentHourIndex([], "2026-09-21T14:00")).toBe(0);
  });
});

describe("toFavoriteWeather", () => {
  it("keeps the fields the favorites grid reads, renaming windSpeed to wind", () => {
    expect(toFavoriteWeather(SNAP)).toEqual({
      temp: 20,
      code: 61,
      isDay: 1,
      humidity: 55,
      wind: 12,
      hi: 24,
      lo: 14,
    });
  });

  it("throws on a missing snapshot so the whole batch falls back to demo data", () => {
    expect(() => toFavoriteWeather(null)).toThrow();
  });
});

describe("toPopularWeather", () => {
  it("keeps temperature, code and day flag", () => {
    expect(toPopularWeather(SNAP)).toEqual({ temp: 20, code: 61, isDay: 1 });
  });

  it("throws on a missing snapshot", () => {
    expect(() => toPopularWeather(undefined)).toThrow();
  });
});

describe("toNearbyWeather", () => {
  it("keeps the nearby card fields", () => {
    expect(toNearbyWeather(SNAP)).toEqual({
      temp: 20,
      windSpeed: 12,
      code: 61,
      isDay: 1,
      rainProb: 56,
    });
  });

  it("defaults a missing rain probability to 0", () => {
    expect(toNearbyWeather({ ...SNAP, rainProb: undefined }).rainProb).toBe(0);
  });

  it("returns null for a missing snapshot rather than throwing", () => {
    expect(toNearbyWeather(null)).toBeNull();
  });
});

describe("toComparisonWeather", () => {
  it("maps a snapshot onto the comparison row", () => {
    expect(toComparisonWeather(SNAP)).toEqual({
      temp: 20,
      feelsLike: 18.5,
      humidity: 55,
      wind: 12,
      code: 61,
      isDay: 1,
      precipitation: 35,
      uv: 5.5,
      timezone: "Europe/Paris",
      aqi: null,
    });
  });

  it("blanks every metric for a missing snapshot (isDay defaults to 1)", () => {
    expect(toComparisonWeather(null)).toEqual({
      temp: null,
      feelsLike: null,
      humidity: null,
      wind: null,
      code: null,
      isDay: 1,
      precipitation: null,
      uv: null,
      timezone: null,
      aqi: null,
    });
  });

  it("turns undefined metrics into null, and an empty timezone into null", () => {
    const row = toComparisonWeather({ timezone: "" });
    expect(row.temp).toBeNull();
    expect(row.precipitation).toBeNull();
    expect(row.timezone).toBeNull();
  });

  it("keeps a real zero", () => {
    expect(toComparisonWeather({ temp: 0, isDay: 0, rainProbMax: 0 })).toMatchObject({
      temp: 0,
      isDay: 0,
      precipitation: 0,
    });
  });
});

describe("snapshotFromForecast", () => {
  const wx = {
    current: {
      temp: 21,
      feels: 20,
      humidity: 50,
      windSpeed: 9,
      code: 3,
      isDay: 0,
      rainProb: 12,
    },
    daily: [{ hi: 25, lo: 15, rainProb: 40, uvMax: 6 }],
    timezone: "Etc/GMT-9",
  };

  it("summarizes a full forecast into the snapshot shape", () => {
    expect(snapshotFromForecast(wx)).toEqual({
      temp: 21,
      feels: 20,
      humidity: 50,
      windSpeed: 9,
      code: 3,
      isDay: 0,
      hi: 25,
      lo: 15,
      rainProb: 12,
      rainProbMax: 40,
      uvMax: 6,
      timezone: "Etc/GMT-9",
    });
  });

  it("feeds the per-consumer shapes the same way live snapshots do", () => {
    const snap = snapshotFromForecast(wx);
    expect(toFavoriteWeather(snap)).toEqual({
      temp: 21,
      code: 3,
      isDay: 0,
      humidity: 50,
      wind: 9,
      hi: 25,
      lo: 15,
    });
    expect(toPopularWeather(snap)).toEqual({ temp: 21, code: 3, isDay: 0 });
  });
});
