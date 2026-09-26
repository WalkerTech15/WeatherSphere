/* Choosing a place ON the map: the selected area's outline, and the click that
   selects a new place. */
import { selectionFeature } from "../core/selection-area.js";
import { firstSymbolLayerId } from "./weather-layers.js";

const SELECTION_SOURCE = "weather-selection-area";
const SELECTION_FILL = "weather-selection-fill";
const SELECTION_LINE = "weather-selection-line";

/* Add a Google-Maps-style blue tint/outline only for real polygon geometry.
   Point-only geocoder results use the persistent marker focus ring instead;
   their rectangular bbox is deliberately never drawn as a fake boundary. */
function applySelectionArea(inst) {
  const map = inst.map;
  if (!map.isStyleLoaded()) return;
  const data = selectionFeature(inst.selectionLoc);
  const source = map.getSource(SELECTION_SOURCE);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(SELECTION_SOURCE, { type: "geojson", data });
  const firstLabel = firstSymbolLayerId(map);
  map.addLayer(
    {
      id: SELECTION_FILL,
      type: "fill",
      source: SELECTION_SOURCE,
      paint: { "fill-color": "#2563eb", "fill-opacity": 0.1 },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: SELECTION_LINE,
      type: "line",
      source: SELECTION_SOURCE,
      paint: {
        "line-color": "#2563eb",
        "line-opacity": 0.95,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 10, 3],
      },
    },
    firstLabel,
  );
}

export function updateSelectionArea(inst, loc) {
  inst.selectionLoc = loc;
  if (inst.map.isStyleLoaded()) applySelectionArea(inst);
  else inst.map.once("idle", () => applySelectionArea(inst));
}

/* Keep the selected boundary above a freshly-added weather overlay, but still
   below the basemap's labels — the weather layer is inserted before the first
   symbol layer too (see firstSymbolLayerId), so this puts the boundary in the
   slot between them: visible through the overlay, never covering place names. */
export function raiseSelectionArea(inst) {
  const map = inst?.map;
  if (!map?.getLayer(SELECTION_FILL)) return;
  try {
    const firstLabel = firstSymbolLayerId(map);
    map.moveLayer(SELECTION_FILL, firstLabel);
    map.moveLayer(SELECTION_LINE, firstLabel);
  } catch {
    /* style/layer changed while an optional weather layer was loading */
  }
}

/* ── Click-to-select ──────────────────────────────────────────────────────
   A genuine map click is a press and release on the map surface itself.
   MapLibre already withholds its `click` event when the pointer travelled
   further than its clickTolerance between mousedown and mouseup, so a pan or
   a pinch never arrives here at all. What it does NOT filter is a click that
   landed on something drawn ON the map: the selection marker (whose own
   handler toggles the popup), an open popup, or a map control. Those are
   interactions with that element, not a request to select a new place. */
const NON_MAP_TARGETS =
  ".maplibregl-marker, .maplibregl-popup, .maplibregl-ctrl, .maplibregl-control-container";

export function isSelectableMapClick(event) {
  const target = event?.originalEvent?.target;
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest(NON_MAP_TARGETS);
}

/* The async half (reverse geocoding, weather, panel) lives in
   features/map-click.js and registers itself here, so this module never
   imports the selection pipeline back and the module graph stays acyclic. */
let mapClickHandler = null;
export function setMapClickHandler(handler) {
  mapClickHandler = handler;
}

export function bindMapSelection(inst) {
  inst.map.on("click", (event) => {
    if (!mapClickHandler || !isSelectableMapClick(event)) return;
    const { lng, lat } = event.lngLat;
    /* Immediate feedback: the pin moves on this frame, before any network
       call. Remembering the clicked key lets updateMap() tell a click-driven
       selection from a search-driven one — a click should not yank the camera
       away from the point the user just aimed at (unless what they hit turns
       out to be a whole administrative area worth framing). */
    inst.marker.setLngLat([lng, lat]);
    inst.pendingClickKey = `${lat},${lng}`;
    /* drop the previous place's administrative outline right away rather than
       leaving it around a point the user did not select */
    updateSelectionArea(inst, null);
    mapClickHandler({ lat, lon: lng });
  });
}
