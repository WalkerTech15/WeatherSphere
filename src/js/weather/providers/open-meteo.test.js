/* Open-Meteo provider: the exact request URLs (the e2e mocks and the network
 * traffic depend on them staying identical), payload normalization, and the
 * three provider-interface functions. */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  id,
  available,
  forecastUrl,
  currentBatchUrl,
  airQualityUrl,
  airQualityDetailUrl,
  normalizeForecast,
  normalizeAirQualityDetail,
  toSnapshot,
  fetchForecast,
  fetchCurrentBatch,
  fetchAirQuality,
  fetchAirQualityDetail,
  CURRENT_BATCH_QUERY_NAMES,
} from "./open-meteo.js";
import { WeatherError } from "../weather-errors.js";
import {
  forecastPayload,
  sparseForecastPayload,
  batchEntry,
  aqiEntry,
  airQualityDetailPayload,
} from "../open-meteo.fixtures.js";

const PARIS = { lat: 48.8566, lon: 2.3522 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const originalFetch = globalThis.fetch;

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), signal: opts?.signal });
    return handler(String(url));
  });
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("request URLs", () => {
  it("builds the full forecast URL exactly as the app always has", () => {
    expect(String(forecastUrl(PARIS))).toBe(
      "https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522" +
        "&current=temperature_2m%2Crelative_humidity_2m%2Capparent_temperature%2Cis_day%2Cweather_code%2Cwind_speed_10m%2Cwind_gusts_10m%2Cwind_direction_10m%2Csurface_pressure%2Cprecipitation%2Csnowfall" +
        "&hourly=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cwind_speed_10m%2Cwind_gusts_10m%2Csurface_pressure%2Cdew_point_2m%2Cprecipitation_probability%2Cvisibility%2Cuv_index%2Cweather_code%2Cis_day" +
        "&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Csunrise%2Csunset%2Cprecipitation_probability_max%2Cuv_index_max%2Cwind_speed_10m_max" +
        "&forecast_days=8&timezone=auto",
    );
  });

  it("builds each batched URL with comma-joined coordinates", () => {
    const coords = "latitude=48.8566%2C35.6762&longitude=2.3522%2C139.6503";
    const base = "https://api.open-meteo.com/v1/forecast?" + coords;
    const locs = [PARIS, TOKYO];
    expect(String(currentBatchUrl(locs, "favorites"))).toBe(
      base +
        "&current=temperature_2m%2Crelative_humidity_2m%2Cwind_speed_10m%2Cweather_code%2Cis_day" +
        "&daily=temperature_2m_max%2Ctemperature_2m_min&forecast_days=1&timezone=auto",
    );
    expect(String(currentBatchUrl(locs, "popular"))).toBe(
      base + "&current=temperature_2m%2Cweather_code%2Cis_day",
    );
    expect(String(currentBatchUrl(locs, "nearby"))).toBe(
      base +
        "&current=temperature_2m%2Cwind_speed_10m%2Cweather_code%2Cis_day" +
        "&hourly=precipitation_probability&forecast_days=1&timezone=auto",
    );
    expect(String(currentBatchUrl(locs, "comparison"))).toBe(
      base +
        "&current=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cwind_speed_10m%2Cweather_code%2Cis_day" +
        "&daily=precipitation_probability_max%2Cuv_index_max&forecast_days=1&timezone=auto",
    );
  });

  it("builds the air-quality URL", () => {
    expect(String(airQualityUrl([PARIS]))).toBe(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.8566&longitude=2.3522&current=european_aqi",
    );
    expect(String(airQualityUrl([PARIS, TOKYO]))).toBe(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.8566%2C35.6762&longitude=2.3522%2C139.6503&current=european_aqi",
    );
  });

  it("rejects a query name it does not know", () => {
    expect(() => currentBatchUrl([PARIS], "nope")).toThrow(/Unknown weather query/);
    expect(CURRENT_BATCH_QUERY_NAMES).toEqual(["favorites", "popular", "nearby", "comparison"]);
  });

  it("builds the Air Quality layer's own detail URL — one place, five fields, local time", () => {
    expect(String(airQualityDetailUrl(PARIS))).toBe(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.8566&longitude=2.3522" +
        "&current=european_aqi%2Cpm10%2Cpm2_5%2Cnitrogen_dioxide%2Cozone&timezone=auto",
    );
  });
});

