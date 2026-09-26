/* Creating a map and keeping it on the selected place: the SDK is imported on
   demand, the instance is built once per container, and every later pass only
   moves the pin, the popup and the camera. */
import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { MAPTILER_KEY, MAP_STYLE } from "../core/config.js";
import { normalizeBbox } from "../core/geo-bounds.js";
import { isAdministrativeArea } from "../core/selection-area.js";
import { emit } from "../core/app-bus.js";
import { switchView } from "../ui/navigation.js";
import { noticeHtml } from "../ui/notice.js";
import { loadMapLibre, whenMapNearViewport, idle } from "./map-sdk.js";
import { zoomFor, popupHtml } from "./map-place.js";
import {
  mapLocale,
  ResetViewControl,
  applyMapControlLabels,
  applyMapLanguage,
  softenBaseBoundaries,
} from "./map-controls.js";
import { updateSelectionArea, bindMapSelection } from "./map-selection.js";
import { applyRememberedUserLocation } from "./map-user-location.js";
import { applyPendingCamera } from "./map-camera.js";
import { MAPS } from "./map-registry.js";

const MAP_CONFIG = {
  /* the map page's full-size map is the one you can click to pick a place;
     the home preview stays a read-only summary of the current selection */
  worldMap: { view: "map", autoPopup: false, selectable: true },
  homeMap: { view: "home", autoPopup: false, selectable: false },
};

function mapError(id) {
  const el = $("#" + id);
  if (!el) return;
  /* Always, not only the first time: updateMap() puts is-loading back on every
     repaint before it tries to build the map, and a repeat failure used to hit
     the "already showing the notice" guard below and leave the spinner drawn
     over the message for good. */
  el.classList.remove("is-loading");
  if (!el.querySelector(".map-offline")) {
    /* The forecast needs no map, so that is the useful way forward. The Home
       preview is secondary and fails quietly (polite status); the Map page is
       the point of the page, so its failure is announced. */
    el.innerHTML = `<div class="map-offline">${noticeHtml({
      tone: "warn",
      icon: "cloud",
      title: t("mapErrorTitle"),
      text: t("mapError"),
      action: { id: "open-forecast", label: t("mapErrorAction") },
      role: id === "homeMap" ? "status" : "alert",
    })}</div>`;
    el.querySelector('[data-notice-action="open-forecast"]')?.addEventListener("click", () =>
      switchView("forecast"),
    );
  }
}

/* Camera changes are incidental state: reported so the URL can be updated
   with a debounced replaceState, never a history entry (see map-url.js). */
function bindCameraReporting(inst, id) {
  inst.map.on("moveend", () => {
    const center = inst.map.getCenter();
    emit("map:moved", { id, lat: center.lat, lon: center.lng, zoom: inst.map.getZoom() });
  });
}

/* Creation is asynchronous (the SDK chunk is imported on demand), and several
   callers can ask for the same map in the same tick — switchView() and the
   weather fan-out both call renderMap(). Without this, each would get past the
   `!MAPS[id]` check and build a second MapLibre instance on the same
   container: duplicate canvases, duplicate listeners, and a camera applied to
   whichever one lost. One in-flight promise per container fixes that. */
const CREATING = {};

