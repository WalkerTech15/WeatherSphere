/* Open-Meteo weather provider — the only place that knows Open-Meteo's
 * endpoints, parameter names and payload layout.
 *
 * Implements the provider interface used by weather-provider.js:
 *   fetchForecast(loc)                    → full forecast for one place
 *   fetchCurrentBatch(locs, query, opts)  → one snapshot (or null) per place
 *   fetchAirQuality(locs, opts)           → one European AQI (or null) per place
 *
 * Several places are always fetched in ONE request by comma-joining their
 * coordinates; Open-Meteo then answers with an array in the same order. */
import { requestJson, malformed } from "../weather-errors.js";
import { currentHourIndex } from "../weather-normalizer.js";

export const id = "open-meteo";
export const available = true;

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

const FORECAST_PARAMS = {
  /* wind_gusts_10m is what the severe-weather advisory thresholds are
     defined against (sustained wind understates a squall). Added to the
     SAME request — no extra round trip. */
  current:
    "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure,precipitation,snowfall",
  hourly:
    "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,surface_pressure,dew_point_2m,precipitation_probability,visibility,uv_index,weather_code,is_day",
  daily:
    "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max",
  forecast_days: "8",
  timezone: "auto",
};

/* The batched lists each ask for only the fields they show. `requires`
   lists the response blocks without which a place's snapshot is null
   (unusable); what a null means is decided by the caller. */
const CURRENT_BATCH_QUERIES = {
  favorites: {
    params: {
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
      daily: "temperature_2m_max,temperature_2m_min",
      forecast_days: "1",
      timezone: "auto",
    },
    requires: ["current", "daily"],
  },
  popular: {
    params: { current: "temperature_2m,weather_code,is_day" },
    requires: ["current"],
  },
  nearby: {
    params: {
      current: "temperature_2m,wind_speed_10m,weather_code,is_day",
      hourly: "precipitation_probability",
      forecast_days: "1",
      timezone: "auto",
    },
    requires: ["current"],
  },
  comparison: {
    params: {
      current:
        "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
      daily: "precipitation_probability_max,uv_index_max",
      forecast_days: "1",
      timezone: "auto",
    },
    requires: [],
  },
};

export const CURRENT_BATCH_QUERY_NAMES = Object.freeze(Object.keys(CURRENT_BATCH_QUERIES));

function coordinateUrl(base, locs, params) {
  const url = new URL(base);
  url.search = new URLSearchParams({
    latitude: locs.map((l) => l.lat).join(","),
    longitude: locs.map((l) => l.lon).join(","),
    ...params,
  }).toString();
  return url;
}

/* A single-coordinate request answers with an object, a multi-coordinate
   one with an array. */
const asArray = (data) => (Array.isArray(data) ? data : [data]);

export function forecastUrl(loc) {
  return coordinateUrl(FORECAST_URL, [loc], FORECAST_PARAMS);
}

export function currentBatchUrl(locs, query) {
  const def = CURRENT_BATCH_QUERIES[query];
  if (!def) throw new Error(`Unknown weather query: ${query}`);
  return coordinateUrl(FORECAST_URL, locs, def.params);
}

export function airQualityUrl(locs) {
  return coordinateUrl(AIR_QUALITY_URL, locs, { current: "european_aqi" });
}

