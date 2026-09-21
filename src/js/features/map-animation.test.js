/* The map overlay animator: when an animation is offered, and that it starts,
 * pauses, stops and cleans up correctly. Pure — a fake layer and fake timers. */
import { describe, it, expect, vi } from "vitest";
import {
  RAIN_PLAY_FACTOR,
  RAIN_MAX_LOOPS,
  RAIN_WINDOW_HOURS,
  POLL_MS,
  WIND_PARTICLES,
  windLayerOptions,
  rainWindow,
  planMapAnimation,
  createMapAnimator,
} from "./map-animation.js";

const HOUR = 3600;
const NOW_MS = Date.UTC(2024, 5, 15, 12, 0, 0);
const NOW_S = NOW_MS / 1000;

/* A stand-in for a MapTiler weather layer: the frames run from `start` to
   `end` (seconds), and every method the animator uses is recorded. */
function fakeLayer({ start = NOW_S - 3 * HOUR, end = NOW_S + 9 * HOUR, time = NOW_S } = {}) {
  const layer = {
    time,
    speed: 0,
    calls: [],
    getAnimationStart: () => start,
    getAnimationEnd: () => end,
    getAnimationTime: () => layer.time,
    setAnimationTime: (t) => {
      layer.calls.push(["setAnimationTime", t]);
      layer.time = t;
    },
    animateByFactor: (f) => {
      layer.calls.push(["animateByFactor", f]);
      layer.speed = f;
    },
    setRepaintOnPausedAnimation: (on) => layer.calls.push(["repaint", on]),
  };
  return layer;
}

/* Fake interval timers the test drives by hand. */
function fakeTimers() {
  const active = new Map();
  let next = 1;
  return {
    setTimer: (fn) => {
      const id = next++;
      active.set(id, fn);
      return id;
    },
    clearTimer: (id) => active.delete(id),
    count: () => active.size,
    tick: () => [...active.values()].forEach((fn) => fn()),
  };
}

function setup(overrides = {}) {
  const timers = fakeTimers();
  const onState = vi.fn();
  const onTime = vi.fn();
  const animator = createMapAnimator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => NOW_MS,
    onState,
    onTime,
    ...overrides,
  });
  return { animator, timers, onState, onTime };
}

const rainPlan = { kind: "rain", available: true };
const windPlan = { kind: "wind", available: true };

describe("wind particle budget", () => {
  it("gives a phone fewer particles and lower density than a desktop", () => {
    expect(WIND_PARTICLES.constrained.maxAmount).toBeLessThan(WIND_PARTICLES.desktop.maxAmount);
    expect(WIND_PARTICLES.constrained.density).toBeLessThan(WIND_PARTICLES.desktop.density);
    expect(windLayerOptions({ constrained: true })).toEqual(WIND_PARTICLES.constrained);
    expect(windLayerOptions()).toEqual(WIND_PARTICLES.desktop);
  });

  it("returns a copy, so nobody can mutate the shared budget", () => {
    windLayerOptions().maxAmount = 1;
    expect(WIND_PARTICLES.desktop.maxAmount).toBe(128);
  });
});

describe("rainWindow — the stretch of real forecast that is replayed", () => {
  it("runs from now to +6 h when the frames reach that far", () => {
    expect(rainWindow(fakeLayer(), NOW_MS)).toEqual({
      startSec: NOW_S,
      endSec: NOW_S + RAIN_WINDOW_HOURS * HOUR,
    });
  });

  it("is trimmed to the frames the provider actually has", () => {
    const layer = fakeLayer({ end: NOW_S + 2 * HOUR });
    expect(rainWindow(layer, NOW_MS).endSec).toBe(NOW_S + 2 * HOUR);
  });

  it("is refused when there is under an hour of forecast to play", () => {
    expect(rainWindow(fakeLayer({ end: NOW_S + 1800 }), NOW_MS)).toBeNull();
    expect(rainWindow(fakeLayer({ start: NOW_S, end: NOW_S }), NOW_MS)).toBeNull();
  });

  it("is refused when the layer has no frames at all", () => {
    expect(rainWindow({}, NOW_MS)).toBeNull();
    expect(rainWindow(null, NOW_MS)).toBeNull();
    expect(rainWindow(fakeLayer({ start: NaN, end: NaN }), NOW_MS)).toBeNull();
  });

  it("starts at the first frame when 'now' is before the forecast begins", () => {
    const layer = fakeLayer({ start: NOW_S + HOUR, end: NOW_S + 10 * HOUR });
    expect(rainWindow(layer, NOW_MS).startSec).toBe(NOW_S + HOUR);
  });
});

