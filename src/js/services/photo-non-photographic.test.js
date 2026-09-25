/* "A picture of the place" means a photograph of it — not a chart, a map, a
 * flag or a scanned report that merely describes it.
 *
 * The case behind this file: selecting McKinley County, New Mexico showed
 * "USA McKinley County, New Mexico age pyramid.svg" as the exact place photo.
 * The Commons fixtures below are the real metadata Commons returns for that
 * search (titles, types, licences, categories), so the tests describe the
 * failure as it actually happened. `fetch` is stubbed: no network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchBestPhoto, rankWikimediaCandidates, __resetPhotoCacheForTests } from "./photo-api.js";
import { isNonPhotographic } from "./photo-relevance.js";
import { photoConfidence } from "../ui/photo-provenance.js";

/* How MapTiler hands over a county: kind "region" — so no geosearch, and the
   Commons TEXT search is where its photo comes from. */
const MCKINLEY = {
  id: "geo-mckinley-county",
  kind: "region",
  cc: "US",
  lat: 34.9969,
  lon: -108.8866,
  name: { en: "McKinley County", fr: "McKinley County" },
  region: { en: "New Mexico", fr: "Nouveau-Mexique" },
  country: { en: "United States", fr: "États-Unis" },
  aliases: [],
  landmark: null,
};

/* One Commons page in the API's own shape (see toCandidate in wikimedia-api). */
function commonsFile(
  title,
  {
    mime = "image/jpeg",
    description = "",
    categories = "",
    lat = null,
    lon = null,
    artist = "A",
  } = {},
) {
  const file = encodeURIComponent(title);
  return {
    title: `File:${title}`,
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/thumb/${file}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
        thumbwidth: 1280,
        thumbheight: 850,
        mime,
        extmetadata: {
          LicenseShortName: { value: "CC BY-SA 4.0" },
          Artist: { value: artist },
          ImageDescription: { value: description || title },
          Categories: { value: categories },
        },
      },
    ],
    coordinates: lat === null ? undefined : [{ lat, lon }],
  };
}

/* What Commons really answers for "McKinley County New Mexico United States",
   in its own order — the chart ranked above every photograph. */
const AGE_PYRAMID = commonsFile("USA McKinley County, New Mexico age pyramid.svg", {
  mime: "image/svg+xml",
  description:
    "Age pyramid for McKinley County, New Mexico, United States of America, based on census 2000 data",
  categories:
    "McKinley County, New Mexico|Self-published work|Population pyramids of counties of New Mexico",
});
const LOCATOR_MAP = commonsFile("Map of New Mexico highlighting McKinley County.svg", {
  mime: "image/svg+xml",
  categories: "Maps of McKinley County, New Mexico",
});
const COURTHOUSE = commonsFile("McKinley County New Mexico Court House.jpg", {
  description:
    "McKinley County (New Mexico) courthouse, located at 207 W. Hill Avenue in Gallup, New Mexico.",
  categories: "National Register of Historic Places in McKinley County, New Mexico",
});
const REPORT_PDF = commonsFile(
  "Zuni Pueblo Watershed project, McKinley County, New Mexico - environmental impact statement.pdf",
  { mime: "application/pdf", categories: "PD US Government|McKinley County, New Mexico" },
);
const SANBORN_MAP = commonsFile(
  "Sanborn Fire Insurance Map from Gallup, Mckinley County, New Mexico.jpg",
  { description: "Apr 1898. 3 Sheet(s).", categories: "Maps in the Library of Congress" },
);
const MINE_SCAN = commonsFile(
  "Defiance Coal Company, Mentmore Mine, McKinley County, New Mexico.tiff",
  {
    mime: "image/tiff",
    description: "Original caption: Defiance Coal Co., Mentmore Mine, Mentmore, McKinley Co., N.M.",
  },
);

function stubCommons({ text = [], geo = [] } = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes("commons.wikimedia.org")) {
      const generator = new URL(u).searchParams.get("generator");
      return ok({ query: { pages: generator === "geosearch" ? geo : text } });
    }
    /* Google, Mapillary and Pexels: nothing, so Commons decides */
    if (u.includes("api/places")) return ok({ places: [] });
    if (u.includes("api/mapillary")) return ok({ images: [] });
    return ok({ photo: null, photos: [] });
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

