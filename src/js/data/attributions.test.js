/* The provider list behind the footer credit and the About page's "Data
 * sources" card: complete, translated, honest about what is wired up. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DATA_PROVIDERS, providerById, footerProviderNames } from "./attributions.js";
import { I18N } from "./translations.js";

const TONES = ["primary", "sky", "amber", "emerald", "violet", "rose"];

describe("DATA_PROVIDERS", () => {
  it("has a unique id and name for every provider", () => {
    expect(new Set(DATA_PROVIDERS.map((p) => p.id)).size).toBe(DATA_PROVIDERS.length);
    expect(new Set(DATA_PROVIDERS.map((p) => p.name)).size).toBe(DATA_PROVIDERS.length);
  });

  it("links every provider over https, with a short label for the link", () => {
    for (const provider of DATA_PROVIDERS) {
      expect(new URL(provider.url).protocol, provider.id).toBe("https:");
      expect(provider.host.length, provider.id).toBeGreaterThan(0);
      expect(provider.host, provider.id).not.toMatch(/^https?:|\s/);
    }
  });

  it("gives every provider a logo label and one of the palette's tones", () => {
    for (const provider of DATA_PROVIDERS) {
      expect(provider.logo.length, provider.id).toBeGreaterThan(0);
      expect(provider.logo.length, provider.id).toBeLessThanOrEqual(3);
      expect(TONES, provider.id).toContain(provider.tone);
    }
  });

  it.each(["en", "fr"])("describes every provider in %s", (lang) => {
    for (const provider of DATA_PROVIDERS) {
      expect(I18N[lang][provider.blurb], `${lang}.${provider.blurb}`).toBeTruthy();
    }
  });

  it("names, and only names, providers the app really calls", () => {
    /* each provider is matched against the host its code actually contacts */
    const evidence = {
      "open-meteo": ["src/js/weather/providers/open-meteo.js", "open-meteo.com"],
      maptiler: ["src/js/core/config.js", "maptiler.com"],
      bigdatacloud: ["src/js/services/geocoding-api.js", "bigdatacloud"],
      wikimedia: ["src/js/services/wikimedia-api.js", "wikimedia.org"],
      nws: ["src/js/services/nws-alerts.js", "api.weather.gov"],
      xweather: ["api/xweather-lightning.js", "xweather.com"],
      openweathermap: ["api/openweather-clouds.js", "openweathermap.org"],
      pexels: ["api/pexels.js", "pexels.com"],
      "google-places": ["api/places.js", "googleapis.com"],
      mapillary: ["api/mapillary.js", "mapillary.com"],
    };
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    for (const [id, [file, host]] of Object.entries(evidence)) {
      expect(providerById(id), id).not.toBeNull();
      expect(readFileSync(root + file, "utf8"), `${id} in ${file}`).toContain(host);
    }
    /* OpenStreetMap's data arrives inside the MapTiler style and is credited
       by the map's own attribution control; it is listed because that credit
       is owed. Nothing else is listed without evidence above. */
    const accounted = new Set([...Object.keys(evidence), "openstreetmap"]);
    expect(DATA_PROVIDERS.map((p) => p.id).filter((id) => !accounted.has(id))).toEqual([]);
    expect(providerById("openstreetmap")).not.toBeNull();
  });

  it("keeps the providers the About page has always listed, in their order, first", () => {
    expect(DATA_PROVIDERS.slice(0, 5).map((p) => p.name)).toEqual([
      "Open-Meteo",
      "OpenStreetMap",
      "MapTiler",
      "Pexels",
      "BigDataCloud",
    ]);
  });
});

describe("the footer credit", () => {
  it("lists only the providers marked for it — the ones behind every page", () => {
    expect(footerProviderNames()).toBe("Open-Meteo · OpenStreetMap · MapTiler");
  });

  it("never lists a provider that belongs to one optional feature", () => {
    const names = footerProviderNames();
    for (const id of [
      "openweathermap",
      "xweather",
      "nws",
      "pexels",
      "google-places",
      "mapillary",
    ]) {
      expect(names).not.toContain(providerById(id).name);
    }
  });

  it("is the text the two languages show, in each language's own punctuation", () => {
    expect(I18N.en.footerData).toBe(`Data: ${footerProviderNames()}`);
    expect(I18N.fr.footerData).toBe(`Données : ${footerProviderNames()}`);
  });
});

describe("providerById", () => {
  it("finds a provider, and is null for one that does not exist", () => {
    expect(providerById("open-meteo").name).toBe("Open-Meteo");
    expect(providerById("nope")).toBeNull();
    expect(providerById(undefined)).toBeNull();
  });
});