describe("normalizeForecast", () => {
  it("starts the hourly series at the hour containing the current time", () => {
    const wx = normalizeForecast(forecastPayload());
    expect(wx.hourly).toHaveLength(25);
    expect(wx.hourly[0].time).toBe("2026-09-21T14:00");
    expect(wx.hourly[24].time).toBe("2026-09-22T14:00");
  });

  it("maps the current block and the current-hour extras", () => {
    const { current } = normalizeForecast(forecastPayload());
    expect(current).toEqual({
      temp: 18.4,
      feels: 17.1,
      humidity: 62,
      windSpeed: 14.2,
      gust: 28.5,
      windDir: 230,
      pressure: 1012.3,
      precip: 0.2,
      snowfall: 0,
      code: 2,
      isDay: 1,
      uv: 3.5,
      visibility: 20.14,
      dewPoint: 10,
      rainProb: 98,
      aqi: null,
    });
  });

  it("maps hourly entries, converting visibility to km", () => {
    const [first] = normalizeForecast(forecastPayload()).hourly;
    expect(first).toEqual({
      time: "2026-09-21T14:00",
      temp: 19,
      feels: 18,
      humidity: 64,
      wind: 7,
      gust: 24,
      vis: 20.14,
      pressure: 1010,
      rainProb: 98,
      code: 61,
      isDay: 1,
    });
  });

  it("keeps seven daily entries", () => {
    const { daily } = normalizeForecast(forecastPayload());
    expect(daily).toHaveLength(7);
    expect(daily[0]).toEqual({
      date: "2026-09-21",
      code: 0,
      hi: 21,
      lo: 11,
      sunrise: "2026-09-21T07:31",
      sunset: "2026-09-21T19:44",
      rainProb: 10,
      uvMax: 4.1,
      windMax: 20,
    });
  });

  it("reports the provider's timezone", () => {
    expect(normalizeForecast(forecastPayload()).timezone).toBe("Europe/Paris");
  });

  it("uses documented defaults when optional fields are absent", () => {
    const wx = normalizeForecast(sparseForecastPayload());
    expect(wx.timezone).toBeNull();
    /* no hourly slot matches "now": index 0 is used */
    expect(wx.hourly[0].time).toBe(sparseForecastPayload().hourly.time[0]);
    expect(wx.hourly).toHaveLength(10);
    expect(wx.hourly[0].gust).toBeNull();
    expect(wx.hourly[0].vis).toBeNull();
    expect(wx.hourly[0].rainProb).toBe(0);
    expect(wx.hourly[0].feels).toBe(wx.hourly[0].temp);
    expect(wx.current.gust).toBeNull();
    expect(wx.current.precip).toBeNull();
    expect(wx.current.snowfall).toBeNull();
    expect(wx.current.uv).toBe(0);
    expect(wx.current.visibility).toBe(10);
    expect(wx.current.dewPoint).toBe(0);
    expect(wx.current.rainProb).toBe(0);
    expect(wx.daily[0].rainProb).toBe(0);
    expect(wx.daily[0].uvMax).toBe(0);
    expect(wx.daily[0].windMax).toBe(0);
  });

  it("rejects a payload missing a required block as malformed", () => {
    for (const bad of [null, {}, { current: {} }, { current: { time: "x" }, hourly: {} }]) {
      expect(() => normalizeForecast(bad)).toThrow(WeatherError);
      try {
        normalizeForecast(bad);
      } catch (err) {
        expect(err.kind).toBe("malformed");
        expect(err.message).toBe("Malformed response");
      }
    }
  });
});

describe("toSnapshot", () => {
  it("copies fields as-is and finds the current hour for rain probability", () => {
    const snap = toSnapshot(batchEntry(20));
    expect(snap).toMatchObject({
      temp: 20,
      feels: 18.5,
      humidity: 55,
      windSpeed: 12,
      code: 61,
      isDay: 1,
      hi: 24,
      lo: 14,
      rainProbMax: 35,
      uvMax: 5.5,
      timezone: "Europe/Paris",
    });
    /* current time is 14:00 → hourly index 14 → 14 * 4 */
    expect(snap.rainProb).toBe(56);
  });

  it("returns null when the entry or a required block is missing", () => {
    expect(toSnapshot(undefined)).toBeNull();
    expect(toSnapshot({ timezone: "x" }, ["current"])).toBeNull();
    expect(toSnapshot({ current: {} }, ["current", "daily"])).toBeNull();
  });

  it("still returns a snapshot with only a timezone when nothing is required", () => {
    expect(toSnapshot({ timezone: "Asia/Tokyo" })).toMatchObject({ timezone: "Asia/Tokyo" });
  });
});

describe("fetchForecast", () => {
  it("makes one forecast and one air-quality request, each with a timeout signal", async () => {
    const calls = stubFetch((url) =>
      url.includes("air-quality") ? ok(aqiEntry(37)) : ok(forecastPayload()),
    );
    const wx = await fetchForecast(PARIS);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("air-quality-api.open-meteo.com");
    expect(calls[1].url).toBe(String(forecastUrl(PARIS)));
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
    expect(wx.current.aqi).toBeNull();
    await expect(wx._aqi).resolves.toBe(37);
  });

  it("resolves air quality to null when that request fails, without failing the forecast", async () => {
    stubFetch((url) =>
      url.includes("air-quality") ? { ok: false, status: 500 } : ok(forecastPayload()),
    );
    const wx = await fetchForecast(PARIS);
    await expect(wx._aqi).resolves.toBeNull();
  });

  it("rejects with an http error carrying the status", async () => {
    stubFetch((url) => (url.includes("air-quality") ? ok({}) : { ok: false, status: 503 }));
    await expect(fetchForecast(PARIS)).rejects.toMatchObject({
      kind: "http",
      status: 503,
      message: "HTTP 503",
    });
  });

  it("rejects a malformed body", async () => {
    stubFetch((url) => (url.includes("air-quality") ? ok({}) : ok({ current: {} })));
    await expect(fetchForecast(PARIS)).rejects.toMatchObject({ kind: "malformed" });
  });
});