describe("planMapAnimation — what may be offered", () => {
  const base = { type: "rain", status: "ready", layer: fakeLayer(), allowed: true, nowMs: NOW_MS };

  it("offers rain playback when the precipitation frames are ready", () => {
    expect(planMapAnimation(base)).toMatchObject({ kind: "rain", available: true });
  });

  it("offers nothing for rain when precipitation data is not ready or has no frames", () => {
    expect(planMapAnimation({ ...base, status: "loading" })).toMatchObject({
      kind: null,
      reason: "not-ready",
    });
    for (const status of ["idle", "unavailable", "error"]) {
      expect(planMapAnimation({ ...base, status }).kind).toBe(null);
    }
    expect(planMapAnimation({ ...base, layer: fakeLayer({ end: NOW_S }) })).toMatchObject({
      kind: null,
      reason: "no-forecast-frames",
    });
  });

  it("offers nothing with no layer", () => {
    expect(planMapAnimation({ ...base, layer: null })).toMatchObject({
      kind: null,
      reason: "no-layer",
    });
  });

  it("keeps rain untouched but unavailable when motion is not allowed", () => {
    expect(planMapAnimation({ ...base, allowed: false })).toMatchObject({
      kind: "rain",
      available: false,
    });
  });

  it("offers wind particle motion independently of the optional-effects setting", () => {
    const wind = { ...base, type: "wind" };
    expect(planMapAnimation(wind)).toMatchObject({ kind: "wind", available: true });
    expect(planMapAnimation({ ...wind, allowed: false })).toMatchObject({
      kind: "wind",
      available: true,
    });
  });

  it("offers nothing for layers with no animation (temperature)", () => {
    expect(planMapAnimation({ ...base, type: "temperature" })).toMatchObject({
      kind: null,
      reason: "no-animation-for-layer",
    });
  });

  it("offers nothing on a layer that lacks the SDK methods", () => {
    expect(
      planMapAnimation({ ...base, layer: { ...fakeLayer(), animateByFactor: undefined } }).kind,
    ).toBe(null);
    expect(
      planMapAnimation({
        ...base,
        type: "wind",
        layer: { ...fakeLayer(), setRepaintOnPausedAnimation: undefined },
      }).kind,
    ).toBe(null);
  });
});

