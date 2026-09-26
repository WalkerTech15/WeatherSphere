/* Side-by-side comparison of saved places.
 *
 * Scope, deliberately narrow: this compares the CURRENT location and the
 * visitor's favorites, and lives inside the Favorites view. It adds no
 * route, no sidebar entry and no new view — the sidebar is a fixed set of
 * six items that the responsive-nav suite pins, and "compare my saved
 * places" belongs next to those saved places anyway.
 *
 * Selection is stored as ids only. The places themselves already live in
 * state.favorites / state.loc, so duplicating them here would be a second
 * copy to keep in sync (and a second thing to sanitize on read).
 *
 * Weather comes from ONE batched Open-Meteo call plus ONE batched
 * air-quality call, mirroring how features/favorites.js already fetches its
 * grid — so adding a column costs no extra round trip.
 *
 * A dash in the table must always mean "this place has no value", never "not
 * loaded yet" or "the request failed": comparisonStatus says which of those
 * the table is in, and ui/render-comparison.js shows it in words. */
import { state } from "../core/state.js";
import { getJSON, setJSON, KEYS } from "../core/storage.js";
import { FETCH_TIMEOUT_MS } from "../core/config.js";
import { fetchCurrentBatch, fetchAirQuality } from "../weather/weather-provider.js";
import { batchKey, isBatchFresh, createBatchLoader } from "../weather/weather-cache.js";
import { anySignal } from "../weather/weather-errors.js";
import { toComparisonWeather } from "../weather/weather-normalizer.js";

/* How many places can be compared at once. Five columns remains readable
   with the existing horizontal scroll on smaller screens. */
export const MAX_COMPARISON = 5;

/* The metrics a comparison shows, in display order. Kept as data (rather
   than inline in the renderer) so the row set is one list to read, and so
   the pure formatting can be unit-tested without a DOM. */
export const COMPARISON_METRICS = [
  "temperature",
  "feelsLike",
  "humidity",
  "wind",
  "precipitation",
  "uv",
  "airQuality",
  "localTime",
];

/* ── Selection ─────────────────────────────────────────────────────────── */

export function loadComparison() {
  const raw = getJSON(KEYS.comparison, []);
  if (!Array.isArray(raw)) return [];
  /* Re-sanitized on read: an older or hand-edited store can never
     reintroduce a shape (or a length) the current rules would refuse. */
  return raw.filter((id) => typeof id === "string" && id).slice(0, MAX_COMPARISON);
}

export function persistComparison() {
  setJSON(KEYS.comparison, state.comparison);
}

export function isCompared(loc) {
  return Boolean(loc) && state.comparison.includes(loc.id);
}

export function comparisonFull() {
  return state.comparison.length >= MAX_COMPARISON;
}

/**
 * Add or remove a place.
 * @returns {"added"|"removed"|"full"} what actually happened, so the caller
 *   can report it — silently doing nothing at the cap would look broken.
 */
export function toggleComparison(loc) {
  if (!loc || !loc.id) return "full";
  if (isCompared(loc)) {
    state.comparison = state.comparison.filter((id) => id !== loc.id);
    persistComparison();
    return "removed";
  }
  if (comparisonFull()) return "full";
  state.comparison = [...state.comparison, loc.id];
  persistComparison();
  return "added";
}

export function removeFromComparison(id) {
  state.comparison = state.comparison.filter((x) => x !== id);
  persistComparison();
}

export function clearComparison() {
  state.comparison = [];
  persistComparison();
}

/* Every place that can be compared: the current selection first (it is what
   the visitor is looking at), then favorites, deduplicated by id. */
export function comparableLocations() {
  const seen = new Set();
  const out = [];
  for (const loc of [state.loc, ...state.favorites]) {
    if (!loc || !loc.id || seen.has(loc.id)) continue;
    seen.add(loc.id);
    out.push(loc);
  }
  return out;
}

/* The selected places, in the order the visitor added them, dropping any id
   whose place is no longer available (a favorite removed elsewhere). */