/* The candidate shape photo-api ranks, for the pure-function tests. */
const candidate = (title, over = {}) => ({
  src: "https://upload.wikimedia.org/x.jpg",
  title,
  alt: title,
  photographer: "A",
  mime: "image/jpeg",
  categories: "",
  ...over,
});

describe("isNonPhotographic — what Commons holds that is not a photograph", () => {
  it("rejects the McKinley age pyramid by its type, its name and its category", () => {
    const pyramid = candidate("USA McKinley County, New Mexico age pyramid.svg", {
      mime: "image/svg+xml",
    });
    expect(isNonPhotographic(pyramid, MCKINLEY)).toBe(true);
    /* even with the type unknown, or rendered to a JPEG */
    expect(isNonPhotographic({ ...pyramid, mime: "" }, MCKINLEY)).toBe(true);
    expect(
      isNonPhotographic(
        candidate("McKinley County census 2000", {
          categories: "Population pyramids of counties of New Mexico",
        }),
        MCKINLEY,
      ),
    ).toBe(true);
  });

  it("rejects charts, graphs and statistics", () => {
    for (const title of [
      "Tarbes climate chart",
      "Population graph of Gallup",
      "Diagram of the Gallup water system",
      "Gallup demographics 2010",
      "Pyramide des âges de Tarbes",
      "Diagramme climatique Tarbes",
      "Election results by county",
    ]) {
      expect(isNonPhotographic(candidate(title), MCKINLEY), title).toBe(true);
    }
  });

  it("rejects maps, flags, coats of arms, logos and seals", () => {
    for (const title of [
      "Map of New Mexico highlighting McKinley County",
      "McKinley County locator",
      "Carte de la Bigorre",
      "Flag of New Mexico",
      "Drapeau de Tarbes",
      "Coat of arms of Tarbes",
      "Blason de Tarbes",
      "City of Gallup logo",
      "Seal of McKinley County",
    ]) {
      expect(isNonPhotographic(candidate(title), MCKINLEY), title).toBe(true);
    }
    /* a scanned map is still a map, whatever its file type */
    expect(
      isNonPhotographic(
        candidate("Sanborn Fire Insurance Map from Gallup.jpg", {
          categories: "Maps in the Library of Congress",
        }),
        MCKINLEY,
      ),
    ).toBe(true);
  });

  it("rejects documents, scans, drawings and non-still media by file type", () => {
    for (const [title, mime] of [
      ["Watershed report.pdf", "application/pdf"],
      ["Old book.djvu", "image/vnd.djvu"],
      ["Mentmore Mine.tiff", "image/tiff"],
      ["Emblem drawing.png", "image/png"],
      ["Animated banner.gif", "image/gif"],
      ["Town walk.webm", "video/webm"],
    ]) {
      expect(isNonPhotographic(candidate(title, { mime }), MCKINLEY), title).toBe(true);
    }
  });

  it("rejects orbital and survey imagery on land", () => {
    for (const [title, categories] of [
      ["ISS017-E-15618 - View of Mexico", "ISS Expedition 17 Crew Earth Observations"],
      ["ISS013-E-14818 - View of Arizona", "Satellite pictures of Arizona"],
      ["M 3410801 ne 12 060 20200520", "PD USDA|NAIP"],
    ]) {
      expect(isNonPhotographic(candidate(title, { categories }), MCKINLEY), title).toBe(true);
    }
  });

  it("keeps an astronaut's view of open water, which IS an overview of it", () => {
    const pacific = { kind: "ocean", name: { en: "Pacific Ocean" }, region: {}, country: {} };
    expect(isNonPhotographic(candidate("ISS043-E-127040 - View of Earth"), pacific)).toBe(false);
    /* a map of the ocean is still not a photograph of it */
    expect(isNonPhotographic(candidate("Map of the Pacific Ocean"), pacific)).toBe(true);
  });

  it("keeps real photographs of the place", () => {
    for (const title of [
      "McKinley County New Mexico Court House.jpg",
      "Welcome to New Mexico sign entering McKinley County",
      "Dowa Yalanne",
      "Tarbes, Jardin Massey",
      "Gallup Cultural Center at dusk",
      "Chartres cathedral",
      "Graphic arts school, Tarbes",
    ]) {
      expect(isNonPhotographic(candidate(title), MCKINLEY), title).toBe(false);
    }
    expect(isNonPhotographic(candidate("Pic du Midi", { mime: "image/webp" }))).toBe(false);
  });

  it("does not hold the place's own name against it", () => {
    const chartSutton = { kind: "village", name: { en: "Chart Sutton" }, region: {}, country: {} };
    expect(isNonPhotographic(candidate("Chart Sutton church"), chartSutton)).toBe(false);
    /* …but the rule still applies to anywhere else */
    expect(isNonPhotographic(candidate("Chart Sutton church"), MCKINLEY)).toBe(true);
  });
});

