/* Lightning: recent Xweather strikes near the selected place. */
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
import { fetchXweatherLightning } from "../services/xweather-lightning.js";
import { renderLightningUI, lightningAnnouncement } from "../ui/render-map-lightning.js";

const lightningState = {
  status: "idle" /* idle | loading | ready | empty | error | unsupported */,
  data: null,
  errorKind: null,
};

const LIGHTNING_SOURCE = "xweather-lightning-strikes";
const LIGHTNING_LAYER = "xweather-lightning-points";

export function lightningPointData(strikes) {
  return {
    type: "FeatureCollection",
    features: (strikes || [])
      .filter((strike) => Number.isFinite(strike.lat) && Number.isFinite(strike.lon))
      .map((strike) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [strike.lon, strike.lat] },
        properties: { type: strike.type || "strike" },
      })),
  };
}

function applyLightningStrikes(strikes) {
  const map = MAPS.worldMap?.map;
  if (!map?.isStyleLoaded()) return;
  const data = lightningPointData(strikes);
  const source = map.getSource(LIGHTNING_SOURCE);
  if (source) {
    source.setData(data);
    return;
  }
  if (!data.features.length) return;
  map.addSource(LIGHTNING_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: LIGHTNING_LAYER,
    type: "circle",
    source: LIGHTNING_SOURCE,
    paint: {
      "circle-color": "#facc15",
      "circle-radius": 6,
      "circle-stroke-color": "#fff7ed",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.9,
    },
  });
}

function clearLightningStrikes() {
  const map = MAPS.worldMap?.map;
  if (!map) return;
  try {
    const source = map.getSource(LIGHTNING_SOURCE);
    if (source) source.setData(lightningPointData([]));
  } catch {
    /* style torn down or map removed */
  }
}

let lightningController = null;

async function loadLightningFor(loc, isStale, button) {
  lightningController?.abort();
  const controller = new AbortController();
  lightningController = controller;
  try {
    const data = await fetchXweatherLightning(loc, { signal: controller.signal });
    if (isStale()) return;
    lightningState.data = data;
    lightningState.status = data.strikes.length ? "ready" : "empty";
    lightningState.errorKind = null;
    applyLightningStrikes(data.strikes);
  } catch (err) {
    if (isStale()) return;
    lightningState.status = "error";
    lightningState.data = null;
    lightningState.errorKind = isWeatherError(err) ? err.kind : "network";
    clearLightningStrikes();
  } finally {
    if (lightningController === controller) lightningController = null;
    if (isStale()) button?.classList.remove("is-loading");
  }
  if (isStale()) return;
  setLayerButtonState("lightning");
  renderWeatherOverlay();
  emit("map:layer", getMapOverlayState());
}

export async function setLightningLayer() {
  const isStale = startLayerRequest();
  const button = $('.map-layer[data-map-layer="lightning"]');
  button?.classList.add("is-loading");
  detachOverlayAnimation();
  resetOverlay("lightning");
  lightningState.status = "loading";
  lightningState.data = null;
  lightningState.errorKind = null;
  renderWeatherOverlay();
  try {
    await updateMap("worldMap");
    if (isStale()) return;
    removeWeatherLayer(MAPS.worldMap);
  } catch {
    /* The map's own error UI covers basemap failures; still report the API state. */
  }
  if (isStale()) return;
  if (!state.loc) {
    lightningState.status = "unsupported";
    setLayerButtonState("lightning");
    renderWeatherOverlay();
    return;
  }
  await loadLightningFor(state.loc, isStale, button);
}

export function bindLightning() {
  on("location:selecting", (loc) => {
    if (overlay.type !== "lightning") return;
    const isStale = startLayerRequest();
    lightningState.status = "loading";
    lightningState.data = null;
    lightningState.errorKind = null;
    clearLightningStrikes();
    renderLightningUI(lightningState);
    announceLayerStatus(lightningAnnouncement(lightningState));
    loadLightningFor(loc, isStale, $('.map-layer[data-map-layer="lightning"]'));
  });
}

registerOverlayLayer("lightning", {
  render: () => renderLightningUI(lightningState),
  announcement: () => lightningAnnouncement(lightningState),
  reset() {
    lightningState.status = "idle";
    lightningState.data = null;
    lightningState.errorKind = null;
    clearLightningStrikes();
  },
});
