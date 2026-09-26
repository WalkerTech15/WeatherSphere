/* What the map's overlay is showing right now, and the ramp weather layers
   (Temperature, Rain, Wind, Pressure) that ride on the MapTiler weather SDK.
   The other layers (Air Quality, Humidity, Alerts, Lightning, Clouds) each own
   a module of their own; they register here so this file never has to know
   about them. */
import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { emit, on } from "../core/app-bus.js";
import {
  animationsAllowed,
  isConstrainedDevice,
  isPageHidden,
  prefersReducedMotion,
  watchReducedMotion,
} from "../core/motion.js";
import { showToast } from "../ui/notifications.js";
import {
  WEATHER_LAYER_IDS,
  removeWeatherLayer,
  applyWeatherLayer,
  setWeatherLayerTime,
} from "./weather-layers.js";
import { normalizeOffset, availableOffsets } from "./map-timeline.js";
import { createMapAnimator, planMapAnimation, windLayerOptions } from "./map-animation.js";
import { renderWeatherOverlayUI, updateTimeStatus } from "../ui/render-map-weather.js";
import { MAPS } from "./map-registry.js";
import { updateMap } from "./map-instance.js";
import { raiseSelectionArea } from "./map-selection.js";

/* ── MapTiler weather overlay switcher ────────────────────────────────────
   Weather layers are loaded only after the user asks for one, keeping the
   heavier weather module out of the initial homepage bundle. Satellite is the
   Hybrid basemap itself, so returning to it simply removes the active overlay.
   The map-instance side of this (readiness wait, layer add/remove, stale-
   request guarding) lives in features/weather-layers.js, free of any
   window/document-touching import, so it's directly unit-testable; this file
   keeps only the DOM/button wiring. */
export function setLayerButtonState(active) {
  $$(".map-layer").forEach((button) => {
    const on = button.dataset.mapLayer === active;
    button.classList.toggle("is-active", on);
    button.classList.remove("is-loading");
    button.setAttribute("aria-checked", String(on));
    /* roving tabindex: the checked layer is the group's single Tab stop —
       see bindMapLayerControls() */
    if (!button.disabled) button.tabIndex = on ? 0 : -1;
  });
}

/* The one description of what the weather overlay is currently showing —
   read by the legend, the timeline and the URL serializer, so those three can
   never disagree about which layer or which forecast hour is active. */
export const overlay = {
  type: "satellite",
  status: "idle" /* idle | loading | ready | unavailable | error */,
  offset: 0,
  colorRamp: null,
  timeMs: null,
  clamped: false,
  offsets: [],
};

export function getMapOverlayState() {
  return { type: overlay.type, offset: overlay.offset, status: overlay.status };
}

/* The layers that are not a ramp: each registers its panel painter, the
   sentence a screen reader hears for it, and how to drop everything it holds
   when another layer is chosen. */
const overlayLayers = new Map();

export function registerOverlayLayer(type, { render, announcement, reset }) {
  overlayLayers.set(type, { render, announcement, reset });
}

/* The point-reading layers' results reach screen readers through the polite
   #mapLayerStatus region (see index.html). Written only when the sentence
   actually changes, so the many silent repaints — a language switch, a unit
   change, a replay tick — never re-announce the same reading; switching to
   a non-reading layer clears it, so coming back announces afresh. */
let lastLayerStatus = "";
export function announceLayerStatus(text) {
  if (text === lastLayerStatus) return;
  lastLayerStatus = text;
  const region = $("#mapLayerStatus");
  if (region) region.textContent = text;
}

export function renderWeatherOverlay() {
  overlay.animation = animator.snapshot();
  renderWeatherOverlayUI(overlay, {
    onSelectTime: setMapTime,
    onToggleAnimation: () => animator.toggle(),
  });
  const layer = overlayLayers.get(overlay.type);
  layer?.render();
  announceLayerStatus(layer ? layer.announcement() : "");
}

/* Optional animation of the active overlay — the rain forecast playing through,
   or the wind particles moving. The policy lives in features/map-animation.js;
   this owns the one instance and connects it to the overlay UI. Playback ends
   on a layer change, a time change, a hidden tab, a map scrolled out of view or
   optional animations being switched off, and never starts before the layer is ready. */
const animator = createMapAnimator({
  onState: () => renderWeatherOverlay(),
  /* also reports the time a stopped replay returns to, so the status line
     never names a time the layer is not showing */
  onTime: (timeMs) => {
    overlay.timeMs = timeMs;
    updateTimeStatus(overlay);
  },
});

const motionAllowed = () => animationsAllowed(state.animations);

/* The layer has just been ADDED, its data not yet ready. Reduced motion is
   the only preference that freezes wind; the optional-effects setting does
   not control the Wind layer. */
function freezeWindIfNotAllowed(inst) {
  if (!prefersReducedMotion() || inst.weatherLayerType !== "wind") return;
  try {
    inst.weatherLayer?.setRepaintOnPausedAnimation?.(false);
  } catch {
    /* layer already gone */
  }
}

function attachAnimation(inst) {
  const plan = planMapAnimation({
    type: overlay.type,
    status: overlay.status,
    layer: inst.weatherLayer,
    allowed: motionAllowed(),
  });
  animator.attach(inst.weatherLayer, plan, {
    isAllowed: motionAllowed(),
    windAllowed: !prefersReducedMotion(),
  });
}

/* Settings or the device preference changed. */
function syncMapAnimation() {
  animator.setAllowed(motionAllowed());
  animator.setWindAllowed(!prefersReducedMotion());
}

