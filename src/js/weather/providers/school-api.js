/* School weather-station API — placeholder with the same interface as
 * providers/open-meteo.js.
 *
 * The station API does not exist yet: the Settings card lists it as
 * "coming soon" and nothing selects this provider. Every call rejects with
 * an "unavailable" WeatherError without touching the network, so wiring it
 * in later means implementing these three functions, not changing callers. */
import { unavailable } from "../weather-errors.js";

export const id = "school-api";
export const available = false;

export async function fetchForecast() {
  throw unavailable(id);
}

export async function fetchCurrentBatch() {
  throw unavailable(id);
}

export async function fetchAirQuality() {
  throw unavailable(id);
}
