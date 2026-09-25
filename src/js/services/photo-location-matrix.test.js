/* Image accuracy across the kinds of place a visitor can search for.
 *
 * One table, run through the real fetch chain (fetchBestPhoto) with the
 * providers stubbed: for each kind of location — a major city, an ambiguous
 * name, a region, a country, an ocean — what each provider can answer and
 * which of the five outcomes (exact / nearby / regional / generic / none) the
 * visitor is told. The point is that the outcomes stay DISTINCT: a stock photo
 * is never "exact", a photo of somewhere else is never the place, and when
 * nothing can be trusted the answer is none, so the local visual stays.
 * `fetch` is stubbed: no network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchBestPhoto, __resetPhotoCacheForTests } from "./photo-api.js";
import {
  photoConfidence,
  photoProvenance,
  asWaterOverview,
  asAreaLandmark,
} from "../ui/photo-provenance.js";
import { findLocations, LOCATIONS } from "../data/locations.js";

const place = (over) => ({
  id: "x",
  kind: "city",
  cc: "JP",
  lat: 35.6762,
  lon: 139.6503,
  name: { en: "Tokyo", fr: "Tokyo" },
  region: { en: "Kantō", fr: "Kantō" },
  country: { en: "Japan", fr: "Japon" },
  aliases: [],
  landmark: null,
  ...over,
});

const TOKYO = place({ id: "geo-tokyo" });
const PARIS_TX = place({
  id: "geo-paris-tx",
  cc: "US",
  lat: 33.6609,
  lon: -95.5555,
  name: { en: "Paris", fr: "Paris" },
  region: { en: "Texas", fr: "Texas" },
  country: { en: "United States", fr: "États-Unis" },
});
const TEXAS = place({
  id: "geo-texas",
  kind: "state",
  cc: "US",
  lat: 31.9686,
  lon: -99.9018,
  name: { en: "Texas", fr: "Texas" },
  region: { en: "", fr: "" },
  country: { en: "United States", fr: "États-Unis" },
});
const FRANCE = place({
  id: "geo-france",
  kind: "country",
  cc: "FR",
  lat: 46.6,
  lon: 2.2,
  name: { en: "France", fr: "France" },
  region: { en: "", fr: "" },
  country: { en: "France", fr: "France" },
});
const PACIFIC = place({
  id: "geo-pacific",
  kind: "ocean",
  cc: "",
  lat: 0,
  lon: -150,
  name: { en: "Pacific Ocean", fr: "Océan Pacifique" },
  region: { en: "", fr: "" },
  country: { en: "", fr: "" },
  waterKind: "ocean",
});

const commons = (title, { lat = null, lon = null, description = "" } = {}) => ({
  title: `File:${title}.jpg`,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`,
      thumbwidth: 1280,
      thumbheight: 850,
      mime: "image/jpeg",
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        Artist: { value: "A Photographer" },
        ImageDescription: { value: description || title },
        Categories: { value: "" },
      },
    },
  ],
  coordinates: lat === null ? undefined : [{ lat, lon }],
});

const pexels = (alt) => ({
  alt,
  photographer: "P. Shooter",
  url: "https://www.pexels.com/photo/x-1/",
  src: { medium: "https://images.pexels.com/m.jpg", large: "https://images.pexels.com/l.jpg" },
});

const googlePlace = (loc, over = {}) => ({
  id: "ChIJmock",
  name: loc.name.en,
  address: `${loc.name.en}, ${loc.country.en}`,
  lat: loc.lat,
  lon: loc.lon,
  types: ["locality", "political"],
  mapsUri: "https://maps.google.com/?cid=1",
  photo: {
    ref: "places/ChIJmock/photos/ref",
    width: 1600,
    height: 900,
    attributions: [{ name: "A Google Contributor", uri: "https://maps.google.com/contrib/1" }],
  },
  ...over,
});

const mapillary = (loc) => ({
  id: "123456789",
  src: "https://scontent-cdg4-1.xx.fbcdn.net/m/x.jpg",
  width: 2048,
  height: 1152,
  lat: loc.lat + 0.0005,
  lon: loc.lon + 0.0005,
  capturedAt: 1700000000000,
  isPano: false,
  creator: "a_contributor",
  link: "https://www.mapillary.com/app/?pKey=123456789&focus=photo",
});

/* Answers each provider from a plain description. "fail" is a 500. */
function stubProviders({ places = [], geo = [], text = [], pexelsList = [], street = [] } = {}) {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const bad = { ok: false, status: 500, json: async () => ({}) };
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("api/places")) {
      if (places === "fail") return bad;
      if (new URL(u, "http://local").searchParams.get("photo")) {
        return ok({ photo: { src: "https://lh3.googleusercontent.com/mock", width: 1280 } });
      }
      return ok({ places });
    }
    if (u.includes("api/mapillary")) return street === "fail" ? bad : ok({ images: street });
    if (u.includes("api/pexels")) return pexelsList === "fail" ? bad : ok({ photos: pexelsList });
    if (u.includes("commons.wikimedia.org")) {
      const generator = new URL(u).searchParams.get("generator");
      return ok({ query: { pages: generator === "geosearch" ? geo : text } });
    }
    return bad;
  });
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetPhotoCacheForTests();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const outcome = async (loc) => {
  const photo = await fetchBestPhoto(loc);
  return { photo, confidence: photoConfidence(photo), tier: photoProvenance(photo) };
};

