/* When a weather effect may exist — and, above all, when it may NOT.
 * Pure functions on plain objects: no DOM, no network. */
import { describe, it, expect } from "vitest";
import {
  SNOW_CODES,
  SNOW_MAX_TEMP_C,
  FLAKE_BUDGET,
  snowEffect,
  lightningEffect,
  oceanEffect,
  waveIntensity,
  heroEffects,
  flakeCount,
  motionMode,
} from "./weather-effects.js";

const snowy = (over = {}) => ({ code: 73, temp: -3, precip: 1.2, snowfall: 1.4, ...over });
const CITY = { id: "paris", kind: "city", name: { en: "Paris", fr: "Paris" } };
const SEA = { id: "sea", kind: "ocean", name: { en: "Atlantic Ocean", fr: "Océan Atlantique" } };

describe("snow — real condition, cold air, measured precipitation", () => {
  it("falls when the code says snow, it is freezing and precipitation was measured", () => {
    expect(snowEffect(snowy())).toMatchObject({ active: true, reason: "snow", intensity: 2 });
  });

  it("takes its intensity from the code's own wording", () => {
    expect(snowEffect(snowy({ code: 71 })).intensity).toBe(1);
    expect(snowEffect(snowy({ code: 85 })).intensity).toBe(1);
    expect(snowEffect(snowy({ code: 75 })).intensity).toBe(3);
    expect(snowEffect(snowy({ code: 86 })).intensity).toBe(3);
  });

  it("never snows in rain, clear or cloudy weather, or an unknown code", () => {
    for (const code of [0, 1, 2, 3, 45, 51, 61, 63, 65, 66, 80, 81, 82, 95, 99, 1234]) {
      expect(snowEffect(snowy({ code })), `code ${code}`).toMatchObject({
        active: false,
        reason: "not-snow",
      });
    }
  });

  it("does not snow above freezing-ish temperatures, even if the code says snow", () => {
    expect(snowEffect(snowy({ temp: SNOW_MAX_TEMP_C })).active).toBe(true);
    expect(snowEffect(snowy({ temp: SNOW_MAX_TEMP_C + 0.1 }))).toMatchObject({
      active: false,
      reason: "too-warm",
    });
    expect(snowEffect(snowy({ temp: 12 })).reason).toBe("too-warm");
  });

  it("needs a temperature — a missing one is not 'cold enough'", () => {
    for (const temp of [null, undefined, NaN, "cold"]) {
      expect(snowEffect(snowy({ temp })), String(temp)).toMatchObject({
        active: false,
        reason: "no-temperature",
      });
    }
  });

  it("needs a precipitation reading — a missing one is not 'some'", () => {
    expect(snowEffect(snowy({ precip: null, snowfall: null }))).toMatchObject({
      active: false,
      reason: "no-precipitation-data",
    });
    expect(snowEffect(snowy({ precip: undefined, snowfall: undefined })).active).toBe(false);
  });

  it("does not snow when the measured precipitation is zero", () => {
    expect(snowEffect(snowy({ precip: 0, snowfall: 0 }))).toMatchObject({
      active: false,
      reason: "no-precipitation",
    });
  });

  it("accepts either measured field on its own", () => {
    expect(snowEffect(snowy({ precip: null, snowfall: 0.6 })).active).toBe(true);
    expect(snowEffect(snowy({ precip: 0.4, snowfall: null })).active).toBe(true);
  });

  it("is not switched on by a rain probability", () => {
    expect(snowEffect({ code: 61, temp: -2, precip: 1, rainProb: 100 }).active).toBe(false);
  });

  it("produces nothing without weather", () => {
    for (const current of [null, undefined, {}, "x"]) {
      expect(snowEffect(current).active).toBe(false);
    }
    expect(snowEffect({}).reason).toBe("no-condition");
  });

  it("covers exactly the WMO snow family", () => {
    expect([...SNOW_CODES].sort((a, b) => a - b)).toEqual([71, 73, 75, 77, 85, 86]);
  });
});

