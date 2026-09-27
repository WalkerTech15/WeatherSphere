/* Vietnamese dates, times and place names — the formatting that lives outside
 * the dictionary. English, French and Spanish are checked beside it so a
 * change here can never bend them. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "./state.js";
import { fmtHour, fmtClock, fmtDay, fmtDate, fmtDateTime } from "./datetime.js";
import { locName, locCountry, locRegion, localText, localTimeStr, intlLocale } from "./location.js";
import { LOCATIONS, findLocations } from "../data/locations.js";
import { wxDesc, WMO } from "../data/weather-codes.js";
import { flagAlt } from "../data/flags.js";
import { t } from "./i18n.js";

const place = (id) => LOCATIONS.find((loc) => loc.id === id);

describe("Vietnamese date and time", () => {
  beforeEach(() => {
    state.lang = "vi";
    state.clockFormat = "24";
    state.clockSeconds = false;
  });

  it("uses vi-VN as its locale, and the others as before", () => {
    expect(intlLocale()).toBe("vi-VN");
    state.lang = "es";
    expect(intlLocale()).toBe("es-ES");
    state.lang = "fr";
    expect(intlLocale()).toBe("fr-FR");
    state.lang = "en";
    expect(intlLocale()).toBe("en-US");
  });

  it("writes hours the Vietnamese way (24-hour, 14:00)", () => {
    expect(fmtHour("2026-09-26T14:00")).toBe("14:00");
    expect(fmtHour("2026-09-26T00:00")).toBe("0:00");
    expect(fmtClock("2026-09-26T14:30")).toBe("14:30");
    expect(fmtClock("2026-09-26T07:05")).toBe("7:05");
  });

  it("writes a date as day then month (26 thg 9)", () => {
    expect(fmtDate("2026-09-26")).toBe("26 thg 9");
    expect(fmtDate("2026-01-05")).toBe("5 thg 1");
    expect(fmtDate("2026-12-31")).toBe("31 thg 12");
  });

  it("names the days in Vietnamese", () => {
    expect(fmtDay("2026-09-26", false)).toBe("Thứ Bảy");
    expect(fmtDay("2026-09-26")).toBe("T7");
    expect(fmtDay("2026-09-27")).toBe("CN");
    expect(fmtDay("2026-09-28", false)).toBe("Thứ Hai");
  });

  it("formats an absolute instant with Intl in vi-VN", () => {
    const text = fmtDateTime(new Date(2026, 8, 26, 12, 30));
    expect(text.toLowerCase()).toContain("26 thg 9");
    expect(text).toContain("12:30");
  });

  it("formats a city's local clock in 24-hour or 12-hour, per the setting", () => {
    expect(localTimeStr("Asia/Ho_Chi_Minh")).toMatch(/^\d{2}:\d{2}$/);
    state.clockFormat = "12";
    expect(localTimeStr("Asia/Ho_Chi_Minh")).toMatch(/^\d{1,2}:\d{2}\s?(ch|sa)$/i);
    expect(localTimeStr("Not/AZone")).toBeNull();
  });

  it("leaves English, French and Spanish formatting unchanged", () => {
    state.lang = "en";
    expect(fmtHour("2026-09-26T14:00")).toBe("2 PM");
    expect(fmtDate("2026-09-26")).toBe("Sep 26");
    state.lang = "fr";
    expect(fmtHour("2026-09-26T14:00")).toBe("14 h");
    expect(fmtDate("2026-09-26")).toBe("26 sept");
    state.lang = "es";
    expect(fmtHour("2026-09-26T14:00")).toBe("14:00");
    expect(fmtDate("2026-09-26")).toBe("26 sep");
  });
});

describe("Vietnamese places and weather", () => {
  beforeEach(() => {
    state.lang = "vi";
  });

  it("names curated cities and landmarks in Vietnamese", () => {
    expect(locName(place("hanoi"))).toBe("Hà Nội");
    expect(locName(place("london"))).toBe("Luân Đôn");
    expect(locName(place("paris"))).toBe("Paris"); /* kept unchanged, as in real usage */
    expect(localText(place("paris").landmark)).toBe("Tháp Eiffel");
    expect(localText(place("lourdes").landmark)).toBe("Đền thánh Đức Mẹ Lộ Đức");
  });

  it("names countries through Intl, and keeps accurate regions", () => {
    expect(locCountry(place("france"))).toBe("Pháp");
    expect(locCountry(place("paris"))).toBe("Pháp");
    expect(locCountry(place("japan"))).toBe("Nhật Bản");
    expect(locCountry(place("newyork"))).toBe("Hoa Kỳ");
    expect(locRegion(place("lourdes"))).toBe("Occitanie");
    expect(locRegion(place("texas"))).toBe("Miền Nam");
  });

  it("overrides the one Vietnamese CLDR gap: Italy has no translated region name", () => {
    /* Intl.DisplayNames(["vi"], {type:"region"}).of("IT") returns the raw
       English word "Italy" (verified against Node's ICU data) — every other
       curated country code (AU/CA/DE/ES/FR/GB/JP/US/VN) comes back correctly
       localized, so only this one needs the override in core/location.js. */
    expect(locCountry(place("italy"))).toBe("Ý");
    expect(locCountry(place("italy"))).not.toBe("Italy");
  });

  it("prefers a Vietnamese name the geocoder supplied", () => {
    const field = { en: "Munich", fr: "Munich", vi: "Muy-ních" };
    expect(localText(field)).toBe("Muy-ních");
    state.lang = "en";
    expect(localText(field)).toBe("Munich");
  });

  it("falls back to the written name for a place with no Vietnamese one, never to nothing", () => {
    expect(localText({ en: "Tarbes", fr: "Tarbes" })).toBe("Tarbes");
    expect(localText(undefined)).toBe("");
    expect(localText({ en: "", fr: "Ici" })).toBe("Ici");
  });

  it("finds curated places by their Vietnamese names, with correct diacritics", () => {
    const first = (query) => findLocations(query, "vi")[0]?.id;
    expect(first("Hà Nội")).toBe("hanoi");
    expect(first("ha noi")).toBe("hanoi"); /* diacritics folded, as for every language */
    expect(first("Luân Đôn")).toBe("london");
    expect(first("Nhật Bản")).toBe("japan");
    expect(first("nhat ban")).toBe("japan");
    expect(first("Đức")).toBe("germany");
    expect(first("Hoa Kỳ")).toBe("usa");
  });

  it("describes every WMO code in Vietnamese", () => {
    for (const code of Object.keys(WMO)) {
      expect(wxDesc(Number(code), "vi"), `WMO ${code}`).toBeTruthy();
      expect(wxDesc(Number(code), "vi"), `WMO ${code}`).not.toBe(wxDesc(Number(code), "en"));
    }
    expect(wxDesc(0, "vi")).toBe("Trời quang");
    expect(wxDesc(95, "vi")).toBe("Dông");
    expect(wxDesc(0, "en")).toBe("Clear sky");
    expect(wxDesc(0, "fr")).toBe("Ciel dégagé");
    expect(wxDesc(0, "es")).toBe("Cielo despejado");
  });

  it("labels a flag in Vietnamese, and reads the interface through t()", () => {
    expect(flagAlt("VN", "vi")).toBe("Cờ: VN");
    expect(flagAlt("VN", "fr")).toBe("Drapeau : VN");
    expect(flagAlt("VN", "es")).toBe("Bandera: VN");
    expect(flagAlt("VN", "en")).toBe("VN flag");
    expect(t("navMap")).toBe("Bản đồ");
    expect(t("hourNow")).toBe("Bây giờ");
    expect(t("agoMin").replace("{m}", "5")).toBe("5 phút trước");
  });
});
