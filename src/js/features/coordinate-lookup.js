/* Coordinate → location, with the honest fallbacks.
 *
 * Split out of features/map-click.js so it can be unit-tested on its own: this
 * half touches no DOM and no map, only the existing geocoding service and
 * core/coord-location.js. The reverse lookup is cached and deduplicated by
 * coordinate inside services/geocoding-api.js, so clicking around the same
 * spot does not repeat requests.
 *
 * Never throws. A provider failure and an empty result are different things
 * and are reported separately:
 *   - empty result  → open ocean or an unnamed place; `coordsOnly` is set and
 *                     the coordinate becomes the name.
 *   - failure       → `geocodeFailed`; the caller shows a translated,
 *                     non-blocking notice while the weather still loads. */
import { coordLocation } from "../core/coord-location.js";
import { LOCATIONS, normalize } from "../data/locations.js";
import { haversineKm } from "../core/geo.js";
import { reverseGeocodeLocation } from "../services/geocoding-api.js";

/* URL restores carry coordinates, while a curated search result may also
   carry reviewed landmark/photo data. Reattach that richer record only when
   the reverse-geocoder independently agrees on the place identity. */
function curatedMatch(lat, lon, info) {
  const nameValues =
    typeof info?.name === "string"
      ? [info.name]
      : [info?.name?.en, info?.name?.fr];
  const names = new Set(
    nameValues
      .filter(Boolean)
      .map((value) => normalize(value)),
  );
  if (!names.size || !info?.cc) return null;
  return (
    LOCATIONS.find((candidate) => {
      if (candidate.cc !== info.cc || candidate.kind !== info.kind) return false;
      if (!names.has(normalize(candidate.name?.en)) && !names.has(normalize(candidate.name?.fr))) {
        return false;
      }
      return haversineKm(lat, lon, candidate.lat, candidate.lon) <= 5;
    }) || null
  );
}

export async function resolveCoordinateLocation(
  lat,
  lon,
  { lookup = reverseGeocodeLocation } = {},
) {
  let info = null;
  let geocodeFailed = false;
  try {
    info = await lookup(lat, lon);
  } catch {
    geocodeFailed = true;
  }
  return {
    loc: curatedMatch(lat, lon, info) || coordLocation(lat, lon, info || {}, { idPrefix: "map" }),
    geocodeFailed,
  };
}
