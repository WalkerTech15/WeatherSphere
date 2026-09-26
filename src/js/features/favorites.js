/* Favorites: persistence, batched live-weather fetch for the favorites
   list, and the add/remove toggle used by the hero star button. */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { setJSON, KEYS } from "../core/storage.js";
import { fetchCurrentBatch } from "../weather/weather-provider.js";
import { batchKey, isBatchFresh, createBatchLoader } from "../weather/weather-cache.js";
import { toFavoriteWeather } from "../weather/weather-normalizer.js";
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
/* When favWx was last filled — 0 until it has been. Never format this
   directly: core/time-ago.js decides whether a timestamp is fit to show. */
export let favWxAt = 0;
let favWxKey = "";
/* What the cards should say for a place that has no weather:
     idle | loading  a request is on its way (or about to be) — "loading"
     ready | error   the request finished without it — "unavailable"
   A place WITH weather always shows it, however the last refresh went: real
   numbers, honestly dated, are better than an error. */
export let favStatus = "idle";

/* Opening the view while a star-toggle's load is still in flight joins it;
   a changed list cancels the older load so it cannot overwrite the newer. */
const loadLatest = createBatchLoader();

export async function loadFavWeather(force = false) {
  const locs = state.favorites;
  if (!locs.length) return;
  const key = batchKey(locs);
  if (!force && isBatchFresh({ key: favWxKey, at: favWxAt }, key)) return;
  await loadLatest(key, force, async (isStale, signal) => {
    /* a retry after a failure shows "loading" again at once */
    const retrying = favStatus === "error";
    favStatus = "loading";
    if (retrying) renderFavorites();
    const next = {};
    try {
      const snapshots = await fetchCurrentBatch(locs, "favorites", { signal });
      locs.forEach((loc, i) => {
        try {
          next[loc.id] = toFavoriteWeather(snapshots[i]);
        } catch {
          /* no usable weather for this one place — its card says so, and the
             others are not held back by it */
        }
      });
      if (!Object.keys(next).length) throw new Error("No favorite has weather");
    } catch {
      if (isStale()) return; /* superseded by a newer list — say nothing */
      /* Not cached as fresh, so the next visit tries again; and never
         replaced by invented numbers. */
      favStatus = "error";
      renderFavorites();
      return;
    }
    if (isStale()) return;
    favWx = next;
    favWxAt = Date.now();
    favWxKey = key;
    favStatus = "ready";
    renderFavorites();
  });
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
