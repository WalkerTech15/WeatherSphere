/* The map's own chrome: translated control labels, the reset-view control,
   the label language and the quieter base boundaries. Everything takes the map
   it should act on — no shared state. */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";

/* MapLibre ships its own English UI strings ("Map", "Zoom in", "Toggle
   attribution"…). They are the accessible names of real controls, so they have
   to follow the interface language like everything else. The `locale` option
   covers map creation; applyMapControlLabels() covers a later language switch,
   which MapLibre has no API for. */
export function mapLocale() {
  return {
    "Map.Title": t("mapTitle"),
    "Marker.Title": t("mapMarker"),
    "Popup.Close": t("mapClosePopup"),
    "NavigationControl.ZoomIn": t("mapZoomIn"),
    "NavigationControl.ZoomOut": t("mapZoomOut"),
    "AttributionControl.ToggleAttribution": t("mapToggleAttribution"),
    /* The MapTiler SDK adds a GeolocateControl on its own (top-right) unless
       told not to, so it never appeared in this list — and it announced
       "Find my location" in English inside the French interface. */
    "GeolocateControl.FindMyLocation": t("geoUse"),
  };
}

/* selector → translation key, for the controls that carry a visible-less name */
const CONTROL_LABELS = [
  [".maplibregl-ctrl-zoom-in", "mapZoomIn"],
  [".maplibregl-ctrl-zoom-out", "mapZoomOut"],
  [".maplibregl-ctrl-attrib-button", "mapToggleAttribution"],
  [".maplibregl-popup-close-button", "mapClosePopup"],
  [".maplibregl-marker", "mapMarker"],
  [".map-reset-btn", "mapResetView"],
  [".maplibregl-ctrl-geolocate", "geoUse"],
];

/* Custom MapLibre IControl: re-flattens the camera to north-up (bearing 0)
   and pitch 0, without touching center, zoom, the selected location or the
   active weather layer. The map can no longer be tilted/rotated by the user
   at all (see the disabled dragRotate/touchPitch/rotation handlers in
   createMapInstance below), so this is mostly a safety net — for camera
   state a shared/bookmarked URL might carry, and as an explicit, discoverable
   "make it flat again" affordance. Built as a real <button> inside MapLibre's
   own `.maplibregl-ctrl-group` so it inherits the library's control styling
   (size, shadow, hover, focus ring) for free — see styles/views/map.css for
   the small bit of icon-specific styling it still needs. */
export class ResetViewControl {
  onAdd(map) {
    this._map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-reset-btn";
    button.setAttribute("aria-label", t("mapResetView"));
    button.title = t("mapResetView");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>';
    button.addEventListener("click", () => {
      map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
    });
    container.appendChild(button);
    this._container = container;
    return container;
  }
  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}

export function applyMapControlLabels(map) {
  let root;
  try {
    const canvas = map.getCanvas();
    if (canvas) canvas.setAttribute("aria-label", t("mapTitle"));
    root = map.getContainer();
  } catch {
    return; /* map already removed (style/key failure) */
  }
  if (!root) return;
  for (const [selector, key] of CONTROL_LABELS) {
    root.querySelectorAll(selector).forEach((el) => {
      el.setAttribute("aria-label", t(key));
      /* MapLibre sets title on some of them; keep the tooltip in sync too */
      if (el.hasAttribute("title")) el.setAttribute("title", t(key));
    });
  }
}

/* Point every label layer at the active language's name field, falling back to
   the local name where no translation exists. MapTiler vector labels use
   name:<lang> fields; rewriting text-field is the SDK-free way to localize.
   No map recreation — just a layout-property update per symbol layer. */
export function applyMapLanguage(map) {
  if (!map || !map.isStyleLoaded()) return;
  const field = ["coalesce", ["get", "name:" + state.lang], ["get", "name"]];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const tf = layer.layout && layer.layout["text-field"];
    if (tf === undefined) continue; /* icon-only layer, no label */
    try {
      map.setLayoutProperty(layer.id, "text-field", field);
    } catch {
      /* layer doesn't support this property — ignore */
    }
  }
}

/* Satellite labels need administrative borders, but Hybrid v4's doubled
   white/dark strokes can compete with the selected place. Quiet only the
   known boundary source layers; roads and all other line work stay intact. */
export function softenBaseBoundaries(map) {
  if (!map?.isStyleLoaded()) return;
  for (const layer of map.getStyle().layers || []) {
    const sourceLayer = layer["source-layer"];
    if (layer.type !== "line" || !["country_border", "sub_border"].includes(sourceLayer)) continue;
    const dark = /dark/i.test(layer.id);
    const opacity = dark ? 0.14 : sourceLayer === "country_border" ? 0.42 : 0.28;
    try {
      map.setPaintProperty(layer.id, "line-opacity", opacity);
    } catch {
      /* A future provider style may lock or remove this paint property. */
    }
  }
}
