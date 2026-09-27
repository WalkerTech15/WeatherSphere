/* Spanish dates, times and place names — the formatting that lives outside the
 * dictionary. English and French are checked beside it so a change here can
 * never bend them. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "./state.js";
import { fmtHour, fmtClock, fmtDay, fmtDate, fmtDateTime } from "./datetime.js";
import { locName, locCountry, locRegion, localText, localTimeStr, intlLocale } from "./location.js";
import { LOCATIONS, findLocations } from "../data/locations.js";
import { wxDesc, WMO } from "../data/weather-codes.js";
import { flagAlt } from "../data/flags.js";
import { t } from "./i18n.js";

const place = (id) => LOCATIONS.find((loc) => loc.id === id);

describe("Spanish date and time", () => {
  beforeEach(() => {
    state.lang = "es";
    state.clockFormat = "24";
    state.clockSeconds = false;
  });

  it("uses es-ES as its locale, and the others as before", () => {
    expect(intlLocale()).toBe("es-ES");
    state.lang = "fr";
    expect(intlLocale()).toBe("fr-FR");
    state.lang = "en";
    expect(intlLocale()).toBe("en-US");
  });

  it("writes hours the Spanish way (24-hour, 14:00)", () => {
    expect(fmtHour("2026-09-26T14:00")).toBe("14:00");
    expect(fmtHour("2026-09-26T00:00")).toBe("0:00");
    expect(fmtClock("2026-09-26T14:30")).toBe("14:30");
    expect(fmtClock("2026-09-26T07:05")).toBe("7:05");
  });

  it("writes a date as day then month (26 sep)", () => {
    expect(fmtDate("2026-09-26")).toBe("26 sep");
    expect(fmtDate("2026-01-05")).toBe("5 ene");
    expect(fmtDate("2026-12-31")).toBe("31 dic");
  });

  it("names the days in Spanish", () => {
    expect(fmtDay("2026-09-26", false)).toBe("Sábado");
    expect(fmtDay("2026-09-26")).toBe("Sáb");
    expect(fmtDay("2026-09-27")).toBe("Dom");
    expect(fmtDay("2026-09-28", false)).toBe("Lunes");
  });

  it("formats an absolute instant with Intl in es-ES", () => {
    const text = fmtDateTime(new Date(2026, 8, 26, 12, 30));
    expect(text).toMatch(/^sáb,? 26 sept?\.?,? 12:30$/i);
  });

  it("formats a city's local clock in 24-hour or 12-hour, per the setting", () => {
    expect(localTimeStr("Europe/Madrid")).toMatch(/^\d{2}:\d{2}$/);
    state.clockFormat = "12";
    expect(localTimeStr("Europe/Madrid")).toMatch(/^\d{1,2}:\d{2}\s?[ap]\.\s?m\.$/i);
    expect(localTimeStr("Not/AZone")).toBeNull();
  });

  it("leaves English and French formatting unchanged", () => {
    state.lang = "en";
    expect(fmtHour("2026-09-26T14:00")).toBe("2 PM");
    expect(fmtClock("2026-09-26T14:30")).toBe("2:30 PM");
    expect(fmtDate("2026-09-26")).toBe("Sep 26");
    state.lang = "fr";
    expect(fmtHour("2026-09-26T14:00")).toBe("14 h");
    expect(fmtClock("2026-09-26T14:30")).toBe("14 h 30");
    expect(fmtDate("2026-09-26")).toBe("26 sept");
  });
});

describe("Spanish places and weather", () => {
  beforeEach(() => {
    state.lang = "es";
  });

  it("names curated cities and landmarks in Spanish", () => {
    expect(locName(place("tokyo"))).toBe("Tokio");
    expect(locName(place("paris"))).toBe("París");
    expect(locName(place("newyork"))).toBe("Nueva York");
    expect(localText(place("paris").landmark)).toBe("Torre Eiffel");
    expect(localText(place("lourdes").landmark)).toBe("Santuario de Nuestra Señora de Lourdes");
  });

  it("names countries through Intl, and keeps accurate regions", () => {
    expect(locCountry(place("france"))).toBe("Francia");
    expect(locCountry(place("paris"))).toBe("Francia");
    expect(locCountry(place("japan"))).toBe("Japón");
    expect(locCountry(place("newyork"))).toBe("Estados Unidos");
    expect(locRegion(place("lourdes"))).toBe("Occitania");
    expect(locRegion(place("texas"))).toBe("El Sur");
  });

  it("prefers a Spanish name the geocoder supplied", () => {
    const field = { en: "Munich", fr: "Munich", es: "Múnich" };
    expect(localText(field)).toBe("Múnich");
    state.lang = "en";
    expect(localText(field)).toBe("Munich");
  });

  it("falls back to the written name for a place with no Spanish one, never to nothing", () => {
    expect(localText({ en: "Tarbes", fr: "Tarbes" })).toBe("Tarbes");
    expect(localText(undefined)).toBe("");
    expect(localText({ en: "", fr: "Ici" })).toBe("Ici");
  });

  it("finds curated places by their Spanish names, with or without accents", () => {
    const first = (query) => findLocations(query, "es")[0]?.id;
    expect(first("Tokio")).toBe("tokyo");
    expect(first("nueva york")).toBe("newyork");
    expect(first("Londres")).toBe("london");
    expect(first("Japón")).toBe("japan");
    expect(first("japon")).toBe("japan");
    expect(first("Alemania")).toBe("germany");
    expect(first("Estados Unidos")).toBe("usa");
  });

  it("describes every WMO code in Spanish", () => {
    for (const code of Object.keys(WMO)) {
      expect(wxDesc(Number(code), "es"), `WMO ${code}`).toBeTruthy();
      expect(wxDesc(Number(code), "es"), `WMO ${code}`).not.toBe(wxDesc(Number(code), "en"));
    }
    expect(wxDesc(0, "es")).toBe("Cielo despejado");
    expect(wxDesc(95, "es")).toBe("Tormenta");
    expect(wxDesc(0, "en")).toBe("Clear sky");
    expect(wxDesc(0, "fr")).toBe("Ciel dégagé");
  });

  it("labels a flag in Spanish, and reads the interface through t()", () => {
    expect(flagAlt("ES", "es")).toBe("Bandera: ES");
    expect(flagAlt("ES", "fr")).toBe("Drapeau : ES");
    expect(flagAlt("ES", "en")).toBe("ES flag");
    expect(t("navMap")).toBe("Mapa");
    expect(t("hourNow")).toBe("Ahora");
    expect(t("agoMin").replace("{m}", "5")).toBe("hace 5 min");
  });
});
