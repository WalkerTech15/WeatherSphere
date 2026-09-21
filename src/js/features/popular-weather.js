/* Live weather for the Map page's "popular places" list, fetched in one
   batched call. Failure falls back to deterministic demo data for every
   place, like the favorites list. */
import { fetchCurrentBatch } from "../weather/weather-provider.js";
import { demoWeather } from "../weather/weather-demo.js";
import { snapshotFromForecast, toPopularWeather } from "../weather/weather-normalizer.js";

/** @returns {Promise<Array<{loc: object, temp: number, code: number, isDay: number}>>} */
export async function loadPopularWeather(locs) {
  try {
    const snapshots = await fetchCurrentBatch(locs, "popular");
    return locs.map((loc, i) => ({ loc, ...toPopularWeather(snapshots[i]) }));
  } catch {
    return locs.map((loc) => ({
      loc,
      ...toPopularWeather(snapshotFromForecast(demoWeather(loc))),
    }));
  }
}