async function createMapInstance(id, el, cfg) {
  const loc = state.loc;
  const maplibregl = await loadMapLibre();
  /* container may have been swapped for an offline message while we awaited */
  if (!$("#" + id)) return;
  const map = new maplibregl.Map({
    container: id,
    style: MAP_STYLE,
    center: [loc.lon, loc.lat],
    /* slightly zoomed out so the first flyTo is a real flight — a no-op
         flight would skip the popup offset and the moveend event */
    zoom: zoomFor(loc) - 0.4,
    /* Permanently flat and north-up: a 3D tilted globe (space background,
       curved horizon) makes the weather overlays and boundaries hard to
       read, and there's no interaction left that can re-tilt it — see the
       disabled handlers just below. */
    pitch: 0,
    bearing: 0,
    dragRotate: false /* right-click/Ctrl-drag to rotate+pitch — fully off */,
    pitchWithRotate: false,
    touchPitch: false /* two-finger vertical drag to pitch — fully off */,
    renderWorldCopies: false,
    /* The SDK adds a starfield ("space") and an atmosphere ("halo") layer for
       its globe view. Both are meaningless on this flat map, and the space
       layer's textures load asynchronously, so its first frames log
       "[CubemapLayer]: Texture is undefined" in development. */
    space: false,
    halo: false,
    minZoom: 1 /* mercator already clamps latitude at ±85° — no pole panning */,
    navigationControl: false,
    attributionControl: { compact: true },
    locale: mapLocale(),
  });
  /* Both of these are "disable ONLY the rotate/pitch part" calls — pan
     (arrow keys / one-finger drag) and zoom (+/- / pinch) stay fully
     interactive. There's no equivalent constructor option for that split. */
  map.keyboard.disableRotation();
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new ResetViewControl(), "top-left");
  map.on("load", () => {
    el.classList.remove("is-loading");
    applyMapLanguage(map);
    applyMapControlLabels(map);
    softenBaseBoundaries(map);
  });
  map.once("error", () => {
    if (!map.isStyleLoaded()) {
      try {
        map.remove();
      } catch {
        /* already gone */
      }
      delete MAPS[id];
      mapError(id);
    }
  });

  const pin = document.createElement("div");
  pin.className = "map-pin-icon";
  /* MapLibre makes a marker with a popup focusable (tabindex 0) and opens the
     popup on Enter — it IS a button, and says so. Without the role, the
     translated aria-label MapLibre sets is not allowed on a plain div, so
     screen readers dropped it and announced nothing on focus. */
  pin.setAttribute("role", "button");
  pin.innerHTML =
    '<span class="map-focus-ring"></span><span class="map-ping"></span><span class="map-dot"></span>';
  /* anchor "bottom" = popup always above the marker; the flyTo offset below
       shifts the marker under the center so the popup always fits the map */
  const popup = new maplibregl.Popup({ offset: 16, maxWidth: "260px", anchor: "bottom" });
  /* the popup's "view weather" button has no inline handler (unlike a plain
       onclick="..." string, which would need switchView on window) — attach a
       fresh listener each time the popup's content actually opens instead. */
  popup.on("open", () => {
    const popupEl = popup.getElement && popup.getElement();
    const btn = popupEl && popupEl.querySelector(".mp-link");
    if (btn) btn.addEventListener("click", () => switchView("home"), { once: true });
    applyMapControlLabels(map);
  });
  const marker = new maplibregl.Marker({ element: pin })
    .setLngLat([loc.lon, loc.lat])
    .setPopup(popup)
    .addTo(map);
  MAPS[id] = {
    map,
    marker,
    popup,
    lastKey: null,
    userMarker: null,
    weatherLayer: null,
    weatherLayerType: null,
  };
  /* bound once, at creation — never on a later updateMap() pass, so the map
     can never accumulate duplicate listeners */
  if (cfg.selectable) bindMapSelection(MAPS[id]);
  bindCameraReporting(MAPS[id], id);
}