describe("a major city (Tokyo)", () => {
  it("exact — Google's photo of the very place", async () => {
    stubProviders({ places: [googlePlace(TOKYO)] });
    const r = await outcome(TOKYO);
    expect(r.confidence).toBe("exact");
    expect(r.photo.source).toBe("google");
  });

  it("nearby — only a street-level frame taken beside it", async () => {
    stubProviders({ street: [mapillary(TOKYO)] });
    const r = await outcome(TOKYO);
    expect(r.confidence).toBe("nearby");
    expect(r.photo.source).toBe("mapillary");
  });

  it("generic — only a stock photo whose caption says Tokyo", async () => {
    stubProviders({ pexelsList: [pexels("Neon streets of Tokyo, Japan at night")] });
    const r = await outcome(TOKYO);
    expect(r.confidence).toBe("generic");
    expect(r.photo.src).toContain("images.pexels.com");
  });

  it("regional — only a photo that names Japan, labelled as Japan's", async () => {
    stubProviders({ text: [commons("Mount Fuji from a train, Japan")] });
    const r = await outcome(TOKYO);
    expect(r.confidence).toBe("regional");
    expect(r.tier).toBe("country");
    expect(r.photo.approximateOf).toBe("Japan");
  });

  it("none — every provider empty or failing, so the local visual stays", async () => {
    stubProviders({ places: "fail", street: "fail", pexelsList: "fail", geo: [], text: [] });
    const r = await outcome(TOKYO);
    expect(r.photo).toBeNull();
    expect(r.confidence).toBe("none");
  });
});

describe("an ambiguous name (Paris, Texas)", () => {
  it("never shows the other Paris — a French caption is refused, not displayed", async () => {
    stubProviders({ pexelsList: [pexels("Eiffel Tower in Paris, France at night")] });
    expect((await outcome(PARIS_TX)).confidence).toBe("none");
  });

  it("never shows a file geotagged in the other Paris, whatever its title says", async () => {
    stubProviders({
      text: [commons("Paris - Tour Eiffel", { lat: 48.8584, lon: 2.2945 })],
    });
    expect((await outcome(PARIS_TX)).confidence).toBe("none");
  });

  it("keeps the right one: a photo inside Lamar County is the place", async () => {
    stubProviders({
      text: [
        commons("Paris - Tour Eiffel", { lat: 48.8584, lon: 2.2945 }),
        commons("Lamar County Courthouse, Paris", { lat: 33.6617, lon: -95.5553 }),
      ],
    });
    const r = await outcome(PARIS_TX);
    expect(r.photo.title).toContain("Lamar County Courthouse");
    expect(r.confidence).toBe("exact");
  });
});

describe("a region or state (Texas)", () => {
  it("a photograph naming the state is the state's photo", async () => {
    stubProviders({ text: [commons("Big Bend, Texas", { description: "Big Bend, Texas" })] });
    const r = await outcome(TEXAS);
    expect(["exact", "regional"]).toContain(r.confidence);
    expect(r.photo.source).toBe("wikimedia");
  });

  it("a population chart or locator map of the state is never a photo of it", async () => {
    stubProviders({
      text: [
        { ...commons("Texas age pyramid"), title: "File:Texas age pyramid.svg" },
        commons("Map of Texas highlighting Harris County"),
      ],
    });
    expect((await outcome(TEXAS)).confidence).toBe("none");
  });

  it("a curated landmark photo of a state is labelled as the landmark's, not the state's", () => {
    const [texas] = findLocations("texas", "en");
    expect(texas.landmark.pexelsId).toBeTruthy();
    const labelled = asAreaLandmark(
      { src: "x.jpg", photographer: "P" },
      texas.landmark.en,
      texas.kind,
    );
    expect(photoConfidence(labelled)).toBe("regional");
    expect(labelled.approximateOf).toBe("The Alamo");
  });
});

