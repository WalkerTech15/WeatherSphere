import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode, isRelevantGeocodeResult, __featureToLoc } from "./geocoding-api.js";

const location = (name, region, country, extra = {}) => ({
  name: { en: name, fr: name },
  region: { en: region, fr: region },
  country: { en: country, fr: country },
  ...extra,
});

describe("geocoding relevance filter", () => {
  it("keeps exact, accented, and prefix location matches", () => {
    const quebec = location("Québec", "Québec", "Canada", { cc: "CA" });
    expect(isRelevantGeocodeResult("Quebec", quebec)).toBe(true);
    expect(isRelevantGeocodeResult("Québ", quebec)).toBe(true);
  });

  it("keeps small misspellings and adjacent transpositions", () => {
    const paris = location("Paris", "Île-de-France", "France", { cc: "FR" });
    const york = location("New York", "New York", "United States", { cc: "US" });
    expect(isRelevantGeocodeResult("Pariss", paris)).toBe(true);
    expect(isRelevantGeocodeResult("New Yrok", york)).toBe(true);
  });

  it("uses region qualifiers to reject the wrong same-name place", () => {
    const parisFrance = location("Paris", "Île-de-France", "France", { cc: "FR" });
    const parisTexas = location("Paris", "Texas", "United States", {
      cc: "US",
      regionCode: "US-TX",
    });
    expect(isRelevantGeocodeResult("Paris Texas", parisFrance)).toBe(false);
    expect(isRelevantGeocodeResult("Paris Texas", parisTexas)).toBe(true);
    expect(isRelevantGeocodeResult("Paris TX", parisTexas)).toBe(true);
  });

  it("rejects unrelated fuzzy results that only share a generic word", () => {
    const unrelated = location("Place de l'Église", "Nouvelle-Aquitaine", "France", {
      cc: "FR",
    });
    expect(isRelevantGeocodeResult("zzzxxyy-not-a-place", unrelated)).toBe(false);
  });

  it("does not search on generic location words alone", () => {
    expect(isRelevantGeocodeResult("city", location("Paris", "Île-de-France", "France"))).toBe(
      false,
    );
  });
});

/* Priority 1, the SEARCH half. MapTiler has no marine place_type this app
   maps, so an ocean or sea searched by name arrives with an unrecognised
   type and falls through MT_KIND's default to kind "city". That is what put
   "City / Ville" under the Pacific Ocean and sent "Pacific Ocean cityscape"
   to Pexels — a city photo of somewhere else entirely. featureToLoc now
   recognises the feature by its own name instead. */
describe("featureToLoc — bodies of water", () => {
  const feature = (text, extra = {}) => ({
    id: "x.1",
    text,
    place_type: ["place"] /* the unmapped-marine case: MapTiler's generic type */,
    center: [-140, 0],
    ...extra,
  });

  it("classifies a searched ocean as marine, not as a city", () => {
    const loc = __featureToLoc(feature("Pacific Ocean"));
    expect(loc.kind).toBe("ocean");
    expect(loc.waterKind).toBe("ocean");
  });

  it("keeps the finer water kind so the label and photo query can differ", () => {
    expect(__featureToLoc(feature("Lake Superior")).waterKind).toBe("lake");
    expect(__featureToLoc(feature("Gulf of Mexico")).waterKind).toBe("gulf");
    expect(__featureToLoc(feature("Hudson Bay")).waterKind).toBe("bay");
  });

  it("carries no country, region or flag code for open water", () => {
    const loc = __featureToLoc(
      feature("Mediterranean Sea", {
        properties: { country_code: "it" },
        context: [{ id: "country.1", text: "Italy", country_code: "it" }],
      }),
    );
    expect(loc.cc).toBe("");
    expect(loc.country).toEqual({ en: "", fr: "" });
    expect(loc.region).toEqual({ en: "", fr: "" });
  });

  it("uses the water gradient rather than the city one", () => {
    expect(__featureToLoc(feature("Pacific Ocean")).grad).toEqual(["#0EA5E9", "#0C4A6E"]);
  });

  it("leaves ordinary land results exactly as they were", () => {
    const loc = __featureToLoc(
      feature("Bay City", {
        center: [-83.9, 43.6],
        properties: { country_code: "us" },
        context: [{ id: "country.1", text: "United States", country_code: "us" }],
      }),
    );
    expect(loc.kind).toBe("city");
    expect(loc.waterKind).toBeNull();
    expect(loc.cc).toBe("US");
    expect(loc.grad).toEqual(["#3B82F6", "#1E40AF"]);
  });
});

