/* The pure half of the comparison table: unit-aware cell formatting and the
 * row model. The DOM half (picker wiring, remove buttons, keyboard) is
 * covered by e2e/comparison.spec.js. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state } from "../core/state.js";
import { formatComparisonCell, buildComparisonRows, comparisonView } from "./render-comparison.js";
import { COMPARISON_METRICS } from "../features/comparison.js";

const DASH = "—";

const FULL = {
  temp: 21.4,
  feelsLike: 19.8,
  humidity: 55.4,
  wind: 12.5,
  precipitation: 30.2,
  uv: 4.4,
  aqi: 21.6,
  timezone: "Europe/Paris",
};

const EMPTY = {
  temp: null,
  feelsLike: null,
  humidity: null,
  wind: null,
  precipitation: null,
  uv: null,
  aqi: null,
  timezone: null,
};

const originalLang = state.lang;
const originalTemp = state.unitTemp;
const originalWind = state.unitWind;

beforeEach(() => {
  state.lang = "en";
  state.unitTemp = "c";
  state.unitWind = "kmh";
});

afterEach(() => {
  state.lang = originalLang;
  state.unitTemp = originalTemp;
  state.unitWind = originalWind;
});

describe("formatComparisonCell", () => {
  it("formats temperature and feels-like in the chosen unit", () => {
    expect(formatComparisonCell("temperature", FULL)).toBe("21°C");
    expect(formatComparisonCell("feelsLike", FULL)).toBe("20°C");
    state.unitTemp = "f";
    expect(formatComparisonCell("temperature", FULL)).toBe("71°F");
  });

  it("formats wind in the chosen unit", () => {
    expect(formatComparisonCell("wind", FULL)).toBe("13 km/h");
    state.unitWind = "mph";
    expect(formatComparisonCell("wind", FULL)).toContain("mph");
  });

  it("formats percentages as whole numbers", () => {
    expect(formatComparisonCell("humidity", FULL)).toBe("55%");
    expect(formatComparisonCell("precipitation", FULL)).toBe("30%");
  });

  it("pairs the UV index with its descriptive band", () => {
    const cell = formatComparisonCell("uv", FULL);
    expect(cell).toMatch(/^4 · /);
    expect(cell.length).toBeGreaterThan(3);
  });

  it("shows air quality as a plain index value", () => {
    expect(formatComparisonCell("airQuality", FULL)).toBe("22");
  });

  it("shows the place's own local time", () => {
    expect(formatComparisonCell("localTime", FULL)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns an em dash for every missing value rather than 'null' or NaN", () => {
    for (const metric of COMPARISON_METRICS) {
      const cell = formatComparisonCell(metric, EMPTY);
      expect(cell, metric).toBe(DASH);
    }
  });

  it("returns an em dash for a missing entry entirely", () => {
    for (const metric of COMPARISON_METRICS) {
      expect(formatComparisonCell(metric, null), metric).toBe(DASH);
      expect(formatComparisonCell(metric, undefined), metric).toBe(DASH);
    }
  });

  it("treats a non-finite number as missing", () => {
    const broken = { ...FULL, temp: NaN, humidity: Infinity };
    expect(formatComparisonCell("temperature", broken)).toBe(DASH);
    expect(formatComparisonCell("humidity", broken)).toBe(DASH);
  });

  it("returns an em dash for an unknown metric instead of throwing", () => {
    expect(formatComparisonCell("nonsense", FULL)).toBe(DASH);
  });

  it("returns an em dash for an invalid time zone rather than crashing", () => {
    expect(formatComparisonCell("localTime", { timezone: "Not/AZone" })).toBe(DASH);
  });
});

describe("buildComparisonRows", () => {
  const paris = { id: "paris" };
  const tokyo = { id: "tokyo" };

  it("builds one row per metric, in the declared order", () => {
    const rows = buildComparisonRows([paris], { paris: FULL });
    expect(rows.map((r) => r.metric)).toEqual(COMPARISON_METRICS);
  });

  it("builds one cell per place, in column order", () => {
    const rows = buildComparisonRows([paris, tokyo], {
      paris: FULL,
      tokyo: { ...FULL, temp: 30 },
    });
    const temperature = rows.find((r) => r.metric === "temperature");
    expect(temperature.cells).toEqual(["21°C", "30°C"]);
  });

  it("gives every row a translated label", () => {
    state.lang = "en";
    const en = buildComparisonRows([paris], {}).map((r) => r.label);
    state.lang = "fr";
    const fr = buildComparisonRows([paris], {}).map((r) => r.label);

    expect(en).toContain("Temperature");
    expect(fr).toContain("Température");
    /* every label is real text, never a raw key */
    for (const label of [...en, ...fr]) {
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/^[a-z][a-zA-Z]+$/);
    }
  });

  it("fills the table with dashes when no weather has arrived yet", () => {
    const rows = buildComparisonRows([paris, tokyo], {});
    for (const row of rows) expect(row.cells).toEqual([DASH, DASH]);
  });

  it("returns rows with no cells for an empty selection", () => {
    const rows = buildComparisonRows([], {});
    expect(rows).toHaveLength(COMPARISON_METRICS.length);
    for (const row of rows) expect(row.cells).toEqual([]);
  });
});

