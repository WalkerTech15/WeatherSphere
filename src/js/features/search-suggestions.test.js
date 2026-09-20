import { describe, it, expect } from "vitest";
import { buildSuggestions, suggestionKey, SUGGESTION_LIMITS } from "./search-suggestions.js";

const place = (en, cc = "FR", region = "", extra = {}) => ({
  id: `${en}-${cc}-${region}`.toLowerCase(),
  name: { en, fr: en },
  cc,
  region: { en: region, fr: region },
  ...extra,
});

describe("search suggestions", () => {
  it("orders sections recent → favorites → popular", () => {
    const sections = buildSuggestions({
      recents: [place("Lyon")],
      favorites: [place("Nice")],
      popular: [place("Tokyo", "JP")],
    });
    expect(sections.map((s) => s.id)).toEqual(["recent", "favorites", "popular"]);
  });

  it("omits a section that has nothing in it rather than showing an empty heading", () => {
    const sections = buildSuggestions({
      favorites: [place("Nice")],
      popular: [place("Tokyo", "JP")],
    });
    expect(sections.map((s) => s.id)).toEqual(["favorites", "popular"]);
    expect(buildSuggestions({})).toEqual([]);
  });

  it("caps each section", () => {
    const many = (n) => Array.from({ length: n }, (_, i) => place(`City${i}`, "US", `R${i}`));
    const sections = buildSuggestions({
      recents: many(9),
      favorites: many(9).map((p) => ({ ...p, name: { en: `F${p.name.en}` } })),
      popular: many(9).map((p) => ({ ...p, name: { en: `P${p.name.en}` } })),
    });
    const counts = Object.fromEntries(sections.map((s) => [s.id, s.items.length]));
    expect(counts).toEqual(SUGGESTION_LIMITS);
  });

  it("lists a place once, under the first section that claims it", () => {
    const paris = place("Paris", "FR", "Île-de-France");
    const sections = buildSuggestions({
      recents: [paris],
      favorites: [place("Paris", "FR", "Île-de-France"), place("Nice")],
      popular: [place("Paris", "FR", "Île-de-France"), place("Tokyo", "JP")],
    });
    const all = sections.flatMap((s) => s.items.map((i) => i.name.en));
    expect(all.filter((n) => n === "Paris")).toHaveLength(1);
    expect(sections[0].id).toBe("recent");
  });

  it("keeps genuinely different places that share a name", () => {
    const sections = buildSuggestions({
      favorites: [place("Paris", "FR", "Île-de-France"), place("Paris", "US", "Texas")],
    });
    expect(sections[0].items).toHaveLength(2);
    expect(suggestionKey(place("Paris", "FR", "A"))).not.toBe(
      suggestionKey(place("Paris", "US", "A")),
    );
  });

  it("is accent- and case-insensitive when matching duplicates", () => {
    const sections = buildSuggestions({
      recents: [place("Québec", "CA", "Québec")],
      popular: [place("QUEBEC", "CA", "quebec")],
    });
    expect(sections.flatMap((s) => s.items)).toHaveLength(1);
  });

  it("skips malformed stored entries instead of throwing or rendering them", () => {
    const sections = buildSuggestions({
      recents: [null, undefined, {}, { name: {} }, place("Lyon")],
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((i) => i.name.en)).toEqual(["Lyon"]);
  });

  it("does not spend the cap on a duplicate", () => {
    /* three recents, the first two already claimed nothing — but a favourite
       that repeats a recent must not use up a favourites slot */
    const shared = place("Lyon");
    const sections = buildSuggestions({
      recents: [shared],
      favorites: [place("Lyon"), place("Nice"), place("Lille"), place("Nantes")],
    });
    expect(sections.find((s) => s.id === "favorites").items.map((i) => i.name.en)).toEqual([
      "Nice",
      "Lille",
      "Nantes",
    ]);
  });
});
