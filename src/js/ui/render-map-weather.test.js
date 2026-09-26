/* Every layer that draws a legend must be able to title it. Pressure once
 * shipped without a title key, so its legend read "undefined (hPa)".
 * The forecast-time row (now / +3 h / +6 h / +12 h / +24 h) is drawn here too,
 * for the ramp layers and for Humidity. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { LEGEND_LAYERS } from "../features/map-legend.js";
import { I18N } from "../data/translations.js";
import { TIME_OFFSETS } from "../features/map-timeline.js";
import { LEGEND_TITLE_KEYS, timelineHtml, rampTimelineView } from "./render-map-weather.js";

beforeEach(() => {
  state.lang = "en";
});

describe("legend titles", () => {
  it("has a title key for every layer that has a legend, and no stray ones", () => {
    expect(Object.keys(LEGEND_TITLE_KEYS).sort()).toEqual([...LEGEND_LAYERS].sort());
  });

  it.each(["en", "fr"])(
    "each key is a real translation in %s, never the key or 'undefined'",
    (lang) => {
      state.lang = lang;
      for (const layer of LEGEND_LAYERS) {
        const key = LEGEND_TITLE_KEYS[layer];
        expect(key, layer).toBeTypeOf("string");
        expect(I18N[lang][key], `${lang}.${key}`).toBeTruthy();
        expect(t(key), layer).not.toBe(key);
        expect(t(key)).not.toMatch(/undefined/);
      }
    },
  );

  it("titles Pressure 'Pressure' in English and 'Pression' in French", () => {
    expect(t(LEGEND_TITLE_KEYS.pressure)).toBe("Pressure");
    state.lang = "fr";
    expect(t(LEGEND_TITLE_KEYS.pressure)).toBe("Pression");
  });
});

/* the row's buttons as [{ offset, label, checked, tabindex, disabled }] */
function buttonsOf(html) {
  return [...html.matchAll(/<button class="map-time"[\s\S]*?<\/button>/g)].map(([tag]) => ({
    offset: Number(/data-map-time="(\d+)"/.exec(tag)[1]),
    label: />([^<]*)<\/button>/.exec(tag)[1],
    checked: /aria-checked="(\w+)"/.exec(tag)[1] === "true",
    tabindex: Number(/tabindex="(-?\d+)"/.exec(tag)[1]),
    disabled: /\sdisabled(\s|>)/.test(tag),
  }));
}

const NOW = Date.UTC(2026, 8, 22, 10, 0, 0);
const view = (over = {}) => ({
  offset: 0,
  status: "ready",
  offsets: TIME_OFFSETS,
  timeMs: NOW,
  clamped: false,
  ...over,
});

describe("the forecast-time row", () => {
  it("offers now, +3 h, +6 h, +12 h and +24 h, in that order, in one radio group", () => {
    const html = timelineHtml(view());
    expect(buttonsOf(html).map((b) => b.offset)).toEqual([0, 3, 6, 12, 24]);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(5);
  });

  it("labels the options in English and French", () => {
    expect(buttonsOf(timelineHtml(view())).map((b) => b.label)).toEqual([
      "Now",
      "+3 h",
      "+6 h",
      "+12 h",
      "+24 h",
    ]);
    state.lang = "fr";
    expect(buttonsOf(timelineHtml(view())).map((b) => b.label)).toEqual([
      "Maintenant",
      "+3 h",
      "+6 h",
      "+12 h",
      "+24 h",
    ]);
  });

  it("labels the group in both languages, never with the raw key", () => {
    expect(timelineHtml(view())).toContain('aria-label="Forecast time"');
    state.lang = "fr";
    expect(timelineHtml(view())).toContain('aria-label="Heure de prévision"');
  });

  it.each(TIME_OFFSETS)(
    "checks only +%i h when it is chosen, and makes it the one Tab stop",
    (offset) => {
      const buttons = buttonsOf(timelineHtml(view({ offset })));
      expect(buttons.filter((b) => b.checked).map((b) => b.offset)).toEqual([offset]);
      expect(buttons.filter((b) => b.tabindex === 0).map((b) => b.offset)).toEqual([offset]);
    },
  );

  it("disables the hours the data cannot reach, never silently repeating a neighbour", () => {
    const buttons = buttonsOf(timelineHtml(view({ offsets: [0, 3, 6] })));
    expect(buttons.filter((b) => b.disabled).map((b) => b.offset)).toEqual([12, 24]);
  });

  it("never disables the chosen hour, so keyboard focus is never stranded", () => {
    const buttons = buttonsOf(timelineHtml(view({ offset: 24, offsets: [0, 3] })));
    expect(buttons.find((b) => b.offset === 24).disabled).toBe(false);
    expect(buttons.filter((b) => b.disabled).map((b) => b.offset)).toEqual([6, 12]);
  });

  it("leaves every hour enabled while the reachable ones are not yet known", () => {
    const buttons = buttonsOf(timelineHtml(view({ status: "loading", offsets: null })));
    expect(buttons.some((b) => b.disabled)).toBe(false);
  });

  describe("its status line", () => {
    const status = (over) => /class="map-time-status"[^>]*>([^<]*)</.exec(timelineHtml(view(over)));

    it("names the moment shown", () => {
      expect(status()[1]).toMatch(/^Showing .+/);
      state.lang = "fr";
      expect(status()[1]).toMatch(/^Affichage : .+/);
    });

    it("says when it is the nearest available time", () => {
      expect(status({ clamped: true })[1]).toContain("nearest available forecast time");
    });

    it.each([
      ["loading", "Updating the weather overlay…"],
      ["error", "The weather overlay could not be updated."],
      ["unavailable", "Forecast times are unavailable for this layer."],
    ])("says %s in words", (kind, text) => {
      expect(status({ status: kind })[1]).toBe(text);
    });

    it("says unavailable, not a made-up time, when ready with no time", () => {
      expect(status({ timeMs: null })[1]).toBe("Forecast times are unavailable for this layer.");
    });

    it("marks only loading with the spinner hook", () => {
      expect(timelineHtml(view({ status: "loading" }))).toContain('data-loading="1"');
      expect(timelineHtml(view())).not.toContain("data-loading");
    });

    it("draws no status line at all for 'none', leaving the caller's own message", () => {
      expect(timelineHtml(view({ status: "none" }))).not.toContain("map-time-status");
    });
  });
});

describe("rampTimelineView", () => {
  const overlay = (over = {}) => ({
    type: "rain",
    status: "ready",
    offset: 6,
    offsets: [0, 3, 6],
    timeMs: NOW,
    clamped: false,
    ...over,
  });

  it("hands over the overlay's hour, reachable hours, time and clamping", () => {
    expect(rampTimelineView(overlay({ clamped: true }))).toEqual({
      offset: 6,
      status: "ready",
      offsets: [0, 3, 6],
      timeMs: NOW,
      clamped: true,
    });
  });

  it.each(["loading", "unavailable", "error"])(
    "does not trust the reachable hours while %s",
    (status) => {
      expect(rampTimelineView(overlay({ status })).offsets).toBeNull();
    },
  );
});