/* Full-forecast payload → app forecast shape (without `_aqi`). */
export function normalizeForecast(d) {
  if (!d || !d.current || typeof d.current.time !== "string" || !d.hourly?.time || !d.daily?.time) {
    throw malformed();
  }
  /* timezone=auto makes Open-Meteo resolve the real IANA zone for these coords
     (e.g. "Asia/Tokyo") — that's what drives the hero's local-time clock. */
  const timezone = d.timezone || null;
  const idx = currentHourIndex(d.hourly.time, d.current.time);

  const hourly = [];
  for (let i = idx; i < Math.min(idx + 25, d.hourly.time.length); i++) {
    hourly.push({
      time: d.hourly.time[i],
      temp: d.hourly.temperature_2m[i],
      feels: d.hourly.apparent_temperature?.[i] ?? d.hourly.temperature_2m[i],
      humidity: d.hourly.relative_humidity_2m[i],
      wind: d.hourly.wind_speed_10m[i],
      /* null, not 0, when the provider omits them: the advisory checks skip a
         missing field rather than reading it as "calm" or "clear" */
      gust: d.hourly.wind_gusts_10m?.[i] ?? null,
      vis: d.hourly.visibility?.[i] != null ? d.hourly.visibility[i] / 1000 : null, // km, like current.visibility
      pressure: d.hourly.surface_pressure[i],
      rainProb: d.hourly.precipitation_probability?.[i] ?? 0,
      code: d.hourly.weather_code[i],
      isDay: d.hourly.is_day[i],
    });
  }

  const daily = d.daily.time.slice(0, 7).map((date, i) => ({
    date,
    code: d.daily.weather_code[i],
    hi: d.daily.temperature_2m_max[i],
    lo: d.daily.temperature_2m_min[i],
    sunrise: d.daily.sunrise[i],
    sunset: d.daily.sunset[i],
    rainProb: d.daily.precipitation_probability_max?.[i] ?? 0,
    uvMax: d.daily.uv_index_max?.[i] ?? 0,
    windMax: d.daily.wind_speed_10m_max?.[i] ?? 0,
  }));

  return {
    current: {
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      windSpeed: d.current.wind_speed_10m,
      gust: d.current.wind_gusts_10m ?? null,
      windDir: d.current.wind_direction_10m,
      pressure: d.current.surface_pressure,
      /* Measured precipitation now (mm) and snowfall now (cm). null when the
         provider omits them — the weather animations treat that as "no
         data" and show nothing, never as "zero" or "some". */
      precip: d.current.precipitation ?? null,
      snowfall: d.current.snowfall ?? null,
      code: d.current.weather_code,
      isDay: d.current.is_day,
      uv: d.hourly.uv_index?.[idx] ?? 0,
      visibility: (d.hourly.visibility?.[idx] ?? 10000) / 1000,
      dewPoint: d.hourly.dew_point_2m?.[idx] ?? 0,
      rainProb: d.hourly.precipitation_probability?.[idx] ?? 0,
      aqi: null /* filled in later by _aqi — never blocks the weather render */,
    },
    hourly,
    daily,
    updatedAt: new Date(),
    timezone,
  };
}

/* One batched-response entry → provider-neutral snapshot (see
   weather-normalizer.js). Values are copied as-is; defaults are the
   consumer's business. */
export function toSnapshot(entry, requires = []) {
  if (!entry || requires.some((block) => !entry[block])) return null;
  const { current, hourly, daily } = entry;
  return {
    temp: current?.temperature_2m,
    feels: current?.apparent_temperature,
    humidity: current?.relative_humidity_2m,
    windSpeed: current?.wind_speed_10m,
    code: current?.weather_code,
    isDay: current?.is_day,
    hi: daily?.temperature_2m_max?.[0],
    lo: daily?.temperature_2m_min?.[0],
    rainProb: hourly?.precipitation_probability?.[currentHourIndex(hourly?.time, current?.time)],
    rainProbMax: daily?.precipitation_probability_max?.[0],
    uvMax: daily?.uv_index_max?.[0],
    timezone: entry.timezone,
  };
}

export async function fetchAirQuality(locs, { signal } = {}) {
  const data = await requestJson(airQualityUrl(locs), { signal });
  return asArray(data).map((entry) => entry?.current?.european_aqi ?? null);
}

export async function fetchForecast(loc, { signal } = {}) {
  /* Air quality comes from a separate endpoint and is optional: it is
     requested alongside the forecast and resolves to null on any failure,
     so it never delays or breaks the weather render. Both requests share
     the caller's cancellation signal, so a cancelled forecast leaves no
     air-quality request running either. */
  const aqi = fetchAirQuality([loc], { signal })
    .then((values) => values[0] ?? null)
    .catch(() => null);
  const payload = await requestJson(forecastUrl(loc), { signal });
  return { ...normalizeForecast(payload), _aqi: aqi };
}

export async function fetchCurrentBatch(locs, query, { signal } = {}) {
  const url = currentBatchUrl(locs, query);
  const entries = asArray(await requestJson(url, { signal }));
  const { requires } = CURRENT_BATCH_QUERIES[query];
  return locs.map((_, i) => toSnapshot(entries[i], requires));
}