describe("rain playback", () => {
  it("does not start by itself — the static layer stays static until asked", () => {
    const { animator, timers } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    expect(animator.snapshot()).toMatchObject({ kind: "rain", playing: false, available: true });
    expect(layer.speed).toBe(0);
    expect(layer.calls).toEqual([]);
    expect(timers.count()).toBe(0);
  });

  it("plays the real frames from now at the set speed, with one timer", () => {
    const { animator, timers } = setup();
    const layer = fakeLayer({ time: NOW_S + 5 * HOUR });
    animator.attach(layer, rainPlan, { isAllowed: true });
    expect(animator.start()).toBe(true);
    expect(layer.time).toBe(NOW_S); /* began at the window start */
    expect(layer.speed).toBe(RAIN_PLAY_FACTOR);
    expect(timers.count()).toBe(1);
    expect(animator.snapshot().playing).toBe(true);
  });

  it("reports the advancing forecast time so the status line can follow it", () => {
    const { animator, timers, onTime } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    layer.time = NOW_S + 2 * HOUR;
    timers.tick();
    expect(onTime).toHaveBeenLastCalledWith((NOW_S + 2 * HOUR) * 1000);
  });

  it("wraps at the end of the 6 h window instead of running the whole forecast", () => {
    const { animator, timers } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    layer.time = NOW_S + 6 * HOUR + 60;
    timers.tick();
    expect(layer.time).toBe(NOW_S);
    expect(animator.snapshot().playing).toBe(true);
  });

  it("stops itself after a few loops and puts the layer back where it started", () => {
    const { animator, timers, onTime } = setup();
    const layer = fakeLayer({ time: NOW_S + 3 * HOUR });
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    for (let i = 0; i < RAIN_MAX_LOOPS; i++) {
      layer.time = NOW_S + 7 * HOUR;
      timers.tick();
    }
    expect(animator.snapshot().playing).toBe(false);
    expect(layer.speed).toBe(0);
    expect(timers.count()).toBe(0);
    expect(layer.time).toBe(NOW_S + 3 * HOUR);
    expect(onTime).toHaveBeenLastCalledWith((NOW_S + 3 * HOUR) * 1000);
  });

  it("stops on request, returns to the exact time it started at, and clears its timer", () => {
    const { animator, timers, onTime } = setup();
    const layer = fakeLayer({ time: NOW_S + 2 * HOUR });
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    layer.time = NOW_S + 4 * HOUR; /* playback moved on */
    expect(animator.stop()).toBe(true);
    expect(layer.speed).toBe(0);
    expect(layer.time).toBe(NOW_S + 2 * HOUR);
    /* the status line is told, so it never names a time the layer is not at */
    expect(onTime).toHaveBeenLastCalledWith((NOW_S + 2 * HOUR) * 1000);
    expect(timers.count()).toBe(0);
    expect(animator.stop()).toBe(false); /* stopping twice does nothing */
  });

  it("toggles", () => {
    const { animator } = setup();
    animator.attach(fakeLayer(), rainPlan, { isAllowed: true });
    expect(animator.toggle()).toBe(true);
    expect(animator.toggle()).toBe(false);
    expect(animator.snapshot().playing).toBe(false);
  });

  it("refuses to start with too little forecast, leaving the layer alone", () => {
    const { animator } = setup();
    const layer = fakeLayer({ end: NOW_S + 600 });
    animator.attach(layer, rainPlan, { isAllowed: true });
    expect(animator.start()).toBe(false);
    expect(layer.calls).toEqual([]);
  });

  it("refuses to start when motion is not allowed", () => {
    const { animator } = setup();
    animator.attach(fakeLayer(), { kind: "rain", available: false }, { isAllowed: false });
    expect(animator.snapshot().available).toBe(false);
    expect(animator.start()).toBe(false);
  });

  it("stops if the layer throws mid-playback rather than looping on a dead layer", () => {
    const { animator, timers } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    layer.getAnimationTime = () => {
      throw new Error("layer removed");
    };
    expect(() => timers.tick()).not.toThrow();
    expect(animator.snapshot().playing).toBe(false);
    expect(timers.count()).toBe(0);
  });
});

describe("wind particles", () => {
  it("move by default when allowed, as the layer always has", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, windPlan, { isAllowed: true });
    expect(layer.calls).toContainEqual(["repaint", true]);
    expect(animator.snapshot()).toMatchObject({ kind: "wind", playing: true, available: true });
  });

  it("continues when optional animations are disabled", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, { kind: "wind", available: false }, { isAllowed: false });
    expect(layer.calls).toContainEqual(["repaint", true]);
    expect(animator.snapshot()).toMatchObject({ playing: true, available: true });
  });

  it("stops only when reduced motion disables wind", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, windPlan, { isAllowed: false, windAllowed: false });
    expect(layer.calls).toContainEqual(["repaint", false]);
    expect(animator.snapshot()).toMatchObject({ playing: false, available: false });

    animator.setWindAllowed(true);
    expect(layer.calls).toContainEqual(["repaint", true]);
    expect(animator.snapshot()).toMatchObject({ playing: true, available: true });
  });

  it("pause and resume on request", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, windPlan, { isAllowed: true });
    animator.toggle();
    expect(layer.calls.at(-1)).toEqual(["repaint", false]);
    animator.toggle();
    expect(layer.calls.at(-1)).toEqual(["repaint", true]);
  });

  it("use no timer at all", () => {
    const { animator, timers } = setup();
    animator.attach(fakeLayer(), windPlan, { isAllowed: true });
    expect(timers.count()).toBe(0);
  });
});

describe("suspending for a hidden tab or an off-screen map", () => {
  it("pauses rain and its timer, and resumes without losing the visitor's choice", () => {
    const { animator, timers } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();

    animator.suspend("hidden");
    expect(layer.speed).toBe(0);
    expect(timers.count()).toBe(0);
    expect(animator.snapshot()).toMatchObject({ playing: true, suspended: true });

    animator.resume("hidden");
    expect(layer.speed).toBe(RAIN_PLAY_FACTOR);
    expect(timers.count()).toBe(1);
  });

  it("stays paused until EVERY reason has cleared", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    animator.suspend("hidden");
    animator.suspend("offscreen");
    animator.resume("hidden");
    expect(layer.speed).toBe(0);
    animator.resume("offscreen");
    expect(layer.speed).toBe(RAIN_PLAY_FACTOR);
  });

  it("freezes wind particles while hidden and restores them after", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, windPlan, { isAllowed: true });
    animator.suspend("hidden");
    expect(layer.calls.at(-1)).toEqual(["repaint", false]);
    animator.resume("hidden");
    expect(layer.calls.at(-1)).toEqual(["repaint", true]);
  });

  it("does not start playback by resuming — only the visitor starts rain", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.suspend("hidden");
    animator.resume("hidden");
    expect(layer.speed).toBe(0);
    expect(animator.snapshot().playing).toBe(false);
  });

  it("resuming a reason that was never set does nothing", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.resume("hidden");
    expect(layer.calls).toEqual([]);
  });
});

