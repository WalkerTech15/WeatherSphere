/* Provenance labelling — the rules that stop a weak photo being displayed as
 * a strong claim. Pure functions on plain objects: no DOM, no network. */
import { describe, it, expect, afterEach } from "vitest";
import {
  PROVENANCE_TIERS,
  PHOTO_CONFIDENCE,
  photoConfidence,
  photoProvenance,
  provenanceLabel,
  provenanceBadge,
  photoAltText,
  asWaterOverview,
  asAreaLandmark,
} from "./photo-provenance.js";
import { state } from "../core/state.js";

const originalLang = state.lang;
afterEach(() => {
  state.lang = originalLang;
});

const photo = (over = {}) => ({ src: "x.jpg", photographer: "P", link: "https://x/", ...over });

describe("photoProvenance — deriving the tier", () => {
  it("honours a tier a provider set directly", () => {
    expect(photoProvenance(photo({ provenance: "nearby" }))).toBe("nearby");
    expect(photoProvenance(photo({ provenance: "exact" }))).toBe("exact");
  });

  it("maps the area fallback onto regional or country by the area it depicts", () => {
    expect(photoProvenance(photo({ approximate: true, areaKind: "region" }))).toBe("regional");
    expect(photoProvenance(photo({ approximate: true, areaKind: "country" }))).toBe("country");
  });

  it("treats an unmarked photo as exact — it got here by naming the place", () => {
    /* What reaches the UI unlabelled is a curated reviewed photo or a Commons
       text match that names the place itself — both claims about the place.
       A Pexels search result never arrives unlabelled: fetchBestPhoto marks
       it generic (or as its area's photo) before returning it. */
    expect(photoProvenance(photo())).toBe("exact");
  });

  it("ignores a bogus tier rather than trusting it", () => {
    expect(photoProvenance(photo({ provenance: "amazing" }))).toBe("exact");
  });

  it("is total on a missing photo", () => {
    expect(photoProvenance(null)).toBe("");
    expect(photoProvenance(undefined)).toBe("");
  });

  it("lists exactly the six tiers the UI knows how to render", () => {
    expect(PROVENANCE_TIERS).toEqual([
      "exact",
      "nearby",
      "regional",
      "country",
      "overview",
      "generic",
    ]);
  });

  it("honours the overview tier that open water is given", () => {
    expect(photoProvenance(photo({ provenance: "overview" }))).toBe("overview");
  });
});

describe("asWaterOverview — open water has no exact photo", () => {
  it("returns a labelled copy and leaves the shared cached photo untouched", () => {
    const original = photo({ source: "wikimedia", photographer: "NASA", license: "Public domain" });
    const labelled = asWaterOverview(original, "Atlantic Ocean");
    expect(labelled).not.toBe(original);
    expect(original.provenance).toBeUndefined();
    expect(labelled.provenance).toBe("overview");
    expect(labelled.overviewOf).toBe("Atlantic Ocean");
  });

  it("keeps everything attribution and licensing depend on", () => {
    const labelled = asWaterOverview(
      photo({
        source: "wikimedia",
        photographer: "NASA",
        license: "Public domain",
        link: "https://c/",
      }),
      "North Sea",
    );
    expect(labelled).toMatchObject({
      source: "wikimedia",
      photographer: "NASA",
      license: "Public domain",
      link: "https://c/",
      src: "x.jpg",
    });
  });

  it("is total on a missing photo", () => {
    expect(asWaterOverview(null, "Atlantic Ocean")).toBeNull();
  });
});