describe("lightning — only when the data says thunderstorm", () => {
  it("shows for thunderstorm codes", () => {
    for (const code of [95, 96, 99]) {
      expect(lightningEffect({ code }), `code ${code}`).toMatchObject({ active: true });
    }
  });

  it("is never inferred from rain, however heavy", () => {
    for (const code of [51, 55, 61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(lightningEffect({ code }).active, `code ${code}`).toBe(false);
    }
  });

  it("is never inferred from wind, pressure or a rain probability", () => {
    const wild = { code: 65, gust: 140, windSpeed: 90, pressure: 950, rainProb: 100 };
    expect(lightningEffect(wild)).toMatchObject({ active: false, reason: "not-thunderstorm" });
  });

  it("is off when the condition is missing", () => {
    expect(lightningEffect({}).reason).toBe("no-condition");
    expect(lightningEffect({ code: null }).active).toBe(false);
    expect(lightningEffect(null).reason).toBe("no-weather");
    expect(lightningEffect(undefined).active).toBe(false);
  });
});

describe("ocean — a property of the place, never of the weather", () => {
  it("is on for an ocean or a sea", () => {
    expect(oceanEffect(SEA).active).toBe(true);
    expect(oceanEffect({ kind: "sea" }).active).toBe(true);
  });

  it("is off for every land kind", () => {
    for (const kind of [
      "city",
      "town",
      "village",
      "region",
      "state",
      "country",
      "poi",
      "address",
    ]) {
      expect(oceanEffect({ kind }), kind).toMatchObject({ active: false, reason: "not-marine" });
    }
  });

  it("is off for an unnamed coordinate (a land location with a coordinate as its name)", () => {
    expect(oceanEffect({ kind: "city", coordsOnly: true }).active).toBe(false);
  });

  it("is off with no location", () => {
    expect(oceanEffect(null).reason).toBe("no-location");
  });

  it("follows the measured wind, and rests at calm without one", () => {
    expect(waveIntensity(5)).toBe(1);
    expect(waveIntensity(20)).toBe(2);
    expect(waveIntensity(50)).toBe(3);
    for (const wind of [null, undefined, NaN, "windy"]) expect(waveIntensity(wind)).toBe(1);
    expect(oceanEffect(SEA, { windSpeed: 50 }).intensity).toBe(3);
    expect(oceanEffect(SEA, {}).intensity).toBe(1);
  });
});

describe("heroEffects — everything at once, for one place", () => {
  it("draws nothing without weather", () => {
    expect(heroEffects({ loc: CITY, wx: null }).any).toBe(false);
    expect(heroEffects({}).any).toBe(false);
  });

  it("does not let demo (offline fallback) weather switch a condition on", () => {
    const wx = { current: snowy({ code: 95 }) };
    const fx = heroEffects({ loc: CITY, wx, isDemo: true });
    expect(fx.snow).toMatchObject({ active: false, reason: "demo-data" });
    expect(fx.lightning).toMatchObject({ active: false, reason: "demo-data" });
    expect(fx.any).toBe(false);
  });

  it("still shows the ocean in demo mode, at its calmest", () => {
    const fx = heroEffects({ loc: SEA, wx: { current: { windSpeed: 80 } }, isDemo: true });
    expect(fx.ocean).toMatchObject({ active: true, intensity: 1 });
  });

  it("an inland city in a thunderstorm gets lightning and no waves", () => {
    const fx = heroEffects({ loc: CITY, wx: { current: { code: 95, temp: 20 } } });
    expect(fx.lightning.active).toBe(true);
    expect(fx.ocean.active).toBe(false);
    expect(fx.snow.active).toBe(false);
  });

  it("an ocean in a snowstorm gets waves and snow together", () => {
    const fx = heroEffects({ loc: SEA, wx: { current: snowy() } });
    expect(fx.ocean.active).toBe(true);
    expect(fx.snow.active).toBe(true);
    expect(fx.any).toBe(true);
  });

  it("an ordinary sunny city gets nothing", () => {
    const fx = heroEffects({ loc: CITY, wx: { current: { code: 0, temp: 22, precip: 0 } } });
    expect(fx.any).toBe(false);
  });
});

describe("particle budget", () => {
  it("is smaller on a phone than on a desktop, at every intensity", () => {
    for (const intensity of [1, 2, 3]) {
      expect(flakeCount(intensity, { constrained: true })).toBeLessThan(flakeCount(intensity));
    }
  });

  it("grows with intensity and never exceeds the budget", () => {
    expect(flakeCount(1)).toBeLessThan(flakeCount(2));
    expect(flakeCount(2)).toBeLessThan(flakeCount(3));
    expect(flakeCount(3)).toBe(FLAKE_BUDGET.desktop);
    expect(flakeCount(3, { constrained: true })).toBe(FLAKE_BUDGET.constrained);
  });

  it("always draws at least a few flakes, and copes with a bogus intensity", () => {
    expect(flakeCount(1, { constrained: true })).toBeGreaterThanOrEqual(4);
    expect(flakeCount(99)).toBeGreaterThan(0);
  });
});

describe("motionMode — the same condition, moving or still", () => {
  it("animates only when allowed and supported", () => {
    expect(motionMode({ allowed: true, supported: true })).toBe("animated");
    expect(motionMode({ allowed: true })).toBe("animated");
  });

  it("falls back to a still when switched off, reduced, or unsupported", () => {
    expect(motionMode({ allowed: false })).toBe("static");
    expect(motionMode({ allowed: true, supported: false })).toBe("static");
    expect(motionMode()).toBe("static");
  });
});
