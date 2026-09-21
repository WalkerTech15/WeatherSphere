/* The hero's optional weather effects: snow, lightning and ocean waves.
 *
 * WHAT DECIDES THEM. Nothing in this file decides anything: features/weather-
 * effects.js answers, from the real weather and the location's own
 * classification, which effects may exist. This file only draws what it was
 * told is allowed, and removes it the moment that stops being true.
 *
 * HOW THEY ARE DRAWN. A handful of absolutely-positioned elements moved with
 * CSS transform/opacity only (styles/components/weather-fx.css) — no canvas,
 * no requestAnimationFrame loop, no layout work. That is what keeps them cheap:
 * the browser's compositor animates them and there is no JavaScript running
 * per frame. The particle count is capped lower on phones.
 *
 * WHEN THEY MOVE. Only when the visitor has not switched animations off and
 * the device has not asked for reduced motion (core/motion.js). Otherwise the
 * same condition is drawn as a still (snow, waves) or not drawn at all
 * (lightning, which has no meaningful still). They pause while the tab is
 * hidden or the hero is scrolled out of view.
 *
 * WHEN THEY GO. clearAmbient() runs as a new location starts loading, so the
 * previous place's snow can never fall on the next place's hero, and
 * syncAmbient() only paints once that place's own weather has arrived. */
import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { on } from "../core/app-bus.js";
import {
  animationsAllowed,
  isConstrainedDevice,
  isPageHidden,
  watchReducedMotion,
} from "../core/motion.js";
import { heroEffects, flakeCount, motionMode } from "../features/weather-effects.js";

let signature = "";
let offscreen = false;
let bound = false;

function animationSupported() {
  try {
    return typeof CSS === "undefined" || typeof CSS.supports !== "function"
      ? true
      : CSS.supports("animation-name", "none");
  } catch {
    return true;
  }
}

/* Deterministic spread, not Math.random: the same location draws the same
   sky, so a repaint never reshuffles the flakes and tests are repeatable. */
function spread(index, salt) {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function el(className, vars = {}) {
  const node = document.createElement("i");
  node.className = className;
  for (const [name, value] of Object.entries(vars)) node.style.setProperty(name, value);
  return node;
}

function snowNodes(intensity) {
  const count = flakeCount(intensity, { constrained: isConstrainedDevice() });
  return Array.from({ length: count }, (_, i) => {
    const size = 3 + Math.round(spread(i, 1) * 3); /* 3–6 px */
    return el("fx-flake", {
      "--x": `${(spread(i, 2) * 100).toFixed(1)}%`,
      "--s": `${size}px`,
      "--d": `${(9 + spread(i, 3) * 8).toFixed(1)}s`,
      "--dl": `${(-spread(i, 4) * 14).toFixed(1)}s`,
      "--dr": `${Math.round((spread(i, 5) - 0.5) * 60)}px`,
      "--y": `${(spread(i, 6) * 92).toFixed(1)}%` /* where a still flake rests */,
    });
  });
}

function waveNodes(intensity) {
  /* rougher sea, faster swell */
  const seconds = { 1: 22, 2: 15, 3: 10 }[intensity] ?? 22;
  return ["a", "b"].map((layer) =>
    el(`fx-wave fx-wave--${layer}`, { "--wave-dur": `${seconds}s` }),
  );
}

function refreshPause() {
  const host = $("#heroFx");
  if (host) host.dataset.paused = String(isPageHidden() || offscreen);
}

export function clearAmbient() {
  const host = $("#heroFx");
  signature = "";
  if (!host) return;
  host.replaceChildren();
  host.hidden = true;
  delete host.dataset.fx;
  delete host.dataset.motion;
}

/**
 * Paint whatever the current location and weather call for.
 * @param {{force?:boolean}} [options]  repaint even if nothing changed (the
 *   animation setting or the device motion preference just flipped)
 */
export function syncAmbient({ force = false } = {}) {
  const host = $("#heroFx");
  if (!host) return;
  const { loc, wx, isDemo } = state;
  const effects = heroEffects({ loc, wx, isDemo });
  if (!effects.any) {
    clearAmbient();
    return;
  }

  const mode = motionMode({
    allowed: animationsAllowed(state.animations),
    supported: animationSupported(),
  });
  const constrained = isConstrainedDevice();
  const next = [
    loc.id,
    effects.snow.active ? `snow${effects.snow.intensity}` : "",
    effects.lightning.active ? "storm" : "",
    effects.ocean.active ? `sea${effects.ocean.intensity}` : "",
    mode,
    constrained ? "s" : "l",
  ].join("|");
  if (!force && next === signature) return;
  signature = next;

  const nodes = [];
  const kinds = [];
  if (effects.ocean.active) {
    kinds.push("ocean");
    nodes.push(...waveNodes(effects.ocean.intensity));
  }
  if (effects.snow.active) {
    kinds.push("snow");
    nodes.push(...snowNodes(effects.snow.intensity));
  }
  /* a still lightning bolt says nothing, so it exists only while moving */
  if (effects.lightning.active && mode === "animated") {
    kinds.push("lightning");
    nodes.push(el("fx-flash"));
  }
  if (nodes.length === 0) {
    clearAmbient();
    return;
  }

  host.replaceChildren(...nodes);
  host.dataset.fx = kinds.join(" ");
  host.dataset.motion = mode;
  host.hidden = false;
  refreshPause();
}

/* One-time wiring: the listeners below live as long as the page and act only
   on the single #heroFx element, so there is nothing per-location to leak. */
export function bindAmbient() {
  if (bound) return;
  bound = true;
  document.addEventListener("visibilitychange", refreshPause);

  const card = $("#heroCard");
  if (card && typeof IntersectionObserver === "function") {
    new IntersectionObserver((entries) => {
      offscreen = !entries[entries.length - 1].isIntersecting;
      refreshPause();
    }).observe(card);
  }

  /* the device preference can flip while the page is open */
  watchReducedMotion(() => syncAmbient({ force: true }));
  on("animations:changed", () => syncAmbient({ force: true }));
}