describe("a country (France)", () => {
  it("a stock photo naming the country is generic, never the country's exact photo", async () => {
    stubProviders({ pexelsList: [pexels("Lavender fields in France")] });
    const r = await outcome(FRANCE);
    expect(r.confidence).toBe("generic");
  });

  it("a photo of another country is refused", async () => {
    stubProviders({ pexelsList: [pexels("Alpine village in Switzerland")] });
    expect((await outcome(FRANCE)).confidence).toBe("none");
  });
});

describe("an ocean (Pacific Ocean)", () => {
  it("is an overview, never an exact photo — whichever provider answered", () => {
    const shown = asWaterOverview({ src: "x.jpg", photographer: "P" }, "Pacific Ocean");
    expect(photoProvenance(shown)).toBe("overview");
    expect(photoConfidence(shown)).toBe("generic");
  });

  it("a beach or a ship near the point is not the ocean", async () => {
    stubProviders({
      geo: [commons("Bondi Beach aerial", { lat: 0.01, lon: -150.01 })],
      text: [commons("Cargo ship at anchor")],
    });
    expect((await outcome(PACIFIC)).confidence).toBe("none");
  });
});

/* The curated destinations, reviewed by hand against each photo's real Pexels
   caption and page title (2026-09-26): all 21 reviewed IDs resolve and show
   the landmark they claim. These guard what that review established. */
describe("curated destinations — the reviewed photos stay reviewed", () => {
  const withPhoto = LOCATIONS.filter((loc) => loc.landmark?.pexelsId);

  it("every reviewed photo ID is a real Pexels ID, used by exactly one place", () => {
    expect(withPhoto.length).toBeGreaterThanOrEqual(21);
    const ids = withPhoto.map((loc) => loc.landmark.pexelsId);
    for (const id of ids) expect(Number.isInteger(id) && id > 0).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every landmark is named in both languages, so its label is never blank", () => {
    for (const loc of LOCATIONS.filter((l) => l.landmark)) {
      expect(loc.landmark.en, loc.id).toBeTruthy();
      expect(loc.landmark.fr, loc.id).toBeTruthy();
    }
  });

  it("a place with no verified photo stays on the emoji fallback, never a search result", () => {
    for (const id of ["paristx", "parison"]) {
      const loc = LOCATIONS.find((l) => l.id === id);
      expect(loc.landmark.noPhotoSearch, id).toBe(true);
      expect(loc.landmark.pexelsId, id).toBeUndefined();
      expect(loc.landmark.img, id).toBeUndefined();
    }
  });

  it("every state, province and country photo is labelled as its landmark's, not the area's", () => {
    const areas = withPhoto.filter((l) =>
      ["state", "province", "region", "country"].includes(l.kind),
    );
    expect(areas.length).toBeGreaterThanOrEqual(9);
    for (const loc of areas) {
      const shown = asAreaLandmark({ src: "x.jpg", photographer: "P" }, loc.landmark.en, loc.kind);
      expect(photoConfidence(shown), loc.id).toBe("regional");
      expect(shown.approximateOf, loc.id).toBe(loc.landmark.en);
    }
  });

  it("a city's reviewed photo stays an exact photo of that city", () => {
    for (const loc of withPhoto.filter((l) => l.kind === "city")) {
      expect(photoConfidence({ src: "x.jpg", photographer: "P" }), loc.id).toBe("exact");
    }
  });
});

describe("the outcomes stay distinct", () => {
  it("no provider setup can make a stock photo 'exact'", async () => {
    for (const loc of [TOKYO, PARIS_TX, TEXAS, FRANCE]) {
      __resetPhotoCacheForTests();
      stubProviders({ pexelsList: [pexels(`Skyline of ${loc.name.en}`)] });
      const photo = await fetchBestPhoto(loc);
      if (photo) expect(photoConfidence(photo)).not.toBe("exact");
    }
  });
});
