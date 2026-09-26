/* Which search result comes first, and whether Enter may pick it.
 *
 * Typing "Paris" must offer Paris, France first and let Enter take it — while
 * "Springfield" (seven equally plain matches) must NOT be decided for the
 * visitor. Both answers come from one rule: a result is picked for you only
 * when something in the ranking actually separates it from the runner-up.
 *
 * Priority, strongest first:
 *   0. a country whose own name was typed exactly, in either language —
 *      "Japan" is Japan, never Japan, Missouri
 *   1. an exact city-name match with a known country
 *   2. a capital or major city (data/major-cities.js)
 *   3. an exact match near the visitor's current location
 *   4. a popular or recently selected place (curated, favourite, recent)
 *   5. every other valid match — a municipality in its own right before a
 *      hamlet of the same name, then in the provider's own order
 *
 * The country rule outranks the rest because the name is the whole query: a
 * visitor who types a country's name and nothing else means the country. The
 * places that merely share the name (Cañada in Spain, Mexico in the
 * Philippines) stay in the list, right below it.
 *
 * How closely the NAME matches the query outranks all of these: "Paris Texas"
 * (the name plus a region that is really there) beats a bare "Paris", which
 * beats a place that merely starts with the letters typed.
 *
 * Pure: takes the lists as arguments and returns plain data, so the rules are
 * testable without a DOM (mirrors search-suggestions.js). */
import { normalize } from "../data/locations.js";
import { MAJOR_CITY_KEYS } from "../data/major-cities.js";
import { distanceKm } from "../services/photo-relevance.js";

/* How well a name matches what was typed. */
export const MATCH = Object.freeze({ OTHER: 1, PREFIX: 2, EXACT: 3, QUALIFIED: 4 });

const CITY_KINDS = new Set(["city", "town", "village"]);
/* Where priority()'s tuple keeps "a capital or major city". */
const MAJOR_CITY_RANK = 2;
/* MapTiler's own word for "a municipality in its own right" — as against a
   `place`, which is also a hamlet or neighbourhood inside another
   municipality. Both arrive as kind "city", so this is what still tells the
   town of Tarbes from a Tarbes farm in Lozère. */
const MUNICIPAL_TYPES = new Set(["municipality", "joint_municipality"]);
const SPOT_KINDS = new Set(["address", "poi"]);
const NEAR_USER_KM = 100;
/* How far apart two same-named results may sit and still be one place. A
   curated entry and the provider's own copy of it never share exact
   coordinates: a country's point is its capital in one and its centroid in the
   other. */
const SAME_PLACE_KM = { local: 25, admin: 500 };

