/* Every layer that draws a legend must be able to title it. Pressure once
 * shipped without a title key, so its legend read "undefined (hPa)". */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { LEGEND_LAYERS } from "../features/map-legend.js";
import { I18N } from "../data/translations.js";
import { LEGEND_TITLE_KEYS } from "./render-map-weather.js";

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
