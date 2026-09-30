/* Spanish is a complete third language, not English with a few labels swapped:
 * every English key has its own Spanish value, so the interface never falls
 * back to English (core/i18n.js t() would otherwise do so silently). */
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
  "modeSimple", // Simple
  "normalPressure", // Normal
  "factCapital", // Capital
  "footBlog", // Blog
  "mapTimePlus3", // +3 h …
  "mapTimePlus6",
  "mapTimePlus12",
  "mapTimePlus24",
  "mapAqiPm25", // PM2.5 / PM10
  "mapAqiPm10",
]);

describe("Spanish dictionary", () => {
  it("has exactly the keys English has — none missing, none stray", () => {
    const es = Object.keys(I18N.es);
    expect(enKeys.filter((key) => !(key in I18N.es))).toEqual([]);
    expect(es.filter((key) => !(key in I18N.en))).toEqual([]);
  });

  it("never leaves a value empty", () => {
    const empty = enKeys.filter((key) => {
      const value = I18N.es[key];
      return Array.isArray(value) ? value.some((item) => !item) : !String(value).trim();
    });
    expect(empty).toEqual([]);
  });

  it("does not lean on English: a value equal to English is a known cognate", () => {
    const copied = enKeys.filter(
      (key) => typeof I18N.en[key] === "string" && I18N.es[key] === I18N.en[key],
    );
    expect(copied.filter((key) => !SAME_AS_ENGLISH.has(key))).toEqual([]);
  });

  it("keeps every placeholder exactly as English writes it", () => {
    const changed = enKeys
      .filter((key) => typeof I18N.en[key] === "string")
      .filter((key) => placeholders(I18N.en[key]).join() !== placeholders(I18N.es[key]).join());
    expect(changed).toEqual([]);
    /* spot checks on the ones the interface fills in most */
    expect(I18N.es.searchMore).toContain("{n}");
    expect(I18N.es.openLocation).toContain("{name}");
    expect(I18N.es.advExtremeHeatDesc).toContain("{value}");
    expect(I18N.es.mapAlertsSource).toContain("{name}");
    expect(I18N.es.compareSource).toContain("{provider}");
    expect(I18N.es.photoCredit).toContain("{photographer}");
    expect(I18N.es.photoCreditUnsplash).toContain("{photographer}");
  });

  it("keeps the arrays: seven days, seven short days, twelve months", () => {
    expect(I18N.es.days).toHaveLength(7);
    expect(I18N.es.daysShort).toHaveLength(7);
    expect(I18N.es.months).toHaveLength(12);
    expect(I18N.es.days[0]).toBe("Domingo");
    expect(I18N.es.daysShort[6]).toBe("Sáb");
    expect(I18N.es.months[11]).toBe("Dic");
    expect(new Set(I18N.es.days).size).toBe(7);
    expect(new Set(I18N.es.months).size).toBe(12);
  });

  for (const attr of [
    "data-i18n",
    "data-i18n-ph",
    "data-i18n-aria",
    "data-i18n-title",
    "data-i18n-tip",
  ]) {
    it(`resolves every ${attr} key of the markup in Spanish`, () => {
      expect(keysUsedInMarkup(attr).filter((key) => I18N.es[key] === undefined)).toEqual([]);
    });
  }

  it("names the map layers and their states", () => {
    expect(I18N.es.temperature).toBe("Temperatura");
    expect(I18N.es.rain).toBe("Lluvia");
    expect(I18N.es.wind).toBe("Viento");
    expect(I18N.es.mapClouds).toBe("Nubes");
    expect(I18N.es.pressure).toBe("Presión");
    expect(I18N.es.humidity).toBe("Humedad");
    expect(I18N.es.airQuality).toBe("Calidad del aire");
    expect(I18N.es.mapAlerts).toBe("Alertas");
    expect(I18N.es.mapLightning).toBe("Rayos");
  });

  it("leaves provider and product names alone", () => {
    expect(I18N.es.mapAqiProvider).toBe("Fuente: Open-Meteo");
    expect(I18N.es.mapLightningProvider).toContain("Xweather");
    expect(I18N.es.tipLayerClouds).toContain("OpenWeatherMap");
    expect(I18N.es.mapAlertsOfficial).toContain("NWS");
    expect(I18N.es.footerData).toBe("Datos: Open-Meteo · OpenStreetMap · MapTiler");
    expect(I18N.es.aboutTitle2).toContain("Saint-Pierre Weather");
  });

  it("does not change English or French", () => {
    expect(I18N.en.navHome).toBe("Home");
    expect(I18N.en.hourNow).toBe("Now");
    expect(I18N.fr.navHome).toBe("Accueil");
    expect(I18N.fr.hourNow).toBe("Maint.");
  });
});
