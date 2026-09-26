/* Alerts: warnings an official authority published for the selected place. */
import { $ } from "../core/dom.js";
import { state } from "../core/state.js";
import { emit, on } from "../core/app-bus.js";
import { removeWeatherLayer } from "./weather-layers.js";
import { MAPS } from "./map-registry.js";
import { updateMap } from "./map-instance.js";
import {
  overlay,
  getMapOverlayState,
  setLayerButtonState,
  renderWeatherOverlay,
  announceLayerStatus,
  detachOverlayAnimation,
  resetOverlay,
  startLayerRequest,
  registerOverlayLayer,
} from "./map-overlay.js";
import { isWeatherError } from "../weather/weather-errors.js";
import { computeAlertsState } from "./alerts-state.js";
import { fetchOfficialAlerts } from "../services/alert-provider.js";
import { firstSymbolLayerId } from "./weather-layers.js";
import { renderAlertsUI, alertsAnnouncement } from "../ui/render-map-alerts.js";

/* The Alerts layer's own state: warnings an official authority published
 * for the selected place (services/alert-provider.js), never anything
 * derived from the forecast. "unsupported" and "error" are kept strictly
 * apart from "clear" — only "clear" means an issuer actually answered that
 * nothing is in force. See ui/render-map-alerts.js. */
const alertsState = {
  status: "idle" /* idle | loading | active | clear | unsupported | error */,
  alerts: [],
  errorKind: null /* a WeatherError kind, set only when status is "error" */,
};

/* ── Official alerts ──────────────────────────────────────────────────────
   The published alert's own polygon, when the issuer included one. Most NWS
   alerts are zone-based and carry no geometry at all, which is exactly why
   ui/render-map-alerts.js always states the affected area in words too —
   nothing here is required to understand the alert. Drawn with the same
   source/layer pattern as the selection outline above. */
const ALERT_SOURCE = "official-alert-areas";
const ALERT_FILL = "official-alert-fill";
const ALERT_LINE = "official-alert-line";

export function alertAreaData(alerts) {
  return {
    type: "FeatureCollection",
    features: (alerts || [])
      .filter((alert) => alert.geometry)
      .map((alert) => ({
        type: "Feature",
        geometry: alert.geometry,
        properties: { type: alert.type, event: alert.event },
      })),
  };
}

function applyAlertAreas(alerts) {
  const inst = MAPS.worldMap;
  if (!inst?.map?.isStyleLoaded()) return;
  const map = inst.map;
  const data = alertAreaData(alerts);
  const source = map.getSource(ALERT_SOURCE);
  if (source) {
    source.setData(data);
    return;
  }
  if (!data.features.length) return; /* nothing published to draw */
  map.addSource(ALERT_SOURCE, { type: "geojson", data });
  const firstLabel = firstSymbolLayerId(map);
  /* amber for an official warning, deeper red for a tornado one — the tone
     follows the issuer's own event type, never a severity we computed */
  const color = ["case", ["==", ["get", "type"], "tornado"], "#dc2626", "#d97706"];
  map.addLayer(
    {
      id: ALERT_FILL,
      type: "fill",
      source: ALERT_SOURCE,
      paint: { "fill-color": color, "fill-opacity": 0.18 },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: ALERT_LINE,
      type: "line",
      source: ALERT_SOURCE,
      paint: { "line-color": color, "line-opacity": 0.9, "line-width": 2 },
    },
    firstLabel,
  );
}

function clearAlertAreas() {
  const map = MAPS.worldMap?.map;
  if (!map) return;
  try {
    if (map.getSource(ALERT_SOURCE)) map.getSource(ALERT_SOURCE).setData(alertAreaData([]));
  } catch {
    /* style torn down or map removed — nothing to clear */
  }
}

/* Cancels the previous alert request's actual network fetch the moment a
   newer one supersedes it. Mirrors aqiController above. */
let alertsController = null;

/* Fetches and renders official alerts for `loc`. Shared by setAlertsLayer()
   and the "location:selecting" handler, so both go through the same
   staleness guard and a slow answer for a place the user has left can never
   land. A failure is reported as a failure — never as "no alerts". */
async function loadAlertsFor(loc, isStale, button) {
  alertsController?.abort();
  const controller = new AbortController();
  alertsController = controller;
  try {
    const result = await fetchOfficialAlerts(loc, { signal: controller.signal });
    if (isStale()) return;
    const next = computeAlertsState(result);
    alertsState.status = next.status;
    alertsState.alerts = next.alerts;
    alertsState.errorKind = next.errorKind;
    applyAlertAreas(next.alerts);
  } catch (err) {
    if (isStale()) return;
    alertsState.status = "error";
    alertsState.alerts = [];
    alertsState.errorKind = isWeatherError(err) ? err.kind : "network";
    clearAlertAreas();
  } finally {
    if (alertsController === controller) alertsController = null;
    if (isStale()) button?.classList.remove("is-loading");
  }
  if (isStale()) return;
  setLayerButtonState("alerts");
  renderWeatherOverlay();
  emit("map:layer", getMapOverlayState());
}

/* Selecting the Alerts layer. Like Air Quality there is no weather-tile
   product behind it: the satellite basemap stays on screen and the issuer's
   own alert areas, if any, are drawn over it. */
export async function setAlertsLayer() {
  const isStale = startLayerRequest();
  const button = $('.map-layer[data-map-layer="alerts"]');
  button?.classList.add("is-loading");
  detachOverlayAnimation();

  resetOverlay("alerts");
  alertsState.status = "loading";
  alertsState.alerts = [];
  alertsState.errorKind = null;
  renderWeatherOverlay();

  try {
    await updateMap("worldMap");
    if (isStale()) return;
    removeWeatherLayer(MAPS.worldMap);
  } catch {
    /* the basemap's own failure is reported by the map itself; still try
       to answer the alert question below */
  }
  if (isStale()) {
    button?.classList.remove("is-loading");
    return;
  }

  if (!state.loc) {
    alertsState.status = "unsupported";
    setLayerButtonState("alerts");
    renderWeatherOverlay();
    return;
  }
  await loadAlertsFor(state.loc, isStale, button);
}

/* One-time wiring, called once from main.js. A location change must never
   leave the previous place's warning on screen: the panel drops back to
   "loading" and its drawn areas are cleared the instant a new place is
   chosen — synchronously, before the new request starts. */
export function bindAlerts() {
  on("location:selecting", (loc) => {
    if (overlay.type !== "alerts") return;
    const isStale = startLayerRequest();
    alertsState.status = "loading";
    alertsState.alerts = [];
    alertsState.errorKind = null;
    clearAlertAreas();
    renderAlertsUI(alertsState);
    announceLayerStatus(alertsAnnouncement(alertsState));
    loadAlertsFor(loc, isStale, $('.map-layer[data-map-layer="alerts"]'));
  });
}

registerOverlayLayer("alerts", {
  render: () => renderAlertsUI(alertsState),
  announcement: () => alertsAnnouncement(alertsState),
  reset() {
    /* drops both the reading and anything drawn for it */
    alertsState.status = "idle";
    alertsState.alerts = [];
    alertsState.errorKind = null;
    clearAlertAreas();
  },
});