/* One-time wiring. Hidden tab and off-screen map both SUSPEND playback (and
   resume it) rather than stop it; the map card leaving the screen also covers
   switching to another view, because a hidden view is never intersecting. */
export function bindMapAnimation() {
  document.addEventListener("visibilitychange", () => {
    if (isPageHidden()) animator.suspend("hidden");
    else animator.resume("hidden");
  });
  const card = $("#mapCard");
  if (card && typeof IntersectionObserver === "function") {
    new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1].isIntersecting;
      if (visible) animator.resume("offscreen");
      else animator.suspend("offscreen");
    }).observe(card);
  }
  on("animations:changed", syncMapAnimation);
  watchReducedMotion(syncMapAnimation);
}

/* Whatever was animating belongs to the layer about to be replaced. */
export function detachOverlayAnimation() {
  animator.detach({ silent: true });
}

export function resetOverlay(type) {
  overlay.type = type;
  overlay.colorRamp = null;
  overlay.timeMs = null;
  overlay.clamped = false;
  overlay.offsets = [];
  if (type === "satellite") {
    /* returning to the basemap resets the clock too, so re-enabling a layer
       later starts from "now" rather than a forgotten +6 h */
    overlay.offset = 0;
    overlay.status = "idle";
  }
  /* leaving any other layer drops its reading and anything drawn for it, so a
     previous place's numbers, warning area or strikes can never linger — and
     re-selecting it later starts a fresh loading state */
  for (const [layerType, layer] of overlayLayers) {
    if (layerType !== type) layer.reset();
  }
}

/* Fold a weather-layers report into the overlay description. */
function absorbReport(report) {
  if (!report) return;
  overlay.colorRamp = report.colorRamp;
  overlay.timeMs = report.time?.timeMs ?? null;
  overlay.clamped = Boolean(report.time?.clamped);
  overlay.offsets = availableOffsets(report.layer);
  overlay.status = report.sourceReady && report.time?.available ? "ready" : "unavailable";
}

/* A single counter for BOTH layer changes and time changes: whichever the
   user asked for last is the only one allowed to finish, so a slow
   "temperature" cannot land after a fast "wind", and a queued "+6 h" cannot
   re-apply itself to a layer the user has already switched away from. */
let layerRequestId = 0;

/* Starts a layer or time request and makes every earlier one stale. Returns
   the check that request must make after each await. */
export function startLayerRequest() {
  const requestId = ++layerRequestId;
  return () => requestId !== layerRequestId;
}

export async function setRampLayer(type, { offset = overlay.offset } = {}) {
  const requested = WEATHER_LAYER_IDS[type] ? type : "satellite";
  const isStale = startLayerRequest();
  const button = $(`.map-layer[data-map-layer="${requested}"]`);
  button?.classList.add("is-loading");
  /* whatever was animating belongs to the layer about to be replaced */
  animator.detach({ silent: true });

  resetOverlay(requested);
  overlay.offset = requested === "satellite" ? 0 : normalizeOffset(offset);
  if (requested !== "satellite") overlay.status = "loading";
  renderWeatherOverlay();

  try {
    await updateMap("worldMap");
    const inst = MAPS.worldMap;
    if (!inst) throw new Error("Map unavailable");
    const report = await applyWeatherLayer(inst, requested, {
      isStale,
      onLayerAdded: (added) => {
        raiseSelectionArea(added);
        freezeWindIfNotAllowed(added);
      },
      offsetHours: overlay.offset,
      windOptions: windLayerOptions({ constrained: isConstrainedDevice() }),
    });
    if (isStale()) return;
    absorbReport(report);
    if (overlay.status === "ready") attachAnimation(inst);
    setLayerButtonState(requested);
    renderWeatherOverlay();
    emit("map:layer", getMapOverlayState());
  } catch {
    if (isStale()) return;
    animator.detach({ silent: true });
    removeWeatherLayer(MAPS.worldMap);
    resetOverlay("satellite");
    setLayerButtonState("satellite");
    renderWeatherOverlay();
    emit("map:layer", getMapOverlayState());
    showToast(t("mapLayerError"));
  } finally {
    /* the winning request's own setLayerButtonState() above already clears
       "is-loading" from every button; a superseded request clears just its
       own button immediately instead of leaving a stale spinner running
       until the newer request eventually finishes */
    if (isStale()) button?.classList.remove("is-loading");
  }
}

/* Move the active overlay to now / +3 h / +6 h. No layer is recreated: this
   is a setAnimationTime() call on the layer already on the map. */
export async function setMapTime(offsetHours) {
  const offset = normalizeOffset(offsetHours);
  if (overlay.type === "satellite") return; /* nothing to re-time */
  const isStale = startLayerRequest();

  overlay.offset = offset;
  /* choosing a forecast hour ends a rain replay; wind particles carry on */
  if (animator.snapshot().kind === "rain") animator.stop();
  overlay.status = "loading";
  renderWeatherOverlay();

  try {
    const report = await setWeatherLayerTime(MAPS.worldMap, offset, { isStale });
    if (isStale()) return;
    if (!report) {
      overlay.status = "unavailable";
      renderWeatherOverlay();
      return;
    }
    absorbReport(report);
    renderWeatherOverlay();
    emit("map:layer", getMapOverlayState());
  } catch {
    if (isStale()) return;
    overlay.status = "error";
    renderWeatherOverlay();
  }
}