describe("provenanceLabel — what the credit admits", () => {
  it("says plainly that an exact photo is one — silence would look like 'unchecked'", () => {
    state.lang = "en";
    expect(provenanceLabel(photo())).toBe("Exact place photo");
    expect(provenanceLabel(photo({ provenance: "exact" }))).toBe("Exact place photo");
  });

  it("has no label at all when there is no photo", () => {
    expect(provenanceLabel(null)).toBe("");
  });

  it("names the subject of a nearby photo when it knows it", () => {
    const label = provenanceLabel(photo({ provenance: "nearby", subjectName: "Tarbes Cathedral" }));
    expect(label).toContain("Tarbes Cathedral");
    /* Must still disclaim: naming the cathedral is not enough on its own. */
    expect(label.length).toBeGreaterThan("Tarbes Cathedral".length);
  });

  it("falls back to a plain nearby disclaimer with no subject", () => {
    const label = provenanceLabel(photo({ provenance: "nearby" }));
    expect(label).toBeTruthy();
    expect(label).not.toContain("{subject}");
  });

  it("keeps the existing wording for a regional or country photo", () => {
    const label = provenanceLabel(
      photo({ approximate: true, areaKind: "region", approximateOf: "Occitanie" }),
    );
    expect(label).toContain("Occitanie");
    expect(label).not.toContain("{area}");
  });

  it("says an ocean photo is an overview of the water, not of this exact spot", () => {
    state.lang = "en";
    const label = provenanceLabel(asWaterOverview(photo(), "Atlantic Ocean"));
    expect(label).toContain("Atlantic Ocean");
    expect(label.toLowerCase()).toContain("overview");
    expect(label.toLowerCase()).toContain("not this exact spot");
  });

  it("still says it plainly when the water's name is unknown", () => {
    const label = provenanceLabel(photo({ provenance: "overview" }));
    expect(label).toBeTruthy();
    expect(label).not.toMatch(/\{\w+\}/);
  });

  it("never leaves an unsubstituted placeholder in any tier or language", () => {
    for (const lang of ["en", "fr"]) {
      state.lang = lang;
      for (const p of [
        photo({ provenance: "nearby" }),
        photo({ provenance: "nearby", subjectName: "X" }),
        photo({ approximate: true, areaKind: "region", approximateOf: "Y" }),
        photo({ approximate: true, areaKind: "country", approximateOf: "Z" }),
        asWaterOverview(photo(), "Mer du Nord"),
        photo({ provenance: "overview" }),
      ]) {
        expect(provenanceLabel(p)).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("is translated, not hardcoded to one language", () => {
    const p = photo({ provenance: "nearby" });
    state.lang = "en";
    const en = provenanceLabel(p);
    state.lang = "fr";
    const fr = provenanceLabel(p);
    expect(en).not.toBe(fr);
    expect(en).toBeTruthy();
    expect(fr).toBeTruthy();
  });
});

describe("provenanceBadge — the few words shown on the image", () => {
  it("says 'Exact place photo' for an exact photo, and is empty only without a photo", () => {
    state.lang = "en";
    expect(provenanceBadge(photo())).toBe("Exact place photo");
    expect(provenanceBadge(null)).toBe("");
  });

  it("is a short word for a nearby photo, not the full sentence", () => {
    const badge = provenanceBadge(photo({ provenance: "nearby", subjectName: "A Long Name Here" }));
    expect(badge).toBeTruthy();
    expect(badge.length).toBeLessThan(20);
  });

  it("is a short word for an ocean overview", () => {
    const badge = provenanceBadge(asWaterOverview(photo(), "Mer Méditerranée"));
    expect(badge).toBeTruthy();
    expect(badge.length).toBeLessThan(20);
  });

  it("says 'Regional photo' or 'Country photo' — the area itself is in the full label", () => {
    state.lang = "en";
    const region = photo({ approximate: true, areaKind: "region", approximateOf: "Occitanie" });
    const country = photo({ approximate: true, areaKind: "country", approximateOf: "France" });
    expect(provenanceBadge(region)).toBe("Regional photo");
    expect(provenanceBadge(country)).toBe("Country photo");
    expect(provenanceLabel(region)).toContain("Occitanie");
    expect(provenanceLabel(country)).toContain("France");
  });
});

describe("photoAltText — no image is left unlabelled", () => {
  it("keeps a provider's own description when it has one", () => {
    expect(photoAltText(photo({ alt: "Eiffel Tower at dusk" }), "Paris")).toBe(
      "Eiffel Tower at dusk",
    );
  });

  it("composes a sentence for a caption-less photo, naming the place", () => {
    /* Mapillary returns no caption at all — without this a screen-reader user
       meets an unlabelled image where a sighted user sees a credit. */
    const alt = photoAltText(photo({ source: "mapillary", provenance: "nearby" }), "Tarbes");
    expect(alt).toContain("Tarbes");
    expect(alt).not.toMatch(/\{\w+\}/);
  });

  it("describes a caption-less open-water photo as a general view", () => {
    state.lang = "en";
    const alt = photoAltText(asWaterOverview(photo(), "Atlantic Ocean"), "Atlantic Ocean");
    expect(alt).toContain("Atlantic Ocean");
    expect(alt.toLowerCase()).toContain("general view");
  });

  it("distinguishes a nearby photo from an exact one in the alt text too", () => {
    const near = photoAltText(photo({ provenance: "nearby" }), "Tarbes");
    const exact = photoAltText(photo({ provenance: "exact" }), "Tarbes");
    expect(near).not.toBe(exact);
  });

  it("returns empty rather than a meaningless sentence with no place name", () => {
    expect(photoAltText(photo(), "")).toBe("");
    expect(photoAltText(null, "Tarbes")).toBe("");
  });
});

describe("photoConfidence — the image model's explicit fallback type", () => {
  it("offers exactly five outcomes, strongest first", () => {
    expect(PHOTO_CONFIDENCE).toEqual(["exact", "nearby", "regional", "generic", "none"]);
  });

  it("maps every provenance tier onto one of them", () => {
    expect(photoConfidence(photo({ provenance: "exact" }))).toBe("exact");
    expect(photoConfidence(photo())).toBe("exact");
    expect(photoConfidence(photo({ provenance: "nearby" }))).toBe("nearby");
    expect(photoConfidence(photo({ approximate: true, areaKind: "region" }))).toBe("regional");
    /* a country photo is a weaker admission in the wording, but the same
       outcome: a photo of the wider area, labelled as such */
    expect(photoConfidence(photo({ approximate: true, areaKind: "country" }))).toBe("regional");
    expect(photoConfidence(photo({ provenance: "generic" }))).toBe("generic");
    /* open water has no exact photo: an overview is representative only */
    expect(photoConfidence(photo({ provenance: "overview" }))).toBe("generic");
  });

  it("is 'none' when there is no photo, so the local fallback stays", () => {
    expect(photoConfidence(null)).toBe("none");
    expect(photoConfidence(undefined)).toBe("none");
  });

  it("only ever answers with a value from the scale", () => {
    for (const tier of [...PROVENANCE_TIERS, "bogus", undefined]) {
      expect(PHOTO_CONFIDENCE).toContain(photoConfidence(photo({ provenance: tier })));
    }
  });
});

describe("generic (illustrative) photos — labelled, never passed off as the place", () => {
  it("says so in English, on the badge, in the full label and in the alt text", () => {
    state.lang = "en";
    const p = photo({ provenance: "generic" });
    expect(provenanceBadge(p)).toBe("Generic image");
    expect(provenanceLabel(p)).toBe("Generic image — not verified as this exact place");
    expect(photoAltText({ ...p, alt: "" }, "Tarbes")).toBe("Generic image for Tarbes");
  });

  it("says so in French too", () => {
    state.lang = "fr";
    const p = photo({ provenance: "generic" });
    expect(provenanceBadge(p)).toBe("Image générique");
    expect(provenanceLabel(p)).toBe("Image générique — lieu exact non vérifié");
    expect(photoAltText({ ...p, alt: "" }, "Tarbes")).toBe("Image générique pour Tarbes");
  });

  it("keeps a provider's own description as the alt text when it has one", () => {
    expect(photoAltText(photo({ provenance: "generic", alt: "Old town street" }), "Tarbes")).toBe(
      "Old town street",
    );
  });

  it("keeps the badge short enough to sit on a small card", () => {
    for (const lang of ["en", "fr"]) {
      state.lang = lang;
      expect(provenanceBadge(photo({ provenance: "generic" })).length).toBeLessThanOrEqual(15);
    }
  });
});

describe("the five requested labels, in both languages", () => {
  const tiers = {
    exact: photo({ provenance: "exact" }),
    nearby: photo({ provenance: "nearby" }),
    regional: photo({ approximate: true, areaKind: "region", approximateOf: "Occitanie" }),
    country: photo({ approximate: true, areaKind: "country", approximateOf: "France" }),
    generic: photo({ provenance: "generic" }),
  };

  it("English: Exact place photo / Nearby photo / Regional photo / Country photo / Generic image", () => {
    state.lang = "en";
    expect(Object.values(tiers).map(provenanceBadge)).toEqual([
      "Exact place photo",
      "Nearby photo",
      "Regional photo",
      "Country photo",
      "Generic image",
    ]);
  });

  it("French: the same five, translated", () => {
    state.lang = "fr";
    expect(Object.values(tiers).map(provenanceBadge)).toEqual([
      "Photo exacte du lieu",
      "Photo à proximité",
      "Photo régionale",
      "Photo du pays",
      "Image générique",
    ]);
  });

  it("never gives two tiers the same badge, so none can pass for another", () => {
    for (const lang of ["en", "fr"]) {
      state.lang = lang;
      const badges = Object.values(tiers).map(provenanceBadge);
      expect(new Set(badges).size).toBe(badges.length);
    }
  });

  it("says which landmark a state or country photo shows, without calling it the area", () => {
    state.lang = "en";
    const alamo = asAreaLandmark(photo(), "The Alamo", "state");
    expect(photoProvenance(alamo)).toBe("regional");
    expect(provenanceLabel(alamo)).toBe("Photo of The Alamo, not of this place itself");
    expect(photoProvenance(asAreaLandmark(photo(), "Eiffel Tower", "country"))).toBe("country");
    /* a labelled copy, and total on a missing photo or landmark */
    expect(alamo).not.toBe(photo());
    expect(asAreaLandmark(null, "X", "state")).toBeNull();
    expect(photoProvenance(asAreaLandmark(photo(), "", "state"))).toBe("exact");
  });
});
