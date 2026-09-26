/* Interactive map (MapTiler SDK + Hybrid v4 style and optional weather layers).
   Borders, state/province lines, city/town/road labels all come from the
   vector style itself (countries at low zoom, regions/cities at medium,
   towns/roads at high) — no GeoJSON overlays needed.
   MapLibre is an npm dependency, dynamically imported the first time a map
   actually needs to render (map-sdk.js), so its ~200KB JS chunk never blocks
   the initial page load.

   This module is the map's public face. The work lives in modules with one
   job each, and everything else in the app keeps importing it from here:
     map-sdk.js            lazy loading of the SDK, and when the Home map may start
     map-instance.js       creating a map and keeping it on the selected place
     map-registry.js       the live map instances, and the camera read from them
     map-camera.js         flying to a view, and the country-jump chips
     map-place.js          zoom per kind of place, and the pin's popup
     map-controls.js       control labels, reset-view control, label language
     map-selection.js      the selected area's outline, and click-to-select
     map-user-location.js  the "you are here" dot
     map-overlay.js        the overlay's state, and the ramp weather layers
     map-layers.js         choosing a layer
     map-layer-*.js        one module per non-ramp layer
     map-layer-controls.js the layer switcher's keyboard behaviour and fades */
import { state } from "../core/state.js";
import { MAPS } from "./map-registry.js";
import { updateMap } from "./map-instance.js";
import { applyMapLanguage, applyMapControlLabels } from "./map-controls.js";
import { renderWeatherOverlay } from "./map-overlay.js";

export { isSelectableMapClick, setMapClickHandler } from "./map-selection.js";
export { getMapCamera, resizeMaps } from "./map-registry.js";
export { jumpTo, bindCountryFilters } from "./map-camera.js";
export { showUserLocation } from "./map-user-location.js";
export { getMapOverlayState, bindMapAnimation, setMapTime } from "./map-overlay.js";
export { setMapLayer } from "./map-layers.js";
export { bindAirQuality } from "./map-layer-air-quality.js";
export { bindHumidity } from "./map-layer-humidity.js";
export { bindAlerts } from "./map-layer-alerts.js";
export { bindLightning } from "./map-layer-lightning.js";
export { bindClouds } from "./map-layer-clouds.js";
export { bindMapLayerControls, updateMapLayerFades } from "./map-layer-controls.js";

export function refreshMapLanguage() {
  Object.values(MAPS).forEach((inst) => {
    if (inst.map.isStyleLoaded()) applyMapLanguage(inst.map);
    else inst.map.once("idle", () => applyMapLanguage(inst.map));
    applyMapControlLabels(inst.map);
  });
  renderWeatherOverlay(); /* legend labels and the timeline clock are translated */
}

export function renderMap() {
  if (!state.loc) return;
  updateMap("worldMap");
  updateMap("homeMap");
  /* units and language both change what the legend and the timeline clock
     read, and both funnel through renderAllWeather() → renderMap() */
  renderWeatherOverlay();
}
