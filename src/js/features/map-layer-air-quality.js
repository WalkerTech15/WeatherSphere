/* Air Quality: a point reading for the selected place. */
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
import { fetchAirQualityDetail } from "../weather/weather-provider.js";
import { isWeatherError } from "../weather/weather-errors.js";
import { renderAirQualityUI, airQualityAnnouncement } from "../ui/render-map-airquality.js";

/* The Air Quality layer's own state — deliberately separate from `overlay`
   above: Air Quality is a POINT reading for the selected place (Open-Meteo
   has no spatial/tile product for it), not a rendered map layer with a
   colour ramp or a forecast time, so it never touches those fields. The
   satellite basemap stays on screen underneath it exactly as it does for
   the plain "satellite" selection. */
const airQualityState = {
  status: "idle" /* idle | loading | ready | error */,
  data: null,
  errorKind:
    null /* a WeatherError kind ("timeout"|"offline"|"http"|"malformed"|"unavailable"), set only when status is "error" */,
};

/* Cancels the previous Air Quality request's actual network fetch (not just
   ignoring its answer) the moment a newer one supersedes it — a fresh
   layer selection or a new place while the layer is active. Mirrors
   selectionController in features/location.js. */
let aqiController = null;

/* Fetches and renders the Air Quality reading for `loc`. Shared by
   setAirQualityLayer() (the layer was just selected) and the
   "location:selecting" handler below (the layer was already active when
   the place changed) — both must go through the SAME staleness guard, so
   a slow answer for a place the user has since left behind can never land.
   Clears the button's own "is-loading" exactly the way setMapLayer()'s
   `finally` does: only a STALE call clears its own button here; the
   winning call's button is cleared by setLayerButtonState() below, so a
   newer request's still-spinning button is never touched by an older one
   resolving late. */
async function loadAirQualityFor(loc, isStale, button) {
  aqiController?.abort();
  const controller = new AbortController();
  aqiController = controller;
  try {
    const data = await fetchAirQualityDetail(loc, { signal: controller.signal });
    if (isStale()) return;
    airQualityState.status = "ready";
    airQualityState.data = data;
    airQualityState.errorKind = null;
  } catch (err) {
    if (isStale()) return;
    airQualityState.status = "error";
    airQualityState.data = null;
    airQualityState.errorKind = isWeatherError(err) ? err.kind : "network";
  } finally {
    if (aqiController === controller) aqiController = null;
    if (isStale()) button?.classList.remove("is-loading");
  }
  if (isStale()) return;
  setLayerButtonState("airQuality"); /* also clears "is-loading" on every button */
  renderWeatherOverlay();
  emit("map:layer", getMapOverlayState());
}

/* Selecting the Air Quality layer: no spatial layer exists for it, so the
   satellite basemap simply stays on screen (any previous weather ramp
   layer is removed, exactly as switching TO satellite would) while a
   dedicated point reading loads for the currently selected place. A fetch
   failure keeps the layer selected and shows the error IN the panel
   (never falls back to satellite) — the map itself never failed, only
   the reading did. */
export async function setAirQualityLayer() {
  const isStale = startLayerRequest();
  const button = $('.map-layer[data-map-layer="airQuality"]');
  button?.classList.add("is-loading");
  detachOverlayAnimation();

  resetOverlay("airQuality");
  airQualityState.status = "loading";
  renderWeatherOverlay();

  try {
    await updateMap("worldMap");
    if (isStale()) return;
    removeWeatherLayer(MAPS.worldMap);
  } catch {
    /* the map/basemap failing to load is reported by the map's own
       offline state elsewhere; still attempt the reading below */
  }
  if (isStale()) {
    button?.classList.remove("is-loading");
    return;
  }

  if (!state.loc) {
    airQualityState.status = "error";
    airQualityState.errorKind = "unavailable";
    setLayerButtonState("airQuality");
    renderWeatherOverlay();
    return;
  }
  await loadAirQualityFor(state.loc, isStale, button);
}

/* One-time wiring, called once from main.js alongside bindMapAnimation()/
   bindMapLayerControls(). A location change must never leave the previous
   place's air-quality numbers on screen: the panel drops back to "loading"
   the instant a new place is chosen — synchronously, before the new
   request even starts — and only a fetch for the CURRENT place is allowed
   to land. Fires on every selection, but only acts while Air Quality is
   the active layer. */
export function bindAirQuality() {
  on("location:selecting", (loc) => {
    if (overlay.type !== "airQuality") return;
    const isStale = startLayerRequest();
    airQualityState.status = "loading";
    airQualityState.data = null;
    airQualityState.errorKind = null;
    renderAirQualityUI(airQualityState);
    announceLayerStatus(airQualityAnnouncement(airQualityState));
    loadAirQualityFor(loc, isStale, $('.map-layer[data-map-layer="airQuality"]'));
  });
}

registerOverlayLayer("airQuality", {
  render: () => renderAirQualityUI(airQualityState),
  announcement: () => airQualityAnnouncement(airQualityState),
  reset() {
    airQualityState.status = "idle";
    airQualityState.data = null;
    airQualityState.errorKind = null;
  },
});
