/* What a Spanish reader is told about a photo: the label on the image, the
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
  nearby: { provenance: "nearby", subjectName: "Catedral de Tarbes" },
  regional: { approximate: true, approximateOf: "Occitania" },
  country: { approximate: true, approximateOf: "Francia", areaKind: "country" },
  generic: { provenance: "generic" },
  overview: { provenance: "overview", overviewOf: "Mar Mediterráneo" },
};

const englishOf = (key) => I18N.en[key];

describe("photo labels in Spanish", () => {
  beforeEach(() => {
    state.lang = "es";
  });

  it("gives every tier a short badge in Spanish, different from English", () => {
    const badges = Object.values(TIERS).map((photo) => provenanceBadge(photo));
    expect(badges.every(Boolean)).toBe(true);
    expect(new Set(badges).size).toBe(badges.length);
    for (const badge of badges) expect(Object.values(I18N.en)).not.toContain(badge);
    expect(provenanceBadge(TIERS.exact)).toBe("Foto del lugar exacto");
    expect(provenanceBadge(TIERS.nearby)).toBe("Foto cercana");
    expect(provenanceBadge(TIERS.regional)).toBe("Foto de la región");
    expect(provenanceBadge(TIERS.country)).toBe("Foto del país");
    expect(provenanceBadge(TIERS.generic)).toBe("Imagen genérica");
    expect(provenanceBadge(TIERS.overview)).toBe("Vista general");
  });

  it("says what each photo is in a full sentence", () => {
    expect(provenanceLabel(TIERS.exact)).toBe("Foto del lugar exacto");
    expect(provenanceLabel(TIERS.nearby)).toBe(
      "Cerca: Catedral de Tarbes — no es una foto del lugar en sí",
    );
    expect(provenanceLabel({ provenance: "nearby" })).toBe("Foto cercana, no del lugar en sí");
    expect(provenanceLabel(TIERS.regional)).toBe("Foto de Occitania, no del lugar en sí");
    expect(provenanceLabel(TIERS.country)).toBe("Foto de Francia, no del lugar en sí");
    expect(provenanceLabel(TIERS.generic)).toBe(
      "Imagen genérica — no verificada como este lugar exacto",
    );
    expect(provenanceLabel(TIERS.overview)).toBe(
      "Vista general de Mar Mediterráneo — una imagen genérica, no este punto exacto",
    );
    expect(provenanceLabel(null)).toBe("");
  });

  it("never mixes English into a label", () => {
    for (const photo of Object.values(TIERS)) {
      const label = provenanceLabel(photo);
      expect(label).not.toMatch(/\b(photo of|not of this|nearby|overview|generic image)\b/i);
    }
  });

  it("writes alt text that names the place, in Spanish", () => {
    expect(photoAltText({}, "Tarbes")).toBe("Foto de Tarbes");
    expect(photoAltText(TIERS.nearby, "Tarbes")).toBe("Foto a pie de calle tomada cerca de Tarbes");
    expect(photoAltText(TIERS.overview, "el Mediterráneo")).toBe(
      "Vista general de el Mediterráneo",
    );
    expect(photoAltText(TIERS.generic, "Tarbes")).toBe("Imagen genérica de Tarbes");
    /* a provider's own caption is kept as it wrote it */
    expect(photoAltText({ alt: "A city skyline" }, "Tarbes")).toBe("A city skyline");
  });

  it("labels a water body and a landmark-for-an-area the same way as the others", () => {
    expect(provenanceLabel(asWaterOverview({ src: "x" }, "el Atlántico"))).toContain(
      "Vista general",
    );
    expect(provenanceLabel(asAreaLandmark({ src: "x" }, "Torre Eiffel", "region"))).toBe(
      "Foto de Torre Eiffel, no del lugar en sí",
    );
  });

  it("credits each provider in Spanish with its name and licence", () => {
    const credit = (key, values) =>
      Object.entries(values).reduce(
        (text, [name, v]) => text.replace(`{${name}}`, v),
        I18N.es[key],
      );
    expect(credit("photoCredit", { photographer: "Ada" })).toBe("Foto de Ada en Pexels");
    expect(credit("photoCreditUnsplash", { photographer: "Nick Castelli" })).toBe(
      "Foto de Nick Castelli en Unsplash",
    );
    expect(credit("photoCreditWikimedia", { photographer: "Ada", license: "CC0" })).toBe(
      "Foto de Ada (CC0) vía Wikimedia Commons",
    );
    expect(credit("photoCreditGoogle", { photographer: "Ada" })).toBe("Foto de Ada vía Google");
    expect(
      credit("photoCreditMapillary", { photographer: "a_contributor", license: "CC BY-SA 4.0" }),
    ).toBe("Foto de a_contributor (CC BY-SA 4.0) vía Mapillary");
    for (const key of ["photoCredit", "photoCreditUnsplash", "photoCreditWikimedia"]) {
      expect(I18N.es[key]).not.toBe(englishOf(key));
    }
  });

  it("leaves English untouched", () => {
    state.lang = "en";
    expect(provenanceBadge(TIERS.exact)).toBe("Exact place photo");
    expect(provenanceLabel(TIERS.regional)).toBe("Photo of Occitania, not of this place itself");
  });
});
