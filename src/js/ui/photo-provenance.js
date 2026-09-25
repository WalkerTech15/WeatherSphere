/* How honest the photo on screen is about what it shows.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The photo chain has seven steps and they do NOT all make the same claim.
 * A curated image and a Google place match really are pictures of the
 * selected place. A Mapillary frame is a picture taken at the place. A region
 * fallback is a picture of somewhere nearby that happens to be in the same
 * administrative area. Displaying all three identically — a photo, a
 * photographer, a source link — silently upgrades the weakest of them into a
 * claim it cannot support, which is the exact failure the whole pipeline
 * exists to prevent.
 *
 * So every photo carries a `provenance`, and the credit says which:
 *
 *   exact     this IS the selected place            "Exact place photo"
 *   nearby    taken at or beside it                 "Nearby photo"
 *   regional  somewhere in the surrounding region   "Photo of <region>, not
 *                                                    of this place itself"
 *   country   somewhere in the country              same, with the country
 *   overview  a general image of open water         "Overview of <water> — a
 *             (an ocean or sea has no "exact" photo:  general image, not this
 *             a satellite frame, a map, a seascape)   exact spot"
 *   generic   a stock photo matched on words only   "Illustrative photo — not
 *             (Pexels): plausibly the place, but      verified as this exact
 *             nothing proves it                       place"
 *
 * Every tier is announced, `exact` included: an absent label cannot be told
 * apart from a photo nobody has checked, so the picture says "Exact place
 * photo" when it is one, and the reader never has to infer it from silence.
 *
 * Pure functions only — no DOM, no state — so every wording rule is testable
 * and the renderer in services/photo-api.js stays a renderer.
 */
import { t } from "../core/i18n.js";

export const PROVENANCE_TIERS = ["exact", "nearby", "regional", "country", "overview", "generic"];

/* The image model's one explicit confidence scale — what a photo can be
   trusted to show, from strongest to none. The tiers above keep the finer
   distinctions the WORDING needs (a country photo is a weaker admission than
   a regional one; open water gets its own sentence); this collapses them to
   the five outcomes the rest of the app and the tests reason about:

     exact     verified to show the selected place
     nearby    verified to be taken at or beside it
     regional  a photo of its region or country, labelled as such
     generic   representative only — nothing ties it to this exact spot
     none      no trustworthy photo, so the local visual fallback stays */
export const PHOTO_CONFIDENCE = ["exact", "nearby", "regional", "generic", "none"];

export function photoConfidence(photo) {
  const tier = photoProvenance(photo);
  if (!tier) return "none";
  if (tier === "exact" || tier === "nearby") return tier;
  if (tier === "regional" || tier === "country") return "regional";
  return "generic"; /* overview, generic */
}

/* An ocean or sea is never photographed "as itself": whatever Commons or
   Pexels returns for it — an astronaut's frame, a locator map, a stretch of
   coast — is a general view of that water. Returns a labelled COPY (the same
   photo object is shared through the provider caches). */
export function asWaterOverview(photo, waterName) {
  if (!photo) return photo;
  return { ...photo, provenance: "overview", overviewOf: waterName || "" };
}

/* A reviewed photo of a landmark standing IN a state, province or country —
   the Alamo for Texas, the CN Tower for Ontario. The picture is genuine and
   correctly identified, but it is not a picture of the whole area, and
   calling it an exact photo of "Texas" would say otherwise. Labelled as a
   regional (or country) photo of the landmark it shows. Returns a labelled
   COPY, for the same reason as asWaterOverview. */
export function asAreaLandmark(photo, landmarkName, kind) {
  if (!photo || !landmarkName) return photo;
  return {
    ...photo,
    approximate: true,
    approximateOf: landmarkName,
    areaKind: kind === "country" ? "country" : "region",
  };
}

/* The one place that decides a photo's tier, so no caller has to re-derive it
   from a mix of `source`, `approximate` and `approximateOf`. Providers set
   `provenance` directly (Google, Mapillary); the older ones are mapped from
   the fields they already carry, which keeps their code untouched. */
export function photoProvenance(photo) {
  if (!photo) return "";
  if (PROVENANCE_TIERS.includes(photo.provenance)) return photo.provenance;
  /* The area fallback (services/photo-api.js) marks itself `approximate` and
     names the area it actually depicts. */
  if (photo.approximate) return photo.areaKind === "country" ? "country" : "regional";
  /* Everything else got here by naming the place or by sitting on its
     coordinates, both of which are claims about the place itself. */
  return "exact";
}

/**
 * The sentence naming what the photo is, shown in the credit's accessible
 * name and tooltip, or "" when there is no photo.
 *
 * @returns {string} already-localized, NOT html-escaped (callers escape).
 */
export function provenanceLabel(photo) {
  const tier = photoProvenance(photo);
  if (tier === "") return "";
  if (tier === "exact") return t("photoExact");
  if (tier === "overview") {
    return photo.overviewOf
      ? t("photoOverview").replace("{area}", photo.overviewOf)
      : t("photoOverviewShort");
  }
  if (tier === "generic") return t("photoGeneric");
  if (tier === "nearby") {
    /* Name the subject when we know it ("Nearby · Tarbes Cathedral"), so the
       visitor can see WHAT they are looking at rather than only being told
       it is not the city. */
    const subject = photo.subjectName || "";
    return subject ? t("photoNearbyNamed").replace("{subject}", subject) : t("photoNearby");
  }
  /* regional / country — the existing wording, which already says plainly
     that this is not a photo of the place itself. */
  return t("photoApproximate").replace("{area}", photo.approximateOf || "");
}

/* One short label per tier, in the visitor's language. */
const BADGE_KEYS = {
  exact: "photoExactShort",
  nearby: "photoNearbyShort",
  regional: "photoRegionalShort",
  country: "photoCountryShort",
  overview: "photoOverviewShort",
  generic: "photoGenericShort",
};

/* The short text that sits ON the image: what kind of picture this is, in a
   few words. The full sentence — including WHICH area a regional photo shows
   — lives in the link's accessible name and tooltip. */
export function provenanceBadge(photo) {
  const key = BADGE_KEYS[photoProvenance(photo)];
  return key ? t(key) : "";
}

/**
 * Alt text for the image itself.
 *
 * A provider that describes its own photo (Pexels' caption, a Commons file
 * description) keeps that description — it is better than anything generated
 * here. A provider that does not (Mapillary returns no caption at all) gets a
 * sentence naming the place and the tier, so a screen-reader user is told the
 * same thing a sighted user reads in the credit, rather than meeting an
 * unlabelled image.
 */
export function photoAltText(photo, placeName) {
  if (!photo) return "";
  if (photo.alt) return photo.alt;
  const name = placeName || "";
  if (!name) return "";
  const tier = photoProvenance(photo);
  if (tier === "nearby") return t("photoAltNearby").replace("{place}", name);
  if (tier === "overview") return t("photoAltOverview").replace("{place}", name);
  if (tier === "generic") return t("photoAltGeneric").replace("{place}", name);
  return t("photoAltExact").replace("{place}", name);
}