export async function updateMap(id) {
  const cfg = MAP_CONFIG[id];
  const el = $("#" + id);
  /* only touch a map while its container is visible; the view becomes
     display:block one frame after switchView, so retry on the next frame */
  if (!el || !el.offsetWidth) {
    if (state.view === cfg.view) requestAnimationFrame(() => updateMap(id));
    return;
  }
  if (!MAPS[id]) {
    if (!MAPTILER_KEY) {
      mapError(id);
      return;
    }
    el.classList.add("is-loading");
    if (!CREATING[id]) {
      /* Only the Home preview's own first creation waits — until it is
         approached, then for an idle moment (see whenMapNearViewport and
         idle above) — the Map page (id "worldMap") is always an explicit
         visit and never deferred. Nothing else needs the preview to exist
         before then: a Simple/Détaillé switch or a window resize only
         re-measures maps that exist (resizeMaps), and the map measures its
         container afresh whenever it is created. Meanwhile the container
         keeps its reserved size and its is-loading state. */
      const kickoff =
        id === "homeMap" ? whenMapNearViewport(el).then(() => idle()) : Promise.resolve();
      CREATING[id] = kickoff
        .then(() => createMapInstance(id, el, cfg))
        .finally(() => {
          delete CREATING[id];
        });
    }
    try {
      await CREATING[id];
    } catch {
      mapError(id);
      return;
    }
    if (!MAPS[id]) return; /* container disappeared mid-creation */
  }
  /* Read only now: creation can wait (the Home preview waits to be scrolled
     near), and every call queued behind it must apply the CURRENT selection
     — not the one it was made for — or the new map would fly through each
     stale place in turn before settling on the right one. */
  const loc = state.loc;
  const inst = MAPS[id];
  inst.map.resize();
  /* re-apply the "you are here" overlay on a map that was created after a fix */
  applyRememberedUserLocation(inst);
  /* setHTML rebuilds the popup's close button from the locale MapLibre captured
     at construction, so its label has to be re-applied after every refresh */
  inst.popup.setHTML(popupHtml(loc));
  applyMapControlLabels(inst.map);
  inst.marker.setLngLat([loc.lon, loc.lat]);
  updateSelectionArea(inst, loc);
  const key = `${loc.lat},${loc.lon}`;
  if (inst.lastKey !== key) {
    /* new location: replay the finite ping once, fly there, open the popup */
    inst.lastKey = key;
    /* replace the ping node so its finite CSS animation restarts once */
    const pinEl = inst.marker.getElement();
    const oldPing = pinEl.querySelector(".map-ping");
    if (oldPing) {
      const ping = document.createElement("span");
      ping.className = "map-ping";
      oldPing.replaceWith(ping);
    }
    /* bbox present (country/region/city extents) → frame the WHOLE area; else
       type-based zoom. normalizeBbox repairs an antimeridian-crossing box and
       rejects a degenerate near-360°-wide one, which would otherwise zoom out
       to the entire planet instead of showing the place. The box is only ever
       used for the camera — the visible boundary comes from real polygon
       geometry or from nothing at all (see applySelectionArea). */
    let cam = null;
    const bounds = normalizeBbox(loc.bbox);
    if (bounds) {
      try {
        cam = inst.map.cameraForBounds(bounds, { padding: 48, maxZoom: 14 });
      } catch {
        cam = null;
      }
    }
    /* A click on the map is already aimed at a point: moving the camera under
       the user's cursor would be disorienting. The one exception is a click
       that turned out to land on a whole country/state/province/region — then
       framing its full extent is the point of the selection. */
    const fromClick = inst.pendingClickKey === key;
    inst.pendingClickKey = null;
    const keepCamera = fromClick && !(cam && isAdministrativeArea(loc));

    if (keepCamera) {
      /* nothing to do: the marker is already where the user clicked */
    } else if (cam)
      inst.map.flyTo({ center: cam.center, zoom: cam.zoom, bearing: 0, pitch: 0, duration: 1100 });
    else
      inst.map.flyTo({
        center: [loc.lon, loc.lat],
        zoom: zoomFor(loc),
        bearing: 0,
        pitch: 0,
        duration: 1100,
      });
    if (cfg.autoPopup) {
      /* moveend never fires when the map is already at the target — timer fallback */
      const open = () => {
        if (!inst.popup.isOpen()) inst.marker.togglePopup();
        /* MapLibre popups don't auto-pan like Leaflet: nudge the map if the
           popup pokes out of the container (small maps on phones) */
        requestAnimationFrame(() => {
          const popupEl = inst.popup.getElement && inst.popup.getElement();
          if (!popupEl) return;
          const pr = popupEl.getBoundingClientRect();
          const mr = inst.map.getContainer().getBoundingClientRect();
          const dy = pr.top - (mr.top + 10);
          if (dy < 0) inst.map.panBy([0, dy], { duration: 300 });
        });
      };
      inst.map.once("moveend", open);
      setTimeout(() => {
        inst.map.off("moveend", open);
        open();
      }, 1400);
    }
  }
  /* A shared link's camera wins over the selection's own framing: it is the
     view the sender chose to share. Applied last, and only once. */
  applyPendingCamera(id);
  /* same location (language/unit change): popup content refreshed above,
     user's zoom and center untouched */
}