describe("McKinley County — the unrelated chart is never the place photo", () => {
  it("picks the courthouse photograph, not the age pyramid ranked above it", async () => {
    stubCommons({
      text: [LOCATOR_MAP, AGE_PYRAMID, COURTHOUSE, REPORT_PDF, SANBORN_MAP, MINE_SCAN],
    });
    const photo = await fetchBestPhoto(MCKINLEY);
    expect(photo).not.toBeNull();
    expect(photo.title).toBe("McKinley County New Mexico Court House.jpg");
    expect(photo.mime).toBe("image/jpeg");
    expect(photoConfidence(photo)).toBe("exact");
  });

  it("shows no image rather than a chart when charts and scans are all there is", async () => {
    stubCommons({ text: [LOCATOR_MAP, AGE_PYRAMID, REPORT_PDF, SANBORN_MAP, MINE_SCAN] });
    expect(await fetchBestPhoto(MCKINLEY)).toBeNull();
  });

  it("refuses the chart even from a geosearch, which trusts position alone", () => {
    const gallup = { ...MCKINLEY, kind: "city", name: { en: "Gallup", fr: "Gallup" } };
    const pyramid = {
      ...candidate("USA McKinley County, New Mexico age pyramid.svg"),
      mime: "image/svg+xml",
    };
    expect(rankWikimediaCandidates(gallup, [pyramid], { trustCoordinates: true })).toBeNull();
  });
});

describe("the four outcomes, told apart", () => {
  it("exact — a photograph that names the place", async () => {
    stubCommons({ text: [COURTHOUSE] });
    expect(photoConfidence(await fetchBestPhoto(MCKINLEY))).toBe("exact");
  });

  it("regional — a photograph that names only the state", async () => {
    stubCommons({
      text: [
        commonsFile("Shiprock, New Mexico.jpg", {
          description: "Shiprock peak at sunset, New Mexico",
        }),
      ],
    });
    const photo = await fetchBestPhoto(MCKINLEY);
    expect(photoConfidence(photo)).toBe("regional");
    expect(photo.approximateOf).toBe("New Mexico");
  });

  it("generic — a stock photo that only claims the place in words", async () => {
    stubCommons();
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (u.includes("api/pexels"))
        return ok({
          photos: [
            {
              alt: "Desert road in McKinley County, New Mexico",
              photographer: "P",
              url: "https://www.pexels.com/photo/x-1/",
              src: {
                medium: "https://images.pexels.com/m.jpg",
                large: "https://images.pexels.com/l.jpg",
              },
            },
          ],
        });
      if (u.includes("commons.wikimedia.org")) return ok({ query: { pages: [] } });
      if (u.includes("api/places")) return ok({ places: [] });
      return ok({ images: [] });
    });
    expect(photoConfidence(await fetchBestPhoto(MCKINLEY))).toBe("generic");
  });

  it("none — only rejected candidates, so no reliable image", async () => {
    stubCommons({ text: [AGE_PYRAMID, LOCATOR_MAP] });
    const photo = await fetchBestPhoto(MCKINLEY);
    expect(photo).toBeNull();
    expect(photoConfidence(photo)).toBe("none");
  });
});
