import { requestJson, malformed } from "../weather/weather-errors.js";

export async function fetchXweatherLightning(loc, { signal } = {}) {
  const params = new URLSearchParams({ lat: String(loc.lat), lon: String(loc.lon), radius: "40" });
  const data = await requestJson(`/api/xweather-lightning?${params}`, { signal });
  if (!Array.isArray(data?.strikes)) throw malformed("Malformed lightning response");
  return data;
}