describe("reduced motion / animations switched off, at runtime", () => {
  it("stops a playing rain replay and hides the control", () => {
    const { animator } = setup();
    const layer = fakeLayer({ time: NOW_S + HOUR });
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    animator.setAllowed(false);
    expect(layer.speed).toBe(0);
    expect(layer.time).toBe(NOW_S + HOUR);
    expect(animator.snapshot()).toMatchObject({ playing: false, available: false });
  });

  it("freezes wind particles", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    animator.attach(layer, windPlan, { isAllowed: true });
    animator.setWindAllowed(false);
    expect(layer.calls.at(-1)).toEqual(["repaint", false]);
    expect(animator.snapshot().playing).toBe(false);
  });

  it("sets wind moving again when allowed again, but never auto-plays rain", () => {
    const wind = setup();
    const windLayer = fakeLayer();
    wind.animator.attach(windLayer, windPlan, { isAllowed: false });
    wind.animator.setAllowed(true);
    expect(windLayer.calls.at(-1)).toEqual(["repaint", true]);

    const rain = setup();
    const rainLayer = fakeLayer();
    rain.animator.attach(rainLayer, rainPlan, { isAllowed: false });
    rain.animator.setAllowed(true);
    expect(rainLayer.speed).toBe(0);
    expect(rain.animator.snapshot()).toMatchObject({ playing: false, available: true });
  });
});

describe("stale animation state — layer changes and cleanup", () => {
  it("detaching stops the old layer, clears the timer and forgets the layer", () => {
    const { animator, timers } = setup();
    const layer = fakeLayer({ time: NOW_S + HOUR });
    animator.attach(layer, rainPlan, { isAllowed: true });
    animator.start();
    animator.detach();
    expect(layer.speed).toBe(0);
    expect(timers.count()).toBe(0);
    expect(animator.snapshot()).toMatchObject({ kind: null, playing: false, available: false });
    /* the layer is being removed, so it is not "restored" to a time */
    expect(layer.time).toBe(NOW_S); /* left where the replay had it */
    /* and nothing more touches it */
    const before = layer.calls.length;
    animator.suspend("hidden");
    animator.resume("hidden");
    animator.setAllowed(true);
    expect(layer.calls.length).toBe(before);
  });

  it("attaching a new layer first ends the old layer's playback", () => {
    const { animator, timers } = setup();
    const oldLayer = fakeLayer();
    const newLayer = fakeLayer();
    animator.attach(oldLayer, rainPlan, { isAllowed: true });
    animator.start();
    animator.attach(newLayer, rainPlan, { isAllowed: true });
    expect(oldLayer.speed).toBe(0);
    expect(timers.count()).toBe(0);
    expect(animator.snapshot().playing).toBe(false);
    expect(newLayer.calls).toEqual([]);
  });

  it("rapid layer changes leave at most one timer and no playing state", () => {
    const { animator, timers } = setup();
    for (let i = 0; i < 12; i++) {
      animator.attach(fakeLayer(), rainPlan, { isAllowed: true });
      animator.start();
    }
    expect(timers.count()).toBe(1);
    animator.detach();
    expect(timers.count()).toBe(0);
  });

  it("detach on an animator that never had a layer is harmless", () => {
    const { animator } = setup();
    expect(() => animator.detach()).not.toThrow();
    expect(animator.stop()).toBe(false);
    expect(animator.start()).toBe(false);
  });

  it("survives a layer that has already been removed from the map", () => {
    const { animator } = setup();
    const layer = fakeLayer();
    layer.animateByFactor = () => {
      throw new Error("no map");
    };
    animator.attach(layer, rainPlan, { isAllowed: true });
    expect(() => {
      animator.start();
      animator.detach();
    }).not.toThrow();
  });

  it("uses a sensible poll rate", () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(100);
  });
});