describe("geocoding relevance filter — both languages", () => {
  const mexico = location("Mexico", "", "Mexico", { cc: "MX" });
  mexico.name = { en: "Mexico", fr: "Mexique" };
  mexico.country = { en: "Mexico", fr: "Mexique" };

  it.each(["Mexico", "Mexique", "mexique", "MEXICO"])("keeps the country for %s", (query) => {
    expect(isRelevantGeocodeResult(query, mexico)).toBe(true);
  });

  it("finds South Africa by its French name, Afrique du Sud", () => {
    const southAfrica = location("South Africa", "", "South Africa", { cc: "ZA" });
    southAfrica.name = { en: "South Africa", fr: "Afrique du Sud" };
    southAfrica.country = { en: "South Africa", fr: "Afrique du Sud" };
    expect(isRelevantGeocodeResult("Afrique du Sud", southAfrica)).toBe(true);
  });

  it("still rejects a place that matches in neither language", () => {
    expect(isRelevantGeocodeResult("Mexique", location("Paris", "", "France"))).toBe(false);
  });

  it("a French region or country qualifier finds the place too", () => {
    const place = location("Paris", "Texas", "United States", { cc: "US" });
    place.country = { en: "United States", fr: "États-Unis" };
    expect(isRelevantGeocodeResult("Paris Etats-Unis", place)).toBe(true);
  });
});

describe("featureToLoc — a country", () => {
  it.each([
    ["Japan", "jp", [138.25, 36.2]],
    ["Brazil", "br", [-53.1, -10.8]],
    ["Vietnam", "vn", [106.3, 16.6]],
  ])("%s is kind country, carries its own code, and has no region above it", (name, cc, center) => {
    const loc = __featureToLoc({
      id: `country.${cc}`,
      text: name,
      place_type: ["country"],
      center,
      properties: { country_code: cc },
    });
    expect(loc.kind).toBe("country");
    expect(loc.cc).toBe(cc.toUpperCase());
    expect(loc.country.en).toBe(name);
    expect(loc.region).toEqual({ en: "", fr: "" });
    expect([loc.lon, loc.lat]).toEqual(center);
  });

  it("carries both languages, so 'Japon' and 'Japan' both find it", () => {
    const loc = __featureToLoc({
      id: "country.jp",
      text: "Japan",
      text_en: "Japan",
      text_fr: "Japon",
      place_type: ["country"],
      center: [138.25, 36.2],
      properties: { country_code: "jp" },
    });
    expect(loc.name).toEqual({ en: "Japan", fr: "Japon" });
    expect(loc.country).toEqual({ en: "Japan", fr: "Japon" });
  });

  it("a namesake city elsewhere stays a city in its own country", () => {
    const loc = __featureToLoc({
      id: "place.jp-mo",
      text: "Japan",
      place_type: ["place"],
      center: [-92.5, 37.2],
      properties: { country_code: "us" },
      context: [
        { id: "region.1", text: "Missouri", short_code: "US-MO" },
        { id: "country.1", text: "United States", country_code: "us" },
      ],
    });
    expect(loc.kind).toBe("city");
    expect(loc.cc).toBe("US");
    expect(loc.country.en).toBe("United States");
  });
});

describe("geocode — the keyless Open-Meteo fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (results) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ results }) })),
    );

  it("tells a country from a namesake city by its GeoNames feature code", async () => {
    answer([
      {
        id: 1,
        name: "Japan",
        latitude: 36,
        longitude: 138,
        country_code: "JP",
        country: "Japan",
        feature_code: "PCLI",
      },
      {
        id: 2,
        name: "Japan",
        latitude: 37.2,
        longitude: -92.5,
        country_code: "US",
        country: "United States",
        admin1: "Missouri",
        feature_code: "PPL",
      },
    ]);
    const [country, city] = await geocode("Japan");
    expect(country).toMatchObject({ kind: "country", cc: "JP", region: { en: "", fr: "" } });
    expect(country.country.en).toBe("Japan");
    expect(city).toMatchObject({ kind: "city", cc: "US", dynamic: true });
    expect(city.region.en).toBe("Missouri");
    expect(city.country.en).toBe("United States");
  });

  it.each(["PCLI", "PCLD", "PCLF", "PCLS", "PCLIX"])("%s is a country", async (code) => {
    answer([
      { id: 1, name: "X", latitude: 1, longitude: 2, country_code: "XX", feature_code: code },
    ]);
    expect((await geocode("X"))[0].kind).toBe("country");
  });

  it.each(["PPL", "PPLA", "PPLC", "ADM1", "ADM2", "", undefined])(
    "%s stays a city, exactly as before",
    async (code) => {
      answer([
        {
          id: 1,
          name: "X",
          latitude: 1,
          longitude: 2,
          country_code: "XX",
          country: "Y",
          feature_code: code,
        },
      ]);
      const [loc] = await geocode("X");
      expect(loc.kind).toBe("city");
      expect(loc.country.en).toBe("Y");
    },
  );

  it("answers nothing for a failed or empty response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    expect(await geocode("x")).toEqual([]);
    answer(undefined);
    expect(await geocode("x")).toEqual([]);
  });
});
