/* Optional animation for the map's weather overlay.
 *
 * Nothing here draws anything. Both animations are the MapTiler weather
 * layers' OWN, running on the provider's real data:
 *
 *   rain   plays the real precipitation forecast frames (a time-lapse of the
 *          next few hours) through PrecipitationLayer.animateByFactor. The
 *          static rain layer is untouched until the visitor presses play, and
 *          stopping returns it to the exact time it was showing when they did.
 *   wind   is the WindLayer's particle motion. Its particles are already
 *          moved by the real wind field (speed AND direction) and are the
 *          layer's default behaviour; it continues whenever the Wind layer
 *          is selected, independently of the optional-effects setting.
 *
 * This file is the policy around them, kept free of `window`/`document` and
 * with injectable timers so it is testable against a fake layer:
 *   - when an animation is offered at all (`planMapAnimation`)
 *   - one controller that starts, pauses and stops it, and cleans up after
 *     itself (`createMapAnimator`)
 *
 * Costs are bounded on purpose: rain playback covers a 6 hour window, loops at
 * most RAIN_MAX_LOOPS times and then stops itself, and only one timer exists,
 * only while rain is playing. */
import { layerTimeRange } from "./map-timeline.js";

/* Animation seconds per real second: 1800 = half an hour of forecast per
   second, so the 6 hour window lasts 12 s. */
export const RAIN_PLAY_FACTOR = 1800;
export const RAIN_WINDOW_HOURS = 6;
/* Less forecast than this between "now" and the end of the loaded frames is
   not an animation, it is a picture. */
export const RAIN_MIN_SPAN_S = 3600;
export const RAIN_MAX_LOOPS = 3;
export const POLL_MS = 250;

/* Wind particle budget. maxAmount is a power-of-two grid edge (128 → 16 384
   particles); density is particles per 1000 px². A phone gets a quarter of the
   particles and less density: the field stays readable, the GPU stays cool. */
export const WIND_PARTICLES = {
  desktop: { maxAmount: 128, density: 2 },
  constrained: { maxAmount: 64, density: 1.4 },
};

export function windLayerOptions({ constrained = false } = {}) {
  return { ...(constrained ? WIND_PARTICLES.constrained : WIND_PARTICLES.desktop) };
}

/* The stretch of forecast the rain animation loops over: from now to +6 h,
   trimmed to the frames the provider actually has. null when the layer has
   too little forecast to animate honestly. Seconds, like the SDK. */
export function rainWindow(layer, nowMs = Date.now()) {
  const range = layerTimeRange(layer);
  if (!range) return null;
  const startMs = Math.max(range.startMs, Math.min(range.endMs, nowMs));
  const endMs = Math.min(range.endMs, nowMs + RAIN_WINDOW_HOURS * 3600 * 1000);
  const startSec = startMs / 1000;
  const endSec = endMs / 1000;
  return endSec - startSec >= RAIN_MIN_SPAN_S ? { startSec, endSec } : null;
}

/**
 * What animation, if any, the active overlay can honestly offer.
 *
 * @param {{type:string, status:string, layer:object, allowed:boolean, nowMs?:number}} input
 * @returns {{kind:"rain"|"wind"|null, available:boolean, reason:string}}
 *   kind       what the controller should drive (null → leave the layer alone)
 *   available  whether the layer can provide its animation
 */
export function planMapAnimation({ type, status, layer, allowed, nowMs } = {}) {
  const none = (reason) => ({ kind: null, available: false, reason });
  if (!layer) return none("no-layer");
  if (status !== "ready") return none("not-ready");

  if (type === "rain") {
    if (typeof layer.animateByFactor !== "function") return none("unsupported");
    if (!rainWindow(layer, nowMs)) return none("no-forecast-frames");
    return { kind: "rain", available: Boolean(allowed), reason: allowed ? "rain" : "not-allowed" };
  }
  if (type === "wind") {
    if (typeof layer.setRepaintOnPausedAnimation !== "function") return none("unsupported");
    return { kind: "wind", available: true, reason: "wind" };
  }
  return none("no-animation-for-layer");
}

/**
 * The single owner of animation state for the overlay on the map.
 *
 * @param {object} [deps]
 * @param {function} [deps.setTimer]    default setInterval
 * @param {function} [deps.clearTimer]  default clearInterval
 * @param {function} [deps.now]         default Date.now
 * @param {function} [deps.onState]     called when playing/available changes
 * @param {function} [deps.onTime]      (timeMs) called as rain playback advances,
 *                                      and once more with the time it returns to
 */
