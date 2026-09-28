/* Favorites Notifications — phase 1: official severe-weather alerts only.
 *
 * This reuses the exact same verified seam the map's Alerts layer already
 * uses (services/alert-provider.js → services/nws-alerts.js): nothing here is
 * inferred from wind, rain, pressure or a weather code, and a favorite with
 * no verified issuer is reported as "no coverage", never as a quiet "no
 * alert" (see computeAlertsState in ./alerts-state.js, which this reuses
 * unchanged). Lightning and air-quality notifications are NOT part of this
 * phase — see AI_REPORT.md for why — but the same discipline (verified
 * provider or nothing) must apply to them too whenever they are added.
 *
 * Persistence stores only what the panel needs to redraw without a network
 * round trip: no polygon geometry, no raw provider payloads.
 */
import { state } from "../core/state.js";
import { getJSON, setJSON, KEYS } from "../core/storage.js";
import { emit } from "../core/app-bus.js";
import { fetchOfficialAlerts } from "../services/alert-provider.js";
import { computeAlertsState, sortAlerts } from "./alerts-state.js";
import { isOffline } from "../services/offline.js";
import { batchKey, isBatchFresh, createBatchLoader } from "../weather/weather-cache.js";
import { FAVORITES_WEATHER_TTL_MS } from "../core/config.js";

/* The five fixed tones the brief specifies, one per official severity step —
   most serious first, exactly like alerts-state.js's own SEVERITY_ORDER, so
   every value that order recognises maps to exactly one tone. Anything
   outside it (an issuer's own custom wording) reads as "info" rather than
   being guessed at. */
const SEVERITY_TONE = {
  Extreme: "severe",
  Severe: "warning",
  Moderate: "caution",
  Minor: "normal",
};
export function severityTone(severity) {
  return SEVERITY_TONE[severity] || "info";
}

/* Stable identity for one published alert at one favorite: the same issuer
   re-publishing the same event keeps the same key, so a refresh never
   duplicates it — but a genuinely new issuance (a new `starts`) is a new key,
   so it resurfaces as unread even if the previous one was cleared. Silently
   and permanently hiding a still-active severe warning would be unsafe. */
function notificationKey(alert, locId) {
  return `${alert.providerId}:${locId}:${alert.type}:${alert.starts}`;
}

export function alertToNotification(alert, locId, read = false) {
  return {
    key: notificationKey(alert, locId),
    locId,
    type: alert.type,
    event: alert.event,
    severity: alert.severity,
    tone: severityTone(alert.severity),
    urgency: alert.urgency,
    area: alert.area,
    authority: alert.authority,
    starts: alert.starts,
    expires: alert.expires,
    source: alert.source,
    read,
  };
}

/**
 * Pure merge: previous stored notifications + this cycle's per-location
 * results → the next stored list.
 *
 *   - A location that answered ("active") contributes exactly its current
 *     alerts — anything of its that is no longer reported disappears, because
 *     the issuer is the only source of truth for what's still in force.
 *   - A location that failed this cycle ("error") or has no verified issuer
 *     ("unsupported") keeps whatever it had, as long as it hasn't expired: a
 *     transient failure must never silently clear a known active warning.
 *   - A key already known keeps its read flag; a new key starts unread.
 *
 * @param {object[]} previous stored notification records
 * @param {{locId:string, status:string, alerts:object[]}[]} perLoc this
 *   cycle's computeAlertsState() output per favorite
 */
export function mergeFavoritesNotifications(previous, perLoc, nowMs = Date.now()) {
  const prevByKey = new Map(previous.map((n) => [n.key, n]));
  const carryLocIds = new Set(
    perLoc.filter((p) => p.status === "error" || p.status === "unsupported").map((p) => p.locId),
  );
  const carried = previous.filter((n) => carryLocIds.has(n.locId) && n.expires > nowMs);
  const fresh = perLoc
    .filter((p) => p.status === "active")
    .flatMap((p) => p.alerts.map((a) => alertToNotification(a, p.locId)))
    .map((n) => (prevByKey.get(n.key)?.read ? { ...n, read: true } : n));
  const seen = new Set();
  return [...carried, ...fresh].filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true)));
}

/** Whether any favorite has a verified official issuer at all. */
export function summarizeFavoritesCoverage(statuses) {
  if (!statuses.length) return "no-coverage";
  return statuses.some((s) => s !== "unsupported") ? "ok" : "no-coverage";
}

/* ── Live module state (mirrors the favWx/favStatus pattern in favorites.js) ── */

/** locId → computeAlertsState() output, for the favorite-card badge. */
export let alertsByLoc = {};
/** idle | loading | ready | error | offline */
export let notifStatus = "idle";
/** null (not yet known) | "no-coverage" | "ok" */
export let coverage = null;
export let notifications = getJSON(KEYS.favNotifications, []);

