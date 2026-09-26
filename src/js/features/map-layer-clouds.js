/* Clouds: OpenWeatherMap clouds_new raster tiles, relayed by the proxy. */
import { $ } from "../core/dom.js";
import { emit } from "../core/app-bus.js";
import { removeWeatherLayer } from "./weather-layers.js";
import { MAPS } from "./map-registry.js";
import { updateMap } from "./map-instance.js";
import {
  overlay,
  getMapOverlayState,
  setLayerButtonState,
  renderWeatherOverlay,
  detachOverlayAnimation,
  resetOverlay,
  startLayerRequest,
  registerOverlayLayer,
} from "./map-overlay.js";
import { isOffline } from "../services/offline.js";
import { awaitMapReady } from "../core/map-ready.js";
import { t } from "../core/i18n.js";
import { firstSymbolLayerId } from "./weather-layers.js";
import { raiseSelectionArea } from "./map-selection.js";
import { renderCloudsUI, cloudsAnnouncement } from "../ui/render-map-clouds.js";
import {
  CLOUDS_ATTRIBUTION_URL,
  CLOUDS_SOURCE_MAX_ZOOM,
  CLOUDS_TILE_TIMEOUT_MS,
  cloudsErrorKind,
  cloudsTileTemplate,
  fetchCloudsAvailable,
} from "../services/openweather-clouds.js";

/* The Clouds layer's own state. Unlike the point readings above it IS a map
 * layer — raster tiles relayed by /api/openweather-clouds — but with no colour
 * ramp and no forecast time, so it does not use the MapTiler weather-layer
 * flow either. "ready" means the tiles arrived; a failed tile is never
 * replaced by anything drawn locally. */
const cloudsState = {
  status: "idle" /* idle | loading | ready | error */,
  errorKind: null /* "unavailable" | "rate_limited" | "timeout" | "offline" | "http" | "network" */,
};

/* ── Clouds (OpenWeatherMap clouds_new raster tiles) ─────────────────────── */
const CLOUDS_SOURCE = "openweather-clouds";
const CLOUDS_LAYER = "openweather-clouds-tiles";
/* The tile credit MapLibre's own attribution control prints. */
const CLOUDS_MAP_ATTRIBUTION = `Weather data © <a href="${CLOUDS_ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">OpenWeatherMap</a>`;

let cloudsAvailable = false;
let cloudsProbe = null;
/* What is watching the live tile requests: the map, its two listeners and the
   timeout. Null whenever the layer is not on the map. */
let cloudsWatch = null;

function stopCloudsWatch() {
  if (!cloudsWatch) return;
  const { map, onError, onData, timer } = cloudsWatch;
  clearTimeout(timer);
  try {
    map.off("error", onError);
    map.off("sourcedata", onData);
  } catch {
    /* map already removed */
  }
  cloudsWatch = null;
}

function removeCloudsLayer() {
  stopCloudsWatch();
  const map = MAPS.worldMap?.map;
  if (!map) return;
  try {
    if (map.getLayer(CLOUDS_LAYER)) map.removeLayer(CLOUDS_LAYER);
    if (map.getSource(CLOUDS_SOURCE)) map.removeSource(CLOUDS_SOURCE);
  } catch {
    /* style torn down or map removed */
  }
}

/* One place that records the outcome and repaints. `dropLayer` is for the
   outcomes where whatever tiles are on screen must not stay up under a message
   saying the layer failed. */
function settleClouds(status, errorKind = null, { dropLayer = false } = {}) {
  if (overlay.type !== "clouds") return;
  cloudsState.status = status;
  cloudsState.errorKind = errorKind;
  if (dropLayer) removeCloudsLayer();
  else if (cloudsWatch) clearTimeout(cloudsWatch.timer);
  setLayerButtonState("clouds");
  renderWeatherOverlay();
  emit("map:layer", getMapOverlayState());
}

/* Follows the tiles the map asks the proxy for. The first tile failure decides
   the message, from the proxy's own status code; the layer counts as ready
   when its source has loaded without one. */
