/* What a Vietnamese reader is told about a photo: the label on the image, the
 * sentence in its tooltip and accessible name, and the alt text. Every tier
 * says what the picture is — and none of them reads as English. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { I18N } from "../data/translations.js";
import {
  provenanceLabel,
  provenanceBadge,
  photoAltText,
  asWaterOverview,
  asAreaLandmark,
} from "./photo-provenance.js";

const TIERS = {
  exact: {},
  nearby: { provenance: "nearby", subjectName: "Nhà thờ Tarbes" },
  regional: { approximate: true, approximateOf: "Occitanie" },
  country: { approximate: true, approximateOf: "Pháp", areaKind: "country" },
  generic: { provenance: "generic" },
  overview: { provenance: "overview", overviewOf: "Địa Trung Hải" },
};

const englishOf = (key) => I18N.en[key];

describe("photo labels in Vietnamese", () => {
  beforeEach(() => {
    state.lang = "vi";
  });

  it("gives every tier a short badge in Vietnamese, different from English", () => {
    const badges = Object.values(TIERS).map((photo) => provenanceBadge(photo));
    expect(badges.every(Boolean)).toBe(true);
    expect(new Set(badges).size).toBe(badges.length);
    for (const badge of badges) expect(Object.values(I18N.en)).not.toContain(badge);
    expect(provenanceBadge(TIERS.exact)).toBe("Ảnh đúng địa điểm");
    expect(provenanceBadge(TIERS.nearby)).toBe("Ảnh gần đó");
    expect(provenanceBadge(TIERS.regional)).toBe("Ảnh khu vực");
    expect(provenanceBadge(TIERS.country)).toBe("Ảnh quốc gia");
    expect(provenanceBadge(TIERS.generic)).toBe("Ảnh minh họa");
    expect(provenanceBadge(TIERS.overview)).toBe("Toàn cảnh");
  });

  it("says what each photo is in a full sentence", () => {
    expect(provenanceLabel(TIERS.exact)).toBe("Ảnh đúng địa điểm");
    expect(provenanceLabel(TIERS.nearby)).toBe(
      "Gần đó: Nhà thờ Tarbes — không phải ảnh của chính địa điểm này",
    );
    expect(provenanceLabel({ provenance: "nearby" })).toBe(
      "Ảnh gần đó, không phải của chính địa điểm này",
    );
    expect(provenanceLabel(TIERS.regional)).toBe(
      "Ảnh của Occitanie, không phải của chính địa điểm này",
    );
    expect(provenanceLabel(TIERS.country)).toBe("Ảnh của Pháp, không phải của chính địa điểm này");
    expect(provenanceLabel(TIERS.generic)).toBe(
      "Hình ảnh minh họa chung — chưa xác minh là chính địa điểm này",
    );
    expect(provenanceLabel(TIERS.overview)).toBe(
      "Toàn cảnh Địa Trung Hải — hình ảnh minh họa chung, không phải nơi này chính xác",
    );
    expect(provenanceLabel(null)).toBe("");
  });

  it("never mixes English into a label", () => {
    for (const photo of Object.values(TIERS)) {
      const label = provenanceLabel(photo);
      expect(label).not.toMatch(/\b(photo of|not of this|nearby|overview|generic image)\b/i);
    }
  });

  it("writes alt text that names the place, in Vietnamese", () => {
    expect(photoAltText({}, "Tarbes")).toBe("Ảnh của Tarbes");
    expect(photoAltText(TIERS.nearby, "Tarbes")).toBe("Ảnh chụp ở mặt đất gần Tarbes");
    expect(photoAltText(TIERS.overview, "Địa Trung Hải")).toBe("Toàn cảnh Địa Trung Hải");
    expect(photoAltText(TIERS.generic, "Tarbes")).toBe("Ảnh minh họa cho Tarbes");
    /* a provider's own caption is kept as it wrote it */
    expect(photoAltText({ alt: "A city skyline" }, "Tarbes")).toBe("A city skyline");
  });

  it("labels a water body and a landmark-for-an-area the same way as the others", () => {
    expect(provenanceLabel(asWaterOverview({ src: "x" }, "Đại Tây Dương"))).toContain("Toàn cảnh");
    expect(provenanceLabel(asAreaLandmark({ src: "x" }, "Tháp Eiffel", "region"))).toBe(
      "Ảnh của Tháp Eiffel, không phải của chính địa điểm này",
    );
  });

  it("credits each provider in Vietnamese with its name and licence", () => {
    const credit = (key, values) =>
      Object.entries(values).reduce(
        (text, [name, v]) => text.replace(`{${name}}`, v),
        I18N.vi[key],
      );
    expect(credit("photoCredit", { photographer: "Ada" })).toBe("Ảnh của Ada trên Pexels");
    expect(credit("photoCreditUnsplash", { photographer: "Nick Castelli" })).toBe(
      "Ảnh của Nick Castelli trên Unsplash",
    );
    expect(credit("photoCreditWikimedia", { photographer: "Ada", license: "CC0" })).toBe(
      "Ảnh của Ada (CC0) qua Wikimedia Commons",
    );
    expect(credit("photoCreditGoogle", { photographer: "Ada" })).toBe("Ảnh của Ada qua Google");
    expect(
      credit("photoCreditMapillary", { photographer: "a_contributor", license: "CC BY-SA 4.0" }),
    ).toBe("Ảnh của a_contributor (CC BY-SA 4.0) qua Mapillary");
    for (const key of ["photoCredit", "photoCreditUnsplash", "photoCreditWikimedia"]) {
      expect(I18N.vi[key]).not.toBe(englishOf(key));
    }
  });

  it("leaves English untouched", () => {
    state.lang = "en";
    expect(provenanceBadge(TIERS.exact)).toBe("Exact place photo");
    expect(provenanceLabel(TIERS.regional)).toBe("Photo of Occitanie, not of this place itself");
  });
});
