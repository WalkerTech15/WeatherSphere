/* Motion preferences: the device's reduced-motion setting always wins. */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  prefersReducedMotion,
  animationsAllowed,
  watchReducedMotion,
  isPageHidden,
  isConstrainedDevice,
} from "./motion.js";

/* A matchMedia stand-in: `matches` maps query → boolean, and each query keeps
   its own listeners so a test can flip the preference at runtime. */
function stubMatchMedia(matches = {}) {
  const listeners = new Map();
  const mqs = new Map();
  const get = (query) => {
    if (!mqs.has(query)) {
      listeners.set(query, new Set());
      mqs.set(query, {
        get matches() {
          return Boolean(matches[query]);
        },
        addEventListener: (_, fn) => listeners.get(query).add(fn),
        removeEventListener: (_, fn) => listeners.get(query).delete(fn),
      });
    }
    return mqs.get(query);
  };
  vi.stubGlobal("window", { matchMedia: (q) => get(q) });
  return {
    flip(query, value) {
      matches[query] = value;
      listeners.get(query)?.forEach((fn) => fn());
    },
    listenerCount: (query) => listeners.get(query)?.size ?? 0,
  };
}

const REDUCE = "(prefers-reduced-motion: reduce)";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("animationsAllowed", () => {
  it("allows motion when enabled and the device has no reduced-motion preference", () => {
    stubMatchMedia({ [REDUCE]: false });
    expect(animationsAllowed(true)).toBe(true);
  });

  it("never allows motion under prefers-reduced-motion, whatever the setting says", () => {
    stubMatchMedia({ [REDUCE]: true });
    expect(prefersReducedMotion()).toBe(true);
    expect(animationsAllowed(true)).toBe(false);
    expect(animationsAllowed(false)).toBe(false);
  });

  it("respects the visitor switching animations off", () => {
    stubMatchMedia({ [REDUCE]: false });
    for (const off of [false, 0, null, undefined, ""]) expect(animationsAllowed(off)).toBe(false);
  });

  it("does not crash where there is no matchMedia at all (treated as no preference)", () => {
    vi.stubGlobal("window", {});
    expect(prefersReducedMotion()).toBe(false);
    expect(animationsAllowed(true)).toBe(true);
  });
});

describe("watchReducedMotion", () => {
  it("tells the caller when the preference flips, with the new value", () => {
    const mm = stubMatchMedia({ [REDUCE]: false });
    const seen = [];
    watchReducedMotion((reduced) => seen.push(reduced));
    mm.flip(REDUCE, true);
    mm.flip(REDUCE, false);
    expect(seen).toEqual([true, false]);
  });

  it("stops listening when unsubscribed — no leaked listener", () => {
    const mm = stubMatchMedia({ [REDUCE]: false });
    const handler = vi.fn();
    const unsubscribe = watchReducedMotion(handler);
    expect(mm.listenerCount(REDUCE)).toBe(1);
    unsubscribe();
    expect(mm.listenerCount(REDUCE)).toBe(0);
    mm.flip(REDUCE, true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns a working no-op where matchMedia is unavailable", () => {
    vi.stubGlobal("window", {});
    expect(() => watchReducedMotion(() => {})()).not.toThrow();
  });
});

describe("isPageHidden", () => {
  it("reads document.hidden", () => {
    vi.stubGlobal("document", { hidden: true });
    expect(isPageHidden()).toBe(true);
    vi.stubGlobal("document", { hidden: false });
    expect(isPageHidden()).toBe(false);
  });

  it("is false where there is no document", () => {
    expect(isPageHidden()).toBe(false);
  });
});

describe("isConstrainedDevice", () => {
  it("is true on a phone-sized or touch-first screen", () => {
    stubMatchMedia({ "(max-width: 820px)": true });
    expect(isConstrainedDevice()).toBe(true);
    stubMatchMedia({ "(pointer: coarse)": true });
    expect(isConstrainedDevice()).toBe(true);
  });

  it("is false on a desktop, and where matchMedia is missing", () => {
    stubMatchMedia({});
    expect(isConstrainedDevice()).toBe(false);
    vi.stubGlobal("window", {});
    expect(isConstrainedDevice()).toBe(false);
  });
});