export function comparisonLocations() {
  const byId = new Map(comparableLocations().map((loc) => [loc.id, loc]));
  return state.comparison.map((id) => byId.get(id)).filter(Boolean);
}

/* Drops ids that no longer resolve — called after favorites change so a
   stale id can never linger in storage. Returns true if anything changed. */
export function pruneComparison() {
  const available = new Set(comparableLocations().map((loc) => loc.id));
  const next = state.comparison.filter((id) => available.has(id));
  if (next.length === state.comparison.length) return false;
  state.comparison = next;
  persistComparison();
  return true;
}

/* ── Weather ───────────────────────────────────────────────────────────── */

/* loc.id → metric bag. Exported for the renderer; never mutated by it. */
export let comparisonWx = {};
let comparisonKey = "";
let comparisonAt = 0;
/* idle | loading | ready | error — where the last request for the selected
   places stands. A failure is never cached as fresh, so reopening the view
   (or the retry button) asks again. */
export let comparisonStatus = "idle";
/* The air-quality service is separate, and may fail on its own. */
export let comparisonAqiFailed = false;

/* Whether the weather held is the weather of exactly these places. */
export function comparisonMatches(locs) {
  return comparisonKey === batchKey(locs);
}

export function __resetComparisonForTests() {
  comparisonWx = {};
  comparisonKey = "";
  comparisonAt = 0;
  comparisonStatus = "idle";
  comparisonAqiFailed = false;
}

/* One loader, so a rapid sequence of selections can only ever paint the
   last one (older loads are cancelled), and reopening the view while the
   same selection is loading joins that load instead of repeating it. */
const loadLatest = createBatchLoader();

async function loadAirQuality(locs, signal) {
  try {
    return { values: await fetchAirQuality(locs, { signal }), failed: false };
  } catch {
    /* Air quality is the one row allowed to be missing on its own — it is a
       separate service, and losing it must not blank the comparison. The
       table says so, rather than leaving a row of unexplained dashes. */
    return { values: [], failed: true };
  }
}

/**
 * Fetch every selected place's metrics in one batch.
 * @param {boolean} force skip the freshness check (used after a change)
 */
export function loadComparisonWeather(force = false) {
  const locs = comparisonLocations();
  const key = batchKey(locs);
  return loadLatest(key, force, async (isStale, cancelSignal) => {
    if (!locs.length) {
      comparisonWx = {};
      comparisonKey = "";
      comparisonStatus = "idle";
      return {};
    }
    if (!force && isBatchFresh({ key: comparisonKey, at: comparisonAt }, key)) {
      return comparisonWx;
    }
    comparisonStatus = "loading";

    /* one timeout shared by both requests, plus cancellation by a newer load */
    const signal = anySignal([cancelSignal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
    let next = {};
    try {
      const snapshots = await fetchCurrentBatch(locs, "comparison", { signal });
      locs.forEach((loc, i) => {
        next[loc.id] = toComparisonWeather(snapshots[i]);
      });
    } catch {
      if (isStale()) return comparisonWx; /* a newer selection owns the state */
      /* Whole-batch failure: the columns and their remove buttons stay, the
         table says the weather could not be loaded, and nothing is cached as
         fresh — so the next attempt is a real one. */
      comparisonWx = {};
      comparisonKey = "";
      comparisonAt = 0;
      comparisonAqiFailed = false;
      comparisonStatus = "error";
      return comparisonWx;
    }
    if (isStale()) return comparisonWx;

    const aqi = await loadAirQuality(locs, signal);
    if (isStale()) return comparisonWx;
    locs.forEach((loc, i) => {
      if (next[loc.id]) next[loc.id].aqi = aqi.values[i] ?? null;
    });

    comparisonWx = next;
    comparisonKey = key;
    comparisonAt = Date.now();
    comparisonAqiFailed = aqi.failed;
    comparisonStatus = "ready";
    return comparisonWx;
  });
}
