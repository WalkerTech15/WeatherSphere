import { describe, it, expect } from "vitest";
import { computeHumidityState } from "./humidity-state.js";

const LOC = { lat: 48.8566, lon: 2.3522 };
const updatedAt = new Date("2026-09-22T10:00:00Z");

describe("computeHumidityState", () => {
  it("is unavailable when there is no selected place", () => {
    expect(computeHumidityState({ loc: null, wx: null, isDemo: false, offline: false })).toEqual({
      status: "error",
      data: null,
      errorKind: "unavailable",
    });
  });

  it("is loading while the forecast has not landed yet", () => {
    expect(computeHumidityState({ loc: LOC, wx: null, isDemo: false, offline: false })).toEqual({
      status: "loading",
      data: null,
      errorKind: null,
    });
  });

  it("is ready with the real reading once the forecast has loaded", () => {
    const wx = { current: { humidity: 62 }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false })).toEqual({
      status: "ready",
      data: { humidity: 62, updatedAt },
      errorKind: null,
    });
  });

  it("never shows the fabricated demo number — offline when the browser is offline", () => {
    const wx = { current: { humidity: 40 }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: true, offline: true })).toEqual({
      status: "error",
      data: null,
      errorKind: "offline",
    });
  });

  it("reports a generic error when demo data was used for any other reason", () => {
    const wx = { current: { humidity: 40 }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: true, offline: false })).toEqual({
      status: "error",
      data: null,
      errorKind: "error",
    });
  });

  it("is unavailable when the forecast loaded but omitted humidity", () => {
    const wx = { current: {}, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false })).toEqual({
      status: "error",
      data: null,
      errorKind: "unavailable",
    });
  });

  it("is unavailable for a non-finite humidity value", () => {
    const wx = { current: { humidity: NaN }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false }).errorKind).toBe(
      "unavailable",
    );
  });
});
