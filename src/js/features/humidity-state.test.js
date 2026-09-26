import { describe, it, expect } from "vitest";
import { computeHumidityState } from "./humidity-state.js";

const LOC = { lat: 48.8566, lon: 2.3522 };
const updatedAt = new Date("2026-09-22T10:00:00Z");
const NOW = Date.UTC(2026, 8, 22, 10, 0, 0);
const HOUR = 3600 * 1000;

/* wx.hourly starts at the current hour: entry N is N hours ahead. */
const hourlyHumidity = (count) =>
  Array.from({ length: count }, (_, hour) => ({ time: `h${hour}`, humidity: 50 + hour }));
const run = (wx, offset) =>
  computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false, offset, nowMs: NOW });

describe("computeHumidityState", () => {
  it("is unavailable when there is no selected place", () => {
    expect(computeHumidityState({ loc: null, wx: null, isDemo: false, offline: false })).toEqual({
      status: "error",
      data: null,
      errorKind: "unavailable",
      offsets: [],
    });
  });

  it("is loading while the forecast has not landed yet", () => {
    expect(computeHumidityState({ loc: LOC, wx: null, isDemo: false, offline: false })).toEqual({
      status: "loading",
      data: null,
      errorKind: null,
      offsets: [],
    });
  });

  it("is ready with the real reading once the forecast has loaded", () => {
    const wx = { current: { humidity: 62 }, updatedAt };
    expect(
      computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false, nowMs: NOW }),
    ).toEqual({
      status: "ready",
      data: { humidity: 62, updatedAt, offset: 0, timeMs: NOW },
      errorKind: null,
      offsets: [0],
    });
  });

  it("never shows the fabricated demo number — offline when the browser is offline", () => {
    const wx = { current: { humidity: 40 }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: true, offline: true })).toEqual({
      status: "error",
      data: null,
      errorKind: "offline",
      offsets: [],
    });
  });

  it("reports a generic error when demo data was used for any other reason", () => {
    const wx = { current: { humidity: 40 }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: true, offline: false })).toEqual({
      status: "error",
      data: null,
      errorKind: "error",
      offsets: [],
    });
  });

  it("is unavailable when the forecast loaded but omitted humidity", () => {
    const wx = { current: {}, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false })).toEqual({
      status: "error",
      data: null,
      errorKind: "unavailable",
      offsets: [],
    });
  });

  it("is unavailable for a non-finite humidity value", () => {
    const wx = { current: { humidity: NaN }, updatedAt };
    expect(computeHumidityState({ loc: LOC, wx, isDemo: false, offline: false }).errorKind).toBe(
      "unavailable",
    );
  });
});

describe("computeHumidityState at a forecast hour", () => {
  const wx = { current: { humidity: 62 }, hourly: hourlyHumidity(25), updatedAt };

  it("reads 'now' from the current reading, not from the hourly array", () => {
    expect(run(wx, 0).data).toMatchObject({ humidity: 62, timeMs: NOW });
  });

  it.each([
    [3, 53],
    [6, 56],
    [12, 62],
    [24, 74],
  ])("reads +%i h from that hourly entry", (offset, humidity) => {
    expect(run(wx, offset).data).toEqual({
      humidity,
      updatedAt,
      offset,
      timeMs: NOW + offset * HOUR,
    });
  });

  it("offers every hour the hourly data reaches", () => {
    expect(run(wx, 3).offsets).toEqual([0, 3, 6, 12, 24]);
  });

  it("disables the hours past the end of a short forecast", () => {
    const short = { ...wx, hourly: hourlyHumidity(13) };
    expect(run(short, 3).offsets).toEqual([0, 3, 6, 12]);
  });

  it("is unavailable, never a neighbouring hour, when the chosen hour is past the end", () => {
    const short = { ...wx, hourly: hourlyHumidity(13) };
    expect(run(short, 24)).toEqual({
      status: "error",
      data: null,
      errorKind: "unavailable",
      offsets: [0, 3, 6, 12],
    });
  });

  it("is unavailable at an hour whose own humidity is missing", () => {
    const gappy = { ...wx, hourly: hourlyHumidity(25) };
    gappy.hourly[6].humidity = null;
    expect(run(gappy, 6).errorKind).toBe("unavailable");
    expect(run(gappy, 6).offsets).not.toContain(6);
    expect(run(gappy, 3).status).toBe("ready");
  });

  it("is unavailable, with the later hours still offered, when only 'now' is missing", () => {
    const noCurrent = { ...wx, current: {} };
    expect(run(noCurrent, 0).errorKind).toBe("unavailable");
    expect(run(noCurrent, 0).offsets).toEqual([3, 6, 12, 24]);
    expect(run(noCurrent, 3).status).toBe("ready");
  });

  it("has no later hours when the forecast carries no hourly array", () => {
    const noHourly = { current: { humidity: 62 }, updatedAt };
    expect(run(noHourly, 0).offsets).toEqual([0]);
    expect(run(noHourly, 6).errorKind).toBe("unavailable");
  });

  it("never shows the demo forecast's hours as real", () => {
    expect(
      computeHumidityState({ loc: LOC, wx, isDemo: true, offline: false, offset: 6 }),
    ).toMatchObject({ status: "error", data: null, errorKind: "error" });
  });
});