function persist() {
  setJSON(KEYS.favNotifications, notifications);
}

/* Announced on the bus rather than calling ui/render-notifications.js and
   ui/render-favorites.js directly, so this module keeps no dependency on
   either (same reasoning as core/app-bus.js's own header: producers only
   ever depend on the bus, never on who's listening). main.js subscribes
   once and repaints both the bell and the favorite cards' alert badges. */
function announceChange() {
  emit("favorites:notifications-changed");
}

export function unreadCount() {
  return notifications.filter((n) => !n.read).length;
}

export function sortedNotifications() {
  return sortAlerts(notifications);
}

export function markNotificationRead(key) {
  const found = notifications.find((n) => n.key === key);
  if (!found || found.read) return;
  found.read = true;
  persist();
  announceChange();
}

export function clearAllNotifications() {
  if (!notifications.length) return;
  notifications = [];
  persist();
  announceChange();
}

/** A favorite's single most urgent active alert, or null. Used for the
    favorite-card badge — never invented when the location has no coverage
    or the issuer answered clear. */
export function activeAlertFor(locId) {
  const result = alertsByLoc[locId];
  if (!result || result.status !== "active" || !result.alerts.length) return null;
  return result.alerts[0]; /* already most-severe-first, see computeAlertsState */
}

/* Drops notifications and cached results for favorites that are no longer
   saved — called whenever the favorites list changes. */
export function pruneFavoritesNotifications() {
  const ids = new Set(state.favorites.map((f) => f.id));
  const before = notifications.length;
  notifications = notifications.filter((n) => ids.has(n.locId));
  let changed = notifications.length !== before;
  for (const locId of Object.keys(alertsByLoc)) {
    if (!ids.has(locId)) {
      delete alertsByLoc[locId];
      changed = true;
    }
  }
  if (changed) {
    persist();
    announceChange();
  }
}

const loadLatest = createBatchLoader();
let lastKey = "";
let lastAt = 0;

/**
 * Fetch official alerts for every favorite, in one batched round of
 * requests. Reuses the same createBatchLoader/isBatchFresh contract as
 * favorites.js's loadFavWeather: a repeat call for the same list within
 * FAVORITES_WEATHER_TTL_MS joins or is skipped rather than firing again, and
 * a changed list (or `force`) supersedes and cancels the older one.
 */
export async function loadFavoritesAlerts(force = false) {
  const locs = state.favorites;
  if (!locs.length) {
    const hadAny = notifStatus !== "idle";
    alertsByLoc = {};
    notifStatus = "idle";
    coverage = null;
    if (hadAny) announceChange();
    return;
  }
  if (isOffline()) {
    const changed = notifStatus !== "offline";
    notifStatus = "offline";
    if (changed) announceChange();
    return;
  }
  const key = batchKey(locs);
  if (
    !force &&
    isBatchFresh({ key: lastKey, at: lastAt }, key, Date.now(), FAVORITES_WEATHER_TTL_MS)
  ) {
    return;
  }
  await loadLatest(key, force, async (isStale, signal) => {
    notifStatus = "loading";
    announceChange();
    let perLoc;
    try {
      perLoc = await Promise.all(
        locs.map(async (loc) => ({
          locId: loc.id,
          result: computeAlertsState(await fetchOfficialAlerts(loc, { signal })),
        })),
      );
    } catch {
      if (isStale()) return;
      notifStatus = "error";
      announceChange();
      return;
    }
    if (isStale()) return;
    alertsByLoc = Object.fromEntries(perLoc.map(({ locId, result }) => [locId, result]));
    notifications = mergeFavoritesNotifications(
      notifications,
      perLoc.map(({ locId, result }) => ({ locId, status: result.status, alerts: result.alerts })),
    );
    persist();
    coverage = summarizeFavoritesCoverage(perLoc.map(({ result }) => result.status));
    lastKey = key;
    lastAt = Date.now();
    notifStatus = "ready";
    announceChange();
  });
}

/**
 * Polls loadFavoritesAlerts() on the same cadence as the favorites weather
 * refresh, but only while the tab is actually visible — and catches up
 * immediately the moment it becomes visible again, so a long-backgrounded
 * tab never shows an hours-stale badge without at least trying once first.
 * Returns an unsubscribe function (test/teardown only; app code never calls
 * it, matching bindAlerts()/bindLightning() and friends).
 */
export function bindFavoritesNotificationsRefresh(onUpdate) {
  const tick = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    loadFavoritesAlerts().then(onUpdate);
  };
  const interval = setInterval(tick, FAVORITES_WEATHER_TTL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/* Test seam only. */
export function __resetFavoritesNotificationsForTests() {
  alertsByLoc = {};
  notifStatus = "idle";
  coverage = null;
  notifications = [];
  lastKey = "";
  lastAt = 0;
}
