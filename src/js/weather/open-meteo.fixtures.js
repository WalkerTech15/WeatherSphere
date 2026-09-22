/* Deterministic Open-Meteo payloads for the weather-layer unit tests.
 * Test-only: nothing in the app imports this file. The shapes follow what
 * the real forecast / air-quality endpoints return for the fields the app
 * requests; the values are arbitrary but fixed so outputs can be compared
 * exactly. */

const pad = (n) => String(n).padStart(2, "0");

function hourTimes(startDate, count) {
  const out = [];
  const base = Date.parse(`${startDate}T00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(base + i * 36e5);
    out.push(
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`,
    );
  }
  return out;
}

function dayTimes(startDate, count) {
  const base = Date.parse(`${startDate}T00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(base + i * 864e5).toISOString().slice(0, 10),
  );
}

const series = (count, fn) => Array.from({ length: count }, (_, i) => fn(i));

/* A complete full-forecast response (8 days, hourly from local midnight). */
export function forecastPayload() {
  const hours = 192;
  const days = dayTimes("2026-09-21", 8);
  return {
    latitude: 48.86,
    longitude: 2.35,
    timezone: "Europe/Paris",
    current: {
      time: "2026-09-21T14:15",
      temperature_2m: 18.4,
      relative_humidity_2m: 62,
      apparent_temperature: 17.1,
      is_day: 1,
      weather_code: 2,
      wind_speed_10m: 14.2,
      wind_gusts_10m: 28.5,
      wind_direction_10m: 230,
      surface_pressure: 1012.3,
      precipitation: 0.2,
      snowfall: 0,
    },
    hourly: {
      time: hourTimes("2026-09-21", hours),
      temperature_2m: series(hours, (i) => 12 + (i % 24) * 0.5),
      apparent_temperature: series(hours, (i) => 11 + (i % 24) * 0.5),
      relative_humidity_2m: series(hours, (i) => 50 + (i % 30)),
      wind_speed_10m: series(hours, (i) => 5 + (i % 12)),
      wind_gusts_10m: series(hours, (i) => 10 + (i % 17)),
      surface_pressure: series(hours, (i) => 1005 + (i % 9)),
      dew_point_2m: series(hours, (i) => 6 + (i % 5)),
      precipitation_probability: series(hours, (i) => (i * 7) % 101),
      visibility: series(hours, (i) => 20000 + i * 10),
      uv_index: series(hours, (i) => (i % 24) / 4),
      weather_code: series(hours, (i) => [0, 1, 2, 3, 61][i % 5]),
      is_day: series(hours, (i) => (i % 24 >= 7 && i % 24 <= 20 ? 1 : 0)),
    },
    daily: {
      time: days,
      weather_code: [0, 1, 2, 3, 61, 80, 95, 45],
      temperature_2m_max: [21, 22, 19, 18, 20, 23, 24, 17],
      temperature_2m_min: [11, 12, 10, 9, 11, 13, 14, 8],
      sunrise: days.map((d) => `${d}T07:31`),
      sunset: days.map((d) => `${d}T19:44`),
      precipitation_probability_max: [10, 20, 30, 40, 50, 60, 70, 80],
      uv_index_max: [4.1, 4.2, 3.9, 3.1, 4, 4.4, 4.5, 2.2],
      wind_speed_10m_max: [20, 21, 22, 23, 24, 25, 26, 27],
    },
  };
}

/* The same response with every optional field missing, and a current time
   that matches no hourly slot (the normalizer must fall back to index 0). */
export function sparseForecastPayload() {
  const full = forecastPayload();
  const { hourly, daily, current } = full;
  return {
    timezone: undefined,
    current: {
      time: "2026-12-31T23:00",
      temperature_2m: current.temperature_2m,
      relative_humidity_2m: current.relative_humidity_2m,
      apparent_temperature: current.apparent_temperature,
      is_day: 0,
      weather_code: 3,
      wind_speed_10m: current.wind_speed_10m,
      wind_direction_10m: current.wind_direction_10m,
      surface_pressure: current.surface_pressure,
    },
    hourly: {
      time: hourly.time.slice(0, 10),
      temperature_2m: hourly.temperature_2m.slice(0, 10),
      relative_humidity_2m: hourly.relative_humidity_2m.slice(0, 10),
      wind_speed_10m: hourly.wind_speed_10m.slice(0, 10),
      surface_pressure: hourly.surface_pressure.slice(0, 10),
      weather_code: hourly.weather_code.slice(0, 10),
      is_day: hourly.is_day.slice(0, 10),
    },
    daily: {
      time: daily.time,
      weather_code: daily.weather_code,
      temperature_2m_max: daily.temperature_2m_max,
      temperature_2m_min: daily.temperature_2m_min,
      sunrise: daily.sunrise,
      sunset: daily.sunset,
    },
  };
}

/* One entry of a multi-coordinate "summary" response. Every block the
   batched callers ask for is present; each caller only reads its own. */
export function batchEntry(temp, { timezone = "Europe/Paris" } = {}) {
  return {
    timezone,
    current: {
      time: "2026-09-21T14:00",
      temperature_2m: temp,
      apparent_temperature: temp - 1.5,
      relative_humidity_2m: 55,
      wind_speed_10m: 12,
      weather_code: 61,
      is_day: 1,
    },
    hourly: {
      time: hourTimes("2026-09-21", 24),
      precipitation_probability: series(24, (i) => i * 4),
    },
    daily: {
      temperature_2m_max: [temp + 4],
      temperature_2m_min: [temp - 6],
      precipitation_probability_max: [35],
      uv_index_max: [5.5],
    },
  };
}

export const aqiEntry = (aqi) => ({ current: { european_aqi: aqi } });

/* A complete Air Quality map-layer response (fetchAirQualityDetail). */
export function airQualityDetailPayload(overrides = {}) {
  return {
    current: {
      time: "2026-09-21T14:00",
      european_aqi: 34,
      pm10: 12.4,
      pm2_5: 6.1,
      nitrogen_dioxide: 18.7,
      ozone: 52.3,
      ...overrides,
    },
    current_units: {
      pm10: "μg/m³",
      pm2_5: "μg/m³",
      nitrogen_dioxide: "μg/m³",
      ozone: "μg/m³",
    },
  };
}
