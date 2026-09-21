/* Favorites: persistence, batched live-weather fetch for the favorites
   list, and the add/remove toggle used by the hero star button. */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { setJSON, KEYS } from "../core/storage.js";
import { fetchCurrentBatch } from "../weather/weather-provider.js";
import { batchKey, isBatchFresh } from "../weather/weather-cache.js";
import { demoWeather } from "../weather/weather-demo.js";
import { snapshotFromForecast, toFavoriteWeather } from "../weather/weather-normalizer.js";
import { showToast } from "../ui/notifications.js";
import { renderHero } from "../ui/render-home.js";
import { renderFavorites } from "../ui/render-favorites.js";
import { refreshComparison } from "../ui/render-comparison.js";
import { pruneComparison } from "./comparison.js";

export function isFav(loc) {
  return state.favorites.some((f) => f.id === loc.id);
}

export function persistFavs() {
  setJSON(KEYS.favorites, state.favorites);
}

/* Live weather for all favorites, fetched in one batched call */
export let favWx = {}; // loc.id → { temp, code, isDay, hi, lo, humidity, wind }
export let favWxAt = 0;
let favWxKey = "";

export function favAgoMinutes() {
  return Math.max(0, Math.round((Date.now() - favWxAt) / 60000));
}

export async function loadFavWeather(force = false) {
  const locs = state.favorites;
  if (!locs.length) return;
  const key = batchKey(locs);
  if (!force && isBatchFresh({ key: favWxKey, at: favWxAt }, key)) return;
  try {
    const snapshots = await fetchCurrentBatch(locs, "favorites");
    favWx = {};
    locs.forEach((loc, i) => {
      favWx[loc.id] = toFavoriteWeather(snapshots[i]);
    });
  } catch {
    favWx = {};
    locs.forEach((loc) => {
      favWx[loc.id] = toFavoriteWeather(snapshotFromForecast(demoWeather(loc)));
    });
  }
  favWxAt = Date.now();
  favWxKey = key;
  renderFavorites();
}

export function toggleFavorite() {
  const loc = state.loc;
  if (isFav(loc)) {
    state.favorites = state.favorites.filter((f) => f.id !== loc.id);
    showToast(t("removedFav"));
  } else {
    state.favorites.push(loc);
    showToast(t("addedFav"));
    loadFavWeather(true);
  }
  persistFavs();
  /* Un-favouriting a place must not leave it sitting in the comparison —
     comparisonLocations() already drops ids it cannot resolve, so this only
     cleans up storage and repaints the table that is on screen. */
  pruneComparison();
  renderHero();
  renderFavorites();
  refreshComparison();
}