describe("comparisonView — what a dash may mean", () => {
  const paris = { id: "paris", name: { en: "Paris", fr: "Paris" } };
  const tokyo = { id: "tokyo", name: { en: "Tokyo", fr: "Tokyo" } };
  const locs = [paris, tokyo];

  it("is ready when every place has values", () => {
    const view = comparisonView(locs, { paris: FULL, tokyo: FULL }, { status: "ready" });
    expect(view.state).toBe("ready");
    expect(view.columns).toEqual({ paris: "ready", tokyo: "ready" });
    expect(view.unavailable).toEqual([]);
  });

  it("is loading while the request is in flight, for every place without an entry", () => {
    const view = comparisonView(locs, {}, { status: "loading" });
    expect(view.state).toBe("loading");
    expect(view.columns).toEqual({ paris: "loading", tokyo: "loading" });
  });

  it("is loading before the first request has even started (idle)", () => {
    expect(comparisonView(locs, {}, { status: "idle" }).state).toBe("loading");
  });

  it("marks only the new column as loading when a place is added to weather already held", () => {
    const view = comparisonView(locs, { paris: FULL }, { status: "loading" });
    expect(view.columns).toEqual({ paris: "ready", tokyo: "loading" });
    expect(view.state).toBe("loading");
  });

  it("treats weather held for a different selection as still to come", () => {
    const view = comparisonView(locs, { paris: FULL }, { status: "ready", current: false });
    expect(view.columns.tokyo).toBe("loading");
  });

  it("is an error, with every column unavailable, when the request failed", () => {
    const view = comparisonView(locs, {}, { status: "error" });
    expect(view.state).toBe("error");
    expect(view.columns).toEqual({ paris: "unavailable", tokyo: "unavailable" });
    expect(view.unavailable).toEqual(locs);
  });

  it("does not show old numbers as if they were current after a failure", () => {
    const view = comparisonView(locs, { paris: FULL, tokyo: FULL }, { status: "error" });
    expect(view.state).toBe("error");
  });

  it("is partial when the provider had values for one place and nothing for another", () => {
    const view = comparisonView(locs, { paris: FULL, tokyo: EMPTY }, { status: "ready" });
    expect(view.state).toBe("partial");
    expect(view.columns).toEqual({ paris: "ready", tokyo: "unavailable" });
    expect(view.unavailable).toEqual([tokyo]);
  });

  it("is an error when the provider had nothing for any place", () => {
    const view = comparisonView(locs, { paris: EMPTY, tokyo: EMPTY }, { status: "ready" });
    expect(view.state).toBe("error");
  });

  it("does not count a time zone alone as weather", () => {
    const zoneOnly = { ...EMPTY, timezone: "Europe/Paris" };
    expect(comparisonView([paris], { paris: zoneOnly }, { status: "ready" }).state).toBe("error");
  });

  it("does not invent a value: a place ready on one metric only is still ready", () => {
    const onlyTemp = { ...EMPTY, temp: 12 };
    expect(comparisonView([paris], { paris: onlyTemp }, { status: "ready" }).state).toBe("ready");
  });

  it("flags a failed air-quality service only when the weather itself is fine", () => {
    const wx = { paris: FULL, tokyo: FULL };
    expect(comparisonView(locs, wx, { status: "ready", aqiFailed: true }).aqiFailed).toBe(true);
    expect(comparisonView(locs, wx, { status: "ready", aqiFailed: false }).aqiFailed).toBe(false);
    expect(comparisonView(locs, {}, { status: "error", aqiFailed: true }).aqiFailed).toBe(false);
  });

  it("ignores NaN and non-numbers as values", () => {
    const junk = { ...EMPTY, temp: NaN, humidity: "55", wind: undefined };
    expect(comparisonView([paris], { paris: junk }, { status: "ready" }).state).toBe("error");
  });
});

describe("buildComparisonRows — loading cells", () => {
  const paris = { id: "paris", name: { en: "Paris", fr: "Paris" } };
  const tokyo = { id: "tokyo", name: { en: "Tokyo", fr: "Tokyo" } };

  it("prints an ellipsis, not a dash, for a column still loading", () => {
    const rows = buildComparisonRows(
      [paris, tokyo],
      { paris: FULL },
      { paris: "ready", tokyo: "loading" },
    );
    for (const row of rows) {
      expect(row.cells[1]).toBe("…");
      expect(row.cells[0]).not.toBe("…");
    }
  });

  it("still prints a dash for a value a place genuinely lacks", () => {
    const rows = buildComparisonRows([paris], { paris: { ...FULL, uv: null } }, { paris: "ready" });
    expect(rows.find((row) => row.metric === "uv").cells[0]).toBe(DASH);
  });

  it("behaves exactly as before when no columns are given", () => {
    const rows = buildComparisonRows([paris], { paris: FULL });
    expect(rows.find((row) => row.metric === "temperature").cells[0]).toBe("21°C");
  });
});