describe("fetchCurrentBatch", () => {
  it("returns one snapshot per place from a single request", async () => {
    const calls = stubFetch(() => ok([batchEntry(20), batchEntry(30)]));
    const out = await fetchCurrentBatch([PARIS, TOKYO], "favorites");
    expect(calls).toHaveLength(1);
    expect(out.map((s) => s.temp)).toEqual([20, 30]);
    expect(out.map((s) => s.hi)).toEqual([24, 34]);
  });

  it("accepts the single-object response used for one place", async () => {
    stubFetch(() => ok(batchEntry(11)));
    const out = await fetchCurrentBatch([PARIS], "popular");
    expect(out).toHaveLength(1);
    expect(out[0].temp).toBe(11);
  });

  it("returns null for places the response has no usable entry for", async () => {
    stubFetch(() => ok([batchEntry(20)]));
    const out = await fetchCurrentBatch([PARIS, TOKYO], "nearby");
    expect(out[0].temp).toBe(20);
    expect(out[1]).toBeNull();
  });

  it("lets a caller-supplied signal cancel the request", async () => {
    const controller = new AbortController();
    const calls = stubFetch(() => ok([batchEntry(1)]));
    await fetchCurrentBatch([PARIS], "comparison", { signal: controller.signal });
    expect(calls[0].signal.aborted).toBe(false);
    controller.abort();
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("rejects on an HTTP error", async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    await expect(fetchCurrentBatch([PARIS], "nearby")).rejects.toMatchObject({ kind: "http" });
  });
});

describe("fetchAirQuality", () => {
  it("returns the European AQI per place, null where absent", async () => {
    stubFetch(() => ok([aqiEntry(21), {}]));
    await expect(fetchAirQuality([PARIS, TOKYO])).resolves.toEqual([21, null]);
  });

  it("accepts a single-object response", async () => {
    stubFetch(() => ok(aqiEntry(9)));
    await expect(fetchAirQuality([PARIS])).resolves.toEqual([9]);
  });

  it("rejects on failure so each caller decides what a missing value means", async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    await expect(fetchAirQuality([PARIS])).rejects.toMatchObject({ kind: "http" });
  });
});

describe("normalizeAirQualityDetail", () => {
  it("maps every field the map layer displays, units read from the provider", () => {
    expect(normalizeAirQualityDetail(airQualityDetailPayload())).toEqual({
      aqi: 34,
      pm10: 12.4,
      pm25: 6.1,
      no2: 18.7,
      o3: 52.3,
      units: { pm10: "μg/m³", pm25: "μg/m³", no2: "μg/m³", o3: "μg/m³" },
      time: "2026-09-21T14:00",
    });
  });

  it("falls back to µg/m³ when the provider omits current_units", () => {
    const payload = airQualityDetailPayload();
    delete payload.current_units;
    expect(normalizeAirQualityDetail(payload).units.pm25).toBe("µg/m³");
  });

  it.each([
    ["no current block at all", {}],
    ["a missing time", { current: { ...airQualityDetailPayload().current, time: undefined } }],
    [
      "a missing pollutant",
      { current: { ...airQualityDetailPayload().current, ozone: undefined } },
    ],
    [
      "a non-numeric pollutant",
      { current: { ...airQualityDetailPayload().current, pm10: "high" } },
    ],
    ["a null payload", null],
  ])("throws malformed on %s", (_label, payload) => {
    expect(() => normalizeAirQualityDetail(payload)).toThrow(WeatherError);
    try {
      normalizeAirQualityDetail(payload);
    } catch (err) {
      expect(err.kind).toBe("malformed");
    }
  });
});

describe("fetchAirQualityDetail", () => {
  it("fetches and normalizes one place's reading", async () => {
    stubFetch(() => ok(airQualityDetailPayload()));
    await expect(fetchAirQualityDetail(PARIS)).resolves.toMatchObject({ aqi: 34, pm25: 6.1 });
  });

  it("rejects on an HTTP error", async () => {
    stubFetch(() => ({ ok: false, status: 503 }));
    await expect(fetchAirQualityDetail(PARIS)).rejects.toMatchObject({ kind: "http" });
  });

  it("rejects malformed JSON as malformed, not a crash", async () => {
    stubFetch(() => ok({ current: {} }));
    await expect(fetchAirQualityDetail(PARIS)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("passes the caller's signal through to fetch", async () => {
    const calls = stubFetch(() => ok(airQualityDetailPayload()));
    const controller = new AbortController();
    await fetchAirQualityDetail(PARIS, { signal: controller.signal });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("provider identity", () => {
  it("is the available Open-Meteo provider", () => {
    expect(id).toBe("open-meteo");
    expect(available).toBe(true);
  });
});
