/* Offline demo data: deterministic, complete, and shaped like a live forecast. */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { demoWeather, tzFromLon } from "./weather-demo.js";

const TOKYO = { id: "tokyo", lat: 35.6762, lon: 139.6503, name: { en: "Tokyo" } };
const SYDNEY = { id: "sydney", lat: -33.8688, lon: 151.2093, name: { en: "Sydney" } };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:34:00Z"));
});
afterAll(() => vi.useRealTimers());

describe("tzFromLon", () => {
  it("returns UTC near the prime meridian", () => {
    expect(tzFromLon(0)).toBe("UTC");
    expect(tzFromLon(7)).toBe("UTC");
    expect(tzFromLon(-7)).toBe("UTC");
  });

  it("uses inverted Etc/GMT signs", () => {
    expect(tzFromLon(139.65)).toBe("Etc/GMT-9");
    expect(tzFromLon(-120)).toBe("Etc/GMT+8");
    expect(tzFromLon(180)).toBe("Etc/GMT-12");
  });
});

describe("demoWeather", () => {
  it("is deterministic for the same place and moment", () => {
    expect(demoWeather(TOKYO)).toEqual(demoWeather(TOKYO));
  });

  it("differs between places", () => {
    expect(demoWeather(TOKYO).current.temp).not.toBe(demoWeather(SYDNEY).current.temp);
  });

  it("has the same shape as a live forecast, with 25 hourly and 7 daily entries", () => {
    const wx = demoWeather(TOKYO);
    expect(Object.keys(wx).sort()).toEqual(["current", "daily", "hourly", "timezone", "updatedAt"]);
    expect(wx.hourly).toHaveLength(25);
    expect(wx.daily).toHaveLength(7);
    expect(Object.keys(wx.hourly[0]).sort()).toEqual(
      [
        "code",
        "feels",
        "gust",
        "humidity",
        "isDay",
        "pressure",
        "rainProb",
        "temp",
        "time",
        "vis",
        "wind",
      ].sort(),
    );
    expect(Object.keys(wx.daily[0]).sort()).toEqual(
      ["code", "date", "hi", "lo", "rainProb", "sunrise", "sunset", "uvMax", "windMax"].sort(),
    );
    expect(wx.current.aqi).toEqual(expect.any(Number));
    expect(wx.updatedAt).toBeInstanceOf(Date);
  });

  it("estimates the timezone from longitude", () => {
    expect(demoWeather(TOKYO).timezone).toBe("Etc/GMT-9");
  });

  it("falls back to the English name when a place has no id", () => {
    const noId = { ...TOKYO, id: undefined };
    expect(demoWeather(noId).current.temp).toEqual(expect.any(Number));
  });
});