function watchCloudsTiles(map) {
  const onError = (event) => {
    if (event?.sourceId !== CLOUDS_SOURCE || cloudsState.status === "error") return;
    const kind = cloudsErrorKind(event.error?.status);
    /* a rejected or missing key, or a rate limit, will fail every tile alike */
    settleClouds("error", kind, { dropLayer: kind === "unavailable" || kind === "rate_limited" });
  };
  const onData = (event) => {
    if (event?.sourceId !== CLOUDS_SOURCE || !event.isSourceLoaded) return;
    if (cloudsState.status === "loading") settleClouds("ready");
  };
  const timer = setTimeout(() => {
    if (cloudsState.status === "loading") settleClouds("error", "timeout", { dropLayer: true });
  }, CLOUDS_TILE_TIMEOUT_MS);
  cloudsWatch = { map, onError, onData, timer };
  map.on("error", onError);
  map.on("sourcedata", onData);
}

function addCloudsLayer(inst) {
  const map = inst.map;
  map.addSource(CLOUDS_SOURCE, {
    type: "raster",
    tiles: [cloudsTileTemplate()],
    tileSize: 256,
    maxzoom: CLOUDS_SOURCE_MAX_ZOOM,
    attribution: CLOUDS_MAP_ATTRIBUTION,
  });
  /* under the basemap's labels, like the MapTiler weather layers */
  map.addLayer(
    { id: CLOUDS_LAYER, type: "raster", source: CLOUDS_SOURCE, paint: { "raster-opacity": 0.75 } },
    firstSymbolLayerId(map),
  );
  raiseSelectionArea(inst);
}

/* Whether the proxy holds a key, asked once. The Clouds button is only ever
   enabled when it does; a static host, a missing route or a network failure
   all read as "not available". */
function probeClouds() {
  cloudsProbe ??= fetchCloudsAvailable().then((available) => {
    cloudsAvailable = available;
    syncCloudsButton();
    return available;
  });
  return cloudsProbe;
}

function syncCloudsButton() {
  const button = $('.map-layer[data-map-layer="clouds"]');
  if (!button) return;
  const badge = button.querySelector(".map-layer-badge");
  button.disabled = !cloudsAvailable;
  button.classList.toggle("is-disabled", !cloudsAvailable);
  if (cloudsAvailable) button.removeAttribute("aria-disabled");
  else button.setAttribute("aria-disabled", "true");
  if (badge) badge.hidden = cloudsAvailable;
  button.dataset.i18nTip = cloudsAvailable ? "tipLayerClouds" : "tipLayerCloudsUnavailable";
  button.dataset.tip = t(button.dataset.i18nTip);
  /* the group's roving Tab stop: the checked layer only */
  if (cloudsAvailable) button.tabIndex = button.getAttribute("aria-checked") === "true" ? 0 : -1;
}

export async function setCloudsLayer() {
  const isStale = startLayerRequest();
  const button = $('.map-layer[data-map-layer="clouds"]');
  button?.classList.add("is-loading");
  detachOverlayAnimation();
  resetOverlay("clouds");
  removeCloudsLayer();
  cloudsState.status = "loading";
  cloudsState.errorKind = null;
  renderWeatherOverlay();
  const superseded = () => button?.classList.remove("is-loading");

  await probeClouds();
  if (isStale()) return superseded();
  if (!cloudsAvailable) return settleClouds("error", "unavailable");
  if (isOffline()) return settleClouds("error", "offline");
  try {
    await updateMap("worldMap");
    const inst = MAPS.worldMap;
    if (!inst) throw new Error("Map unavailable");
    await awaitMapReady(inst.map);
    if (isStale()) return superseded();
    removeWeatherLayer(inst);
    watchCloudsTiles(inst.map);
    addCloudsLayer(inst);
  } catch {
    if (isStale()) return superseded();
    stopCloudsWatch();
    settleClouds("error", "network");
  }
}

/* Called once at startup: settles whether the button can be offered. */
export function bindClouds() {
  probeClouds();
}

registerOverlayLayer("clouds", {
  render: () => renderCloudsUI(cloudsState),
  announcement: () => cloudsAnnouncement(cloudsState),
  reset() {
    /* leaving Clouds takes its tiles and its listeners with it */
    cloudsState.status = "idle";
    cloudsState.errorKind = null;
    removeCloudsLayer();
  },
});