export function createMapAnimator({
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  now = () => Date.now(),
  onState,
  onTime,
} = {}) {
  let layer = null;
  let kind = null;
  let allowed = true;
  let windMotionAllowed = true;
  let playing = false;
  let loops = 0;
  let win = null;
  /* the forecast time the layer showed when playback began (seconds) */
  let origin = null;
  let timer = null;
  /* Why playback is suspended without the visitor having stopped it: a hidden
     tab, the map scrolled out of view. Independent of `playing`. */
  const suspended = new Set();

  const running = () =>
    playing && suspended.size === 0 && (kind === "wind" ? windMotionAllowed : allowed);

  function stopTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /* Push the wanted motion onto the layer, and keep the timer in step. */
  function apply() {
    if (layer) {
      try {
        if (kind === "rain") layer.animateByFactor(running() ? RAIN_PLAY_FACTOR : 0);
        else if (kind === "wind") layer.setRepaintOnPausedAnimation(running());
      } catch {
        /* the layer was removed while the module was resolving */
      }
    }
    if (kind === "rain" && running()) {
      if (timer === null) timer = setTimer(poll, POLL_MS);
    } else {
      stopTimer();
    }
  }

  function poll() {
    if (!layer || kind !== "rain" || !win) return;
    let t;
    try {
      t = layer.getAnimationTime();
    } catch {
      stop();
      return;
    }
    /* The SDK loops over its WHOLE range on its own; the loop that matters
       here is the 6 h window, so wrap (or finish) when it is passed. */
    if (t >= win.endSec || t < win.startSec - 1) {
      loops += 1;
      if (loops >= RAIN_MAX_LOOPS) {
        stop();
        return;
      }
      try {
        layer.setAnimationTime(win.startSec);
      } catch {
        stop();
        return;
      }
      t = win.startSec;
    }
    onTime?.(t * 1000);
  }

  function start() {
    if (!layer || !kind || playing || !allowed) return false;
    if (kind === "rain") {
      win = rainWindow(layer, now());
      if (!win) return false;
      loops = 0;
      try {
        origin = layer.getAnimationTime();
        layer.setAnimationTime(win.startSec);
      } catch {
        return false;
      }
    }
    playing = true;
    apply();
    onState?.();
    return true;
  }

  function stop() {
    if (!playing) return false;
    playing = false;
    loops = 0;
    apply();
    if (kind === "rain" && layer && Number.isFinite(origin)) {
      try {
        layer.setAnimationTime(origin);
        onTime?.(origin * 1000);
      } catch {
        /* layer gone */
      }
    }
    win = null;
    origin = null;
    onState?.();
    return true;
  }

  /**
   * A weather layer is on the map and ready. Replaces whatever was attached.
   * Wind starts moving whenever reduced motion permits it; rain waits for the
   * visitor's optional-effects setting.
   */
  function attach(nextLayer, plan, { isAllowed = true, windAllowed = true } = {}) {
    detach({ silent: true });
    layer = nextLayer;
    kind = plan?.kind ?? null;
    allowed = Boolean(isAllowed);
    windMotionAllowed = Boolean(windAllowed);
    if (kind === "wind") {
      playing = windMotionAllowed;
      apply();
    }
    onState?.();
  }

  /* The layer is going away (or a different one is coming): stop the timer
     and any playback, and forget the layer so nothing can call into it. */
  function detach({ silent = false } = {}) {
    if (layer && kind === "rain" && playing) {
      try {
        layer.animateByFactor(0);
      } catch {
        /* already removed */
      }
    }
    stopTimer();
    playing = false;
    loops = 0;
    win = null;
    origin = null;
    layer = null;
    kind = null;
    if (!silent) onState?.();
  }

  /* Settings or the device preference changed. */
  function setAllowed(next) {
    allowed = Boolean(next);
    if (kind !== "wind" && !allowed) stop();
    onState?.();
  }

  /* Reduced motion is a device preference, so it also governs wind even
     though the visitor's optional-effects setting does not. */
  function setWindAllowed(next) {
    windMotionAllowed = Boolean(next);
    if (kind === "wind") {
      playing = windMotionAllowed;
      apply();
    }
    onState?.();
  }

  /* Suspend/resume for a reason the visitor did not choose. */
  function suspend(reason) {
    if (suspended.has(reason)) return;
    suspended.add(reason);
    apply();
  }
  function resume(reason) {
    if (!suspended.delete(reason)) return;
    apply();
  }

  function toggle() {
    if (playing) {
      stop();
      return false;
    }
    return start();
  }

  function snapshot() {
    return {
      kind,
      playing,
      available: kind !== null && (kind === "wind" ? windMotionAllowed : allowed),
      suspended: suspended.size > 0,
    };
  }

  return {
    attach,
    detach,
    start,
    stop,
    toggle,
    setAllowed,
    setWindAllowed,
    suspend,
    resume,
    snapshot,
  };
}
