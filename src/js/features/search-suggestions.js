/* What the search menu offers before anything is typed.
 *
 * Pure: takes the lists as arguments and returns the sections to show, so the
 * rules (order, caps, no place listed twice) are testable without a DOM.
 *
 * Order is "closest to what you were just doing" first: places you searched
 * for, then places you pinned, then a short list of popular ones for a visitor
 * with neither. A place is listed once, under the first section that claims it
 * — a favourite you also searched for yesterday reads as Recent, not twice.
 * Recents are opt-in (see recent-locations.js), so an empty list is normal and
 * simply yields no Recent section rather than an empty one. */
import { normalize } from "../data/locations.js";

export const SUGGESTION_LIMITS = { recent: 3, favorites: 3, popular: 5 };

/* Same identity the results list uses to collapse duplicates: name + country +
   region, so "Paris, France" and "Paris, Texas" stay distinct places. */
export function suggestionKey(loc) {
  return `${normalize(loc.name.en)}|${loc.cc || ""}|${normalize(loc.region?.en || "")}`;
}

export function buildSuggestions({
  recents = [],
  favorites = [],
  popular = [],
  limits = SUGGESTION_LIMITS,
} = {}) {
  const seen = new Set();
  const sections = [];
  for (const [id, list] of [
    ["recent", recents],
    ["favorites", favorites],
    ["popular", popular],
  ]) {
    const items = [];
    for (const loc of list) {
      if (items.length >= limits[id]) break;
      if (!loc?.name?.en) continue; /* a malformed stored entry is skipped, never rendered */
      const key = suggestionKey(loc);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(loc);
    }
    if (items.length) sections.push({ id, items });
  }
  return sections;
}
