/* Vietnamese is a complete fourth language, not English with a few labels
 * swapped: every English key has its own Vietnamese value, so the interface
 * never falls back to English (core/i18n.js t() would otherwise do so
 * silently). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { I18N } from "./translations.js";

const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
const keysUsedInMarkup = (attr) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);

const enKeys = Object.keys(I18N.en);
const placeholders = (value) => (String(value).match(/\{[a-zA-Z0-9]+\}/g) || []).sort();

/* Words that are the same in both languages, or a unit/number — not a gap. */
const SAME_AS_ENGLISH = new Set([
  "footBlog", // Blog
  "mapAqiPm25", // PM2.5 / PM10
  "mapAqiPm10",
]);

describe("Vietnamese dictionary", () => {
  it("has exactly the keys English has — none missing, none stray", () => {
    const vi = Object.keys(I18N.vi);
    expect(enKeys.filter((key) => !(key in I18N.vi))).toEqual([]);
    expect(vi.filter((key) => !(key in I18N.en))).toEqual([]);
  });

  it("never leaves a value empty", () => {
    const empty = enKeys.filter((key) => {
      const value = I18N.vi[key];
      return Array.isArray(value) ? value.some((item) => !item) : !String(value).trim();
    });
    expect(empty).toEqual([]);
  });

  it("does not lean on English: a value equal to English is a known cognate", () => {
    const copied = enKeys.filter(
      (key) => typeof I18N.en[key] === "string" && I18N.vi[key] === I18N.en[key],
    );
    expect(copied.filter((key) => !SAME_AS_ENGLISH.has(key))).toEqual([]);
  });

  it("keeps every placeholder exactly as English writes it", () => {
    const changed = enKeys
      .filter((key) => typeof I18N.en[key] === "string")
      .filter((key) => placeholders(I18N.en[key]).join() !== placeholders(I18N.vi[key]).join());
    expect(changed).toEqual([]);
    /* spot checks on the ones the interface fills in most */
    expect(I18N.vi.searchMore).toContain("{n}");
    expect(I18N.vi.openLocation).toContain("{name}");
    expect(I18N.vi.advExtremeHeatDesc).toContain("{value}");
    expect(I18N.vi.mapAlertsSource).toContain("{name}");
    expect(I18N.vi.compareSource).toContain("{provider}");
    expect(I18N.vi.photoCredit).toContain("{photographer}");
    expect(I18N.vi.photoCreditUnsplash).toContain("{photographer}");
  });

  it("keeps the arrays: seven days, seven short days, twelve months", () => {
    expect(I18N.vi.days).toHaveLength(7);
    expect(I18N.vi.daysShort).toHaveLength(7);
    expect(I18N.vi.months).toHaveLength(12);
    expect(I18N.vi.days[0]).toBe("Chủ Nhật");
    expect(I18N.vi.daysShort[0]).toBe("CN");
    expect(I18N.vi.months[8]).toBe("Thg 9");
    expect(new Set(I18N.vi.days).size).toBe(7);
    expect(new Set(I18N.vi.daysShort).size).toBe(7);
    expect(new Set(I18N.vi.months).size).toBe(12);
  });

  for (const attr of [
    "data-i18n",
    "data-i18n-ph",
    "data-i18n-aria",
    "data-i18n-title",
    "data-i18n-tip",
  ]) {
    it(`resolves every ${attr} key of the markup in Vietnamese`, () => {
      expect(keysUsedInMarkup(attr).filter((key) => I18N.vi[key] === undefined)).toEqual([]);
    });
  }

  it("names the map layers and their states", () => {
    expect(I18N.vi.temperature).toBe("Nhiệt độ");
    expect(I18N.vi.rain).toBe("Mưa");
    expect(I18N.vi.wind).toBe("Gió");
    expect(I18N.vi.mapClouds).toBe("Mây");
    expect(I18N.vi.pressure).toBe("Áp suất");
    expect(I18N.vi.humidity).toBe("Độ ẩm");
    expect(I18N.vi.airQuality).toBe("Chất lượng không khí");
    expect(I18N.vi.mapAlerts).toBe("Cảnh báo");
    expect(I18N.vi.mapLightning).toBe("Sét");
  });

  it("leaves provider and product names alone", () => {
    expect(I18N.vi.mapAqiProvider).toBe("Nguồn: Open-Meteo");
    expect(I18N.vi.mapLightningProvider).toContain("Xweather");
    expect(I18N.vi.tipLayerClouds).toContain("OpenWeatherMap");
    expect(I18N.vi.mapAlertsOfficial).toContain("NWS");
    expect(I18N.vi.footerData).toBe("Dữ liệu: Open-Meteo · OpenStreetMap · MapTiler");
    expect(I18N.vi.aboutTitle2).toContain("WeatherSphere");
  });

  it("preserves Vietnamese diacritics correctly (not mangled/stripped)", () => {
    /* Every one of these has at least one Vietnamese tone mark or letter with
       a diacritic — a mangled encoding would show up as "?" or a mis-decoded
       byte sequence, not as plain ASCII, so this also guards against a lossy
       save/read round trip. */
    for (const key of ["navHome", "navMap", "navForecast", "navFavorites", "setLang", "humidity"]) {
      expect(I18N.vi[key], key).toMatch(/[à-ỹÀ-Ỹ]/);
    }
    expect(I18N.vi.navHome).toBe("Trang chủ");
    expect(I18N.vi.setLang).toBe("Ngôn ngữ");
  });

  it("does not change English, French or Spanish", () => {
    expect(I18N.en.navHome).toBe("Home");
    expect(I18N.en.hourNow).toBe("Now");
    expect(I18N.fr.navHome).toBe("Accueil");
    expect(I18N.fr.hourNow).toBe("Maint.");
    expect(I18N.es.navHome).toBe("Inicio");
    expect(I18N.es.hourNow).toBe("Ahora");
  });
});