/* "  Paris,  FRANCE " → "paris france" */
function words(value) {
  return normalize(String(value || ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function variants(field) {
  if (!field) return [];
  if (typeof field === "string") return [field];
  return [field.en, field.fr].filter(Boolean);
}

/* Every spelling the place answers to, as normalized word strings. */
function nameWords(loc) {
  return [...new Set([...variants(loc.name), ...(loc.aliases || [])].map(words).filter(Boolean))];
}

/* What a qualifier such as "texas" or "france" may legitimately match. */
function areaWords(loc) {
  const text = [...variants(loc.region), ...variants(loc.country), loc.cc, loc.regionCode];
  return new Set(text.flatMap((value) => words(value).split(" ")).filter(Boolean));
}

/**
 * How closely `loc`'s own names match `query`.
 *   QUALIFIED  the name, then words that are really its region or country
 *              ("paris texas")
 *   EXACT      the whole name ("paris")
 *   PREFIX     a name that starts with it ("par" → Paris, Parma)
 *   OTHER      anything else that got through (fuzzy, or in the region text)
 */
export function matchStrength(query, loc) {
  const q = words(query);
  if (!q || !loc) return MATCH.OTHER;
  const names = nameWords(loc);
  if (names.includes(q)) return MATCH.EXACT;
  const area = areaWords(loc);
  const qualified = names.some((name) => {
    if (!q.startsWith(`${name} `)) return false;
    const rest = q.slice(name.length + 1).split(" ");
    return rest.every((word) => area.has(word));
  });
  if (qualified) return MATCH.QUALIFIED;
  return names.some((name) => name.startsWith(q)) ? MATCH.PREFIX : MATCH.OTHER;
}

export function isCityKind(loc) {
  return CITY_KINDS.has(loc?.kind);
}

export function isCountryKind(loc) {
  return loc?.kind === "country";
}

/** A capital or major city — by name and country, so a namesake elsewhere does not count. */
export function isMajorCity(loc) {
  if (!loc || !loc.cc || !isCityKind(loc)) return false;
  return nameWords(loc).some((name) =>
    MAJOR_CITY_KEYS.has(`${name}|${String(loc.cc).toUpperCase()}`),
  );
}

/* Two scales of "the same place": a town, street or landmark is one point
   (the provider's copy sits within a few km of the curated one), while a
   state or country is an area whose two representative points can be
   hundreds of km apart. */
function kindClass(loc) {
  return CITY_KINDS.has(loc.kind) || SPOT_KINDS.has(loc.kind) ? "local" : "admin";
}

/* Two results for one real place: same name, same country, same kind of
   place, and close together. Region text is NOT compared — the curated
   "Île-de-France" and the provider's "Ile-de-France" are the same region
   spelled twice, and a curated state's "United States" is a country the
   provider has no region for at all. */
export function isSamePlace(a, b) {
  if (a.cc !== b.cc || kindClass(a) !== kindClass(b)) return false;
  /* A country is one place per ISO code, however far apart the two providers
     put its point (Canada's capital and its centroid are ~1,900 km apart). */
  if (isCountryKind(a) && isCountryKind(b) && a.cc) return true;
  const known = new Set(nameWords(a));
  if (!nameWords(b).some((name) => known.has(name))) return false;
  const km = distanceKm(a.lat, a.lon, b.lat, b.lon);
  return km === null || km <= SAME_PLACE_KM[kindClass(a)];
}

/**
 * Curated and provider results as one list without duplicates. The FIRST
 * occurrence wins, so a curated entry (with its landmark and reviewed photo)
 * is kept over the provider's plain copy of the same place. Paris in France,
 * Texas and Ontario stay three places: they differ in country or distance.
 */
export function mergeSearchResults(curated, remote) {
  const out = [];
  for (const loc of [...curated, ...remote]) {
    if (loc?.name && !out.some((kept) => isSamePlace(kept, loc))) out.push(loc);
  }
  return out;
}

const idsOf = (list) => new Set((list || []).map((item) => item?.id).filter(Boolean));

/* Everything about the visitor the ranking may use, gathered by the caller so
   this module never reads state or asks for a permission of its own. */
export function rankingContext({ userPoint = null, favorites = [], recents = [] } = {}) {
  return { userPoint, favoriteIds: idsOf(favorites), recentIds: idsOf(recents) };
}

/* The rules below the name match, as one comparable tuple (higher is better). */
function priority(loc, strength, context) {
  const exact = strength >= MATCH.EXACT;
  const near =
    exact && context.userPoint
      ? distanceKm(loc.lat, loc.lon, context.userPoint.lat, context.userPoint.lon)
      : null;
  return [
    exact && isCountryKind(loc) ? 1 : 0, //         0. the country itself, named exactly
    exact && isCityKind(loc) && loc.cc ? 1 : 0, // 1. exact city with a known country
    isMajorCity(loc) ? 1 : 0, //                   2. capital or major city
    near !== null && near <= NEAR_USER_KM ? 1 : 0, // 3. exact match near the visitor
    (context.favoriteIds.has(loc.id) ? 2 : 0) + //  4. popular or recently selected
      (context.recentIds.has(loc.id) ? 1 : 0) +
      (loc.dynamic ? 0 : 1),
    /* 5. of the rest: a municipality in its own right over a hamlet of the
       same name. Last on purpose — it only breaks a tie the rules above left,
       so Paris, Tennessee (a municipality) never outranks Paris, France. A
       curated place is one by definition. */
    !loc.dynamic || MUNICIPAL_TYPES.has(loc.placeType) ? 1 : 0,
  ];
}

function compareTuples(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

/**
 * Orders `results` for `query` and decides whether the best one may be
 * chosen without asking.
 *
 * @returns {{
 *   results: object[],   the same places, best first
 *   best: boolean,       true when results[0] is clearly the answer
 *   ambiguous: boolean,  true when several places share an exact name and
 *                        nothing separates them
 * }}
 */
export function rankSearchResults(query, results, context = rankingContext()) {
  const scored = (results || []).map((loc, index) => {
    const strength = matchStrength(query, loc);
    return {
      loc,
      index,
      strength,
      spot: SPOT_KINDS.has(loc.kind) ? 1 : 0,
      tuple: priority(loc, strength, context),
    };
  });
  scored.sort(
    (a, b) =>
      b.strength - a.strength ||
      a.spot - b.spot ||
      compareTuples(a.tuple, b.tuple) ||
      a.index - b.index,
  );
  const ordered = scored.map((entry) => entry.loc);
  if (scored.length === 0) return { results: ordered, best: false, ambiguous: false };

  const [top, ...rest] = scored;
  const rivals = rest.filter((entry) => entry.strength === top.strength && entry.spot === top.spot);
  if (rivals.length === 0) return { results: ordered, best: true, ambiguous: false };

  const exact = top.strength >= MATCH.EXACT;
  /* An exact name is separated by any of the rules; a partial one ("Tar")
     only by being a major city — popularity alone is not enough to guess
     which of several places somebody was still typing. */
  const separated = exact
    ? compareTuples(top.tuple, rivals[0].tuple) !== 0
    : top.tuple[MAJOR_CITY_RANK] > rivals[0].tuple[MAJOR_CITY_RANK];
  return { results: ordered, best: separated, ambiguous: !separated && exact };
}
