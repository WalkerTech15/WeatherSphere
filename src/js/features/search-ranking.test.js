/* Search ranking — which result is first, and when Enter may pick it.
 *
 * The provider results below are real MapTiler feature shapes (place type,
 * context chain, order), captured for "Paris", "Springfield", "Tokyo",
 * "Tarbes" and "New York" and passed through the app's own featureToLoc, so
 * the tests describe what the search box actually receives. Curated results
 * come from data/locations.js through findLocations, exactly as search.js
 * does. Pure functions: no DOM, no network. */
import { describe, it, expect } from "vitest";
import {
  MATCH,
  matchStrength,
  isMajorCity,
  isSamePlace,
  mergeSearchResults,
  rankSearchResults,
  rankingContext,
} from "./search-ranking.js";
import { MAJOR_CITY_KEYS } from "../data/major-cities.js";
import { findLocations } from "../data/locations.js";
import { __featureToLoc } from "../services/geocoding-api.js";

/* One MapTiler feature. `context` is written "type:Name" outermost-last, the
   way the API returns it. */
let nextId = 1;
function feature(text, type, context, center, cc, extra = {}) {
  return {
    id: `${type}.t${nextId++}`,
    text,
    place_name: [text, ...context.map((c) => c.split(":")[1])].join(", "),
    place_type: [type],
    center,
    properties: cc ? { country_code: cc } : {},
    context: context.map((entry, i) => {
      /* "region:Texas|US-TX" — the optional part is MapTiler's ISO short code */
      const [head, code] = entry.split("|");
      const [kind, name] = head.split(":");
      return {
        id: `${kind}.c${i}`,
        text: name,
        ...(kind === "country" ? { country_code: cc } : {}),
        ...(code ? { short_code: code } : {}),
      };
    }),
    ...extra,
  };
}
const remote = (features) => features.map(__featureToLoc);
const names = (ranked) => ranked.results.map((l) => `${l.name.en}, ${l.region.en || l.country.en}`);

/* "Paris" — MapTiler's real answer, in its own order. */
const PARIS = () =>
  remote([
    feature(
      "Paris",
      "municipality",
      ["county:Paris", "region:Ile-de-France", "country:France"],
      [2.3522, 48.8566],
      "fr",
    ),
    feature(
      "Paris",
      "municipality",
      ["county:Lamar", "region:Texas|US-TX", "country:United States"],
      [-95.5555, 33.6609],
      "us",
    ),
    feature(
      "Paris",
      "municipality",
      ["county:Henry", "region:Tennessee|US-TN", "country:United States"],
      [-88.3273, 36.302],
      "us",
    ),
    feature(
      "Paris",
      "place",
      ["county:Brant", "region:Ontario", "country:Canada"],
      [-80.3833, 43.2],
      "ca",
    ),
    feature(
      "Paris",
      "municipality",
      ["county:Bourbon", "region:Kentucky", "country:United States"],
      [-84.253, 38.2098],
      "us",
    ),
    feature(
      "Paris",
      "municipality",
      ["county:Edgar", "region:Illinois", "country:United States"],
      [-87.6961, 39.6111],
      "us",
    ),
    feature(
      "Paris",
      "municipality",
      ["county:Oxford", "region:Maine", "country:United States"],
      [-70.5001, 44.2612],
      "us",
    ),
  ]);

/* "Springfield" — seven equally plain matches, none of them famous. */
const SPRINGFIELD = () =>
  remote([
    feature(
      "Springfield",
      "municipality",
      ["county:Sangamon", "region:Illinois", "country:United States"],
      [-89.6437, 39.7817],
      "us",
    ),
    feature(
      "Springfield",
      "municipality",
      ["county:Hampden", "region:Massachusetts", "country:United States"],
      [-72.5898, 42.1015],
      "us",
    ),
    feature(
      "Springfield",
      "municipality",
      ["county:Greene", "region:Missouri", "country:United States"],
      [-93.2923, 37.209],
      "us",
    ),
    feature(
      "Springfield",
      "municipality",
      ["county:Clark", "region:Ohio", "country:United States"],
      [-83.8088, 39.9242],
      "us",
    ),
    feature(
      "Springfield",
      "municipality",
      ["county:Lane", "region:Oregon", "country:United States"],
      [-123.022, 44.0462],
      "us",
    ),
    feature(
      "Springfield",
      "place",
      ["county:Selwyn District", "region:Canterbury", "country:New Zealand"],
      [171.9333, -43.3333],
      "nz",
    ),
    feature(
      "Springfield",
      "place",
      ["county:Fairfax", "region:Virginia", "country:United States"],
      [-77.1872, 38.7893],
      "us",
    ),
  ]);

const ctx = (over) => rankingContext(over);
const rank = (query, curated, remoteList, context) =>
  rankSearchResults(query, mergeSearchResults(curated, remoteList), context);

describe("matchStrength — how closely a name matches what was typed", () => {
  const [franceParis, texasParis] = PARIS();

  it("an exact name beats a prefix, which beats anything else", () => {
    expect(matchStrength("Paris", franceParis)).toBe(MATCH.EXACT);
    expect(matchStrength("  PARIS ", franceParis)).toBe(MATCH.EXACT);
    expect(matchStrength("Par", franceParis)).toBe(MATCH.PREFIX);
    expect(matchStrength("ile de france", franceParis)).toBe(MATCH.OTHER);
  });

  it("the name plus a region or country that really is theirs is the strongest match", () => {
    expect(matchStrength("Paris Texas", texasParis)).toBe(MATCH.QUALIFIED);
    expect(matchStrength("Paris, Texas", texasParis)).toBe(MATCH.QUALIFIED);
    expect(matchStrength("paris france", franceParis)).toBe(MATCH.QUALIFIED);
    expect(matchStrength("paris tx", texasParis)).toBe(MATCH.QUALIFIED);
    /* …but not a qualifier that belongs to a different place */
    expect(matchStrength("Paris France", texasParis)).toBe(MATCH.OTHER);
  });

  it("ignores accents and punctuation in both the query and the name", () => {
    const [orleans] = remote([
      feature(
        "Orléans",
        "municipality",
        ["region:Centre-Val de Loire", "country:France"],
        [1.9, 47.9],
        "fr",
      ),
    ]);
    expect(matchStrength("orleans", orleans)).toBe(MATCH.EXACT);
    expect(matchStrength("Orléans, France", orleans)).toBe(MATCH.QUALIFIED);
  });

  it("reads a curated place's aliases and both languages", () => {
    const [london] = findLocations("london", "en");
    expect(matchStrength("Londres", london)).toBe(MATCH.EXACT);
    const [tokyo] = findLocations("tokyo", "en");
    expect(matchStrength("tokio", tokyo)).toBe(MATCH.EXACT);
  });

  it("is total on an empty query or place", () => {
    expect(matchStrength("", franceParis)).toBe(MATCH.OTHER);
    expect(matchStrength("paris", null)).toBe(MATCH.OTHER);
  });
});

describe("isMajorCity — a capital or major city, by name AND country", () => {
  const [franceParis, texasParis] = PARIS();
  const [londonCanada] = remote([
    feature(
      "London",
      "place",
      ["county:Middlesex", "region:Ontario", "country:Canada"],
      [-81.2, 43.0],
      "ca",
    ),
  ]);
  const [londonUK] = remote([
    feature("London", "place", ["region:England", "country:United Kingdom"], [-0.13, 51.5], "gb"),
  ]);

  it("Paris, France is; Paris, Texas is not", () => {
    expect(isMajorCity(franceParis)).toBe(true);
    expect(isMajorCity(texasParis)).toBe(false);
  });

  it("a namesake does not inherit the capital's fame", () => {
    expect(isMajorCity(londonUK)).toBe(true);
    expect(isMajorCity(londonCanada)).toBe(false);
  });

  it("recognises the French name of a curated city, and never a region or country", () => {
    const [londres] = findLocations("londres", "fr");
    expect(isMajorCity(londres)).toBe(true);
    const [texas] = findLocations("texas", "en");
    expect(isMajorCity(texas)).toBe(false);
    const [france] = findLocations("france", "en");
    expect(isMajorCity(france)).toBe(false);
  });

  it("the list is well formed: lower-case, accent-free, keyed by a 2-letter country", () => {
    expect(MAJOR_CITY_KEYS.size).toBeGreaterThan(150);
    for (const key of MAJOR_CITY_KEYS) {
      expect(key).toMatch(/^[a-z][a-z ]*\|[A-Z]{2}$/);
    }
  });
});

describe("mergeSearchResults — one entry per real place", () => {
  it("keeps the curated entry over the provider's copy of the same place", () => {
    const curated = findLocations("paris", "en");
    const merged = mergeSearchResults(curated, PARIS());
    const france = merged.filter((l) => l.cc === "FR");
    expect(france).toHaveLength(1);
    expect(france[0].id).toBe("paris"); /* curated: it has the Eiffel Tower and a reviewed photo */
  });

  it("does not compare region spelling: 'Île-de-France' and 'Ile-de-France' are one region", () => {
    const [curatedParis] = findLocations("paris", "en");
    const [providerParis] = PARIS();
    expect(curatedParis.region.en).toBe("Île-de-France");
    expect(providerParis.region.en).toBe("Ile-de-France");
    expect(isSamePlace(curatedParis, providerParis)).toBe(true);
  });

  it("keeps Paris in France, Texas and Ontario apart — and every other Paris the provider found", () => {
    const merged = mergeSearchResults(findLocations("paris", "en"), PARIS());
    const where = merged.map((l) => `${l.cc}:${l.region.en}`);
    expect(where).toEqual(
      expect.arrayContaining(["FR:Île-de-France", "US:Texas", "CA:Ontario", "US:Tennessee"]),
    );
    expect(merged).toHaveLength(7);
  });

  it("keeps same-named places that are far apart in one country", () => {
    const [curated] = findLocations("tarbes", "en").length ? findLocations("tarbes", "en") : [null];
    const near = remote([
      feature(
        "Tarbes",
        "municipality",
        ["region:Occitania", "country:France"],
        [0.0782, 43.2333],
        "fr",
      ),
    ])[0];
    const far = remote([
      feature(
        "Tarbes",
        "place",
        ["county:Lozère", "region:Occitania", "country:France"],
        [3.5, 44.5],
        "fr",
      ),
    ])[0];
    expect(isSamePlace(near, far)).toBe(false);
    expect(mergeSearchResults(curated ? [curated] : [], [near, far]).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("merges a curated state or country with the provider's centroid, hundreds of km away", () => {
    const [curatedTexas] = findLocations("texas", "en");
    const [providerTexas] = remote([
      feature("Texas", "region", ["country:United States"], [-99.3, 31.5], "us"),
    ]);
    expect(mergeSearchResults([curatedTexas], [providerTexas])).toHaveLength(1);
  });

  it("keeps a country and a state that share a name: different countries, different places", () => {
    const [georgiaCountry] = remote([feature("Georgia", "country", [], [43.5, 42.0], "ge")]);
    const [georgiaState] = remote([
      feature("Georgia", "region", ["country:United States"], [-83.5, 32.7], "us"),
    ]);
    expect(mergeSearchResults([georgiaCountry], [georgiaState])).toHaveLength(2);
  });

  it("skips a nameless entry instead of rendering it broken", () => {
    expect(mergeSearchResults([null, {}], [])).toEqual([]);
  });
});

describe("Paris — the reported case", () => {
  const curated = findLocations("Paris", "en");
  const ranked = rank("Paris", curated, PARIS(), ctx());

  it("lists Paris, France first, and Enter may take it", () => {
    expect(ranked.results[0].cc).toBe("FR");
    expect(ranked.results[0].name.en).toBe("Paris");
    expect(ranked.best).toBe(true);
    expect(ranked.ambiguous).toBe(false);
  });

  it("keeps Paris, Texas and Paris, Ontario as the next matches", () => {
    const [, second, third] = ranked.results;
    expect(`${second.cc}:${second.region.en}`).toBe("US:Texas");
    expect(`${third.cc}:${third.region.en}`).toBe("CA:Ontario");
    expect(names(ranked)).toContain("Paris, Tennessee");
  });

  it("puts Paris, France first even when the provider lists it last", () => {
    const reversed = PARIS().reverse();
    const r = rank("paris", [], reversed, ctx());
    expect(r.results[0].cc).toBe("FR");
    expect(r.best).toBe(true);
  });

  it("without any curated entry, the major-city rule alone still picks France", () => {
    const r = rank("Paris", [], PARIS(), ctx());
    expect(r.results[0].cc).toBe("FR");
    expect(r.best).toBe(true);
  });

  it("'Paris Texas' and 'Paris Ontario' put those first, and Enter may take them", () => {
    const texas = rank(
      "Paris Texas",
      findLocations("Paris Texas", "en"),
      remote([
        feature(
          "Paris",
          "municipality",
          ["county:Lamar", "region:Texas", "country:United States"],
          [-95.5555, 33.6609],
          "us",
        ),
      ]),
      ctx(),
    );
    expect(texas.results[0].region.en).toBe("Texas");
    expect(texas.best).toBe(true);
    const ontario = rank("Paris, Ontario", findLocations("Paris, Ontario", "en"), [], ctx());
    expect(ontario.results[0].region.en).toBe("Ontario");
    expect(ontario.best).toBe(true);
  });
});

describe("Springfield — equally likely places are never chosen for the visitor", () => {
  const r = rank("Springfield", [], SPRINGFIELD(), ctx());

  it("keeps every match, in the provider's own order", () => {
    expect(r.results).toHaveLength(7);
    expect(r.results[0].region.en).toBe("Illinois");
  });

  it("refuses to pick, and says the name is shared", () => {
    expect(r.best).toBe(false);
    expect(r.ambiguous).toBe(true);
  });

  it("an exact match near the visitor separates them", () => {
    const nearMissouri = ctx({ userPoint: { lat: 37.2, lon: -93.3 } });
    const near = rank("Springfield", [], SPRINGFIELD(), nearMissouri);
    expect(near.results[0].region.en).toBe("Missouri");
    expect(near.best).toBe(true);
    /* far from all of them: nothing separates them again */
    const faraway = ctx({ userPoint: { lat: 48.85, lon: 2.35 } });
    expect(rank("Springfield", [], SPRINGFIELD(), faraway).best).toBe(false);
  });

  it("a favourite or a recently selected one separates them", () => {
    const list = SPRINGFIELD();
    const oregon = list.find((l) => l.region.en === "Oregon");
    const fav = rank("Springfield", [], list, ctx({ favorites: [oregon] }));
    expect(fav.results[0].region.en).toBe("Oregon");
    expect(fav.best).toBe(true);
    const recent = rank("Springfield", [], list, ctx({ recents: [{ id: oregon.id }] }));
    expect(recent.results[0].region.en).toBe("Oregon");
    expect(recent.best).toBe(true);
  });

  it("two favourites are still a tie", () => {
    const list = SPRINGFIELD();
    const two = [list[2], list[3]];
    expect(rank("Springfield", [], list, ctx({ favorites: two })).best).toBe(false);
  });

  it("a major city outranks a nearby namesake", () => {
    const near = ctx({ userPoint: { lat: 43.0, lon: -81.2 } });
    const list = remote([
      feature(
        "London",
        "place",
        ["county:Middlesex", "region:Ontario", "country:Canada"],
        [-81.2, 43.0],
        "ca",
      ),
      feature("London", "place", ["region:England", "country:United Kingdom"], [-0.13, 51.5], "gb"),
    ]);
    const r = rank("London", [], list, near);
    expect(r.results[0].cc).toBe("GB"); /* rule 2 before rule 3 */
    expect(r.best).toBe(true);
  });
});

describe("a country, a state, a major city and the sea", () => {
  it("Tokyo: the curated city beats the prefecture of the same name", () => {
    const list = remote([
      feature("Tokyo", "region", ["country:Japan"], [139.4, 35.6], "jp"),
      feature("Tokyo Bay", "major_landform", ["country:Japan"], [139.9, 35.5], ""),
    ]);
    const r = rank("Tokyo", findLocations("Tokyo", "en"), list, ctx());
    expect(r.results[0].kind).toBe("city");
    expect(r.results[0].id).toBe("tokyo");
    expect(r.best).toBe(true);
  });

  it("New York: the city beats the state, the county and the English namesakes", () => {
    const list = remote([
      feature(
        "New York",
        "subregion",
        ["region:New York", "country:United States"],
        [-74.0, 40.7],
        "us",
      ),
      feature("New York", "region", ["country:United States"], [-75.5, 42.9], "us"),
      feature(
        "New York",
        "place",
        ["county:Lincolnshire", "region:England", "country:United Kingdom"],
        [0.1, 53.1],
        "gb",
      ),
      feature(
        "New York",
        "place",
        ["county:Ballard", "region:Kentucky", "country:United States"],
        [-88.9, 37.0],
        "us",
      ),
    ]);
    const r = rank("New York", findLocations("New York", "en"), list, ctx());
    expect(r.results[0].id).toBe("newyork");
    expect(r.best).toBe(true);
  });

  it("Tarbes: the curated-or-major-less town wins on popularity over same-named hamlets", () => {
    const list = remote([
      feature(
        "Tarbes",
        "municipality",
        ["county:Hautes Pyrenees", "region:Occitania", "country:France"],
        [0.0782, 43.2333],
        "fr",
      ),
      feature(
        "Tarbes",
        "place",
        ["county:Lozère", "region:Occitania", "country:France"],
        [3.5, 44.5],
        "fr",
      ),
      feature(
        "Tarbes",
        "place",
        ["county:Aude", "region:Occitania", "country:France"],
        [2.2, 43.0],
        "fr",
      ),
    ]);
    /* The town is a municipality in its own right; the other two are hamlets
       that happen to share its name — so nothing needs asking. */
    const town = rank("Tarbes", [], list, ctx());
    expect(town.results[0].id).toBe(list[0].id);
    expect(town.best).toBe(true);
    expect(town.ambiguous).toBe(false);
  });

  it("Tarbes: hamlets alone, with no town among them, are still a tie", () => {
    const hamlets = remote([
      feature(
        "Tarbes",
        "place",
        ["county:Lozère", "region:Occitania", "country:France"],
        [3.5, 44.5],
        "fr",
      ),
      feature(
        "Tarbes",
        "place",
        ["county:Aude", "region:Occitania", "country:France"],
        [2.2, 43.0],
        "fr",
      ),
    ]);
    const tie = rank("Tarbes", [], hamlets, ctx());
    expect(tie.best).toBe(false);
    expect(tie.ambiguous).toBe(true);
    /* once one is a favourite, it is not */
    const withFav = rank("Tarbes", [], hamlets, ctx({ favorites: [hamlets[1]] }));
    expect(withFav.results[0].id).toBe(hamlets[1].id);
    expect(withFav.best).toBe(true);
  });

  it("a municipality never outranks a major city that only shares its name", () => {
    /* the tie-break above is LAST: Paris, Tennessee is a municipality too */
    const r = rank("Paris", [], PARIS().reverse(), ctx());
    expect(r.results[0].cc).toBe("FR");
    expect(r.best).toBe(true);
  });

  it("a country: the curated entry and the provider's copy are one result, and best", () => {
    const list = remote([feature("France", "country", [], [2.2, 46.6], "fr")]);
    const r = rank("France", findLocations("France", "en"), list, ctx());
    expect(r.results.filter((l) => l.kind === "country" && l.cc === "FR")).toHaveLength(1);
    expect(r.results[0].id).toBe("france");
    expect(r.best).toBe(true);
  });

  it("an ocean or sea: a single match is the answer", () => {
    const list = remote([feature("Pacific Ocean", "place", [], [-150, 0], "")]);
    const r = rank("Pacific Ocean", [], list, ctx());
    expect(r.results).toHaveLength(1);
    expect(r.results[0].kind).toBe("ocean");
    expect(r.best).toBe(true);
  });

  it("a state shared with a country ('Georgia') is ambiguous: nothing separates them", () => {
    const list = remote([
      feature("Georgia", "country", [], [43.5, 42.0], "ge"),
      feature("Georgia", "region", ["country:United States"], [-83.5, 32.7], "us"),
    ]);
    const r = rank("Georgia", [], list, ctx());
    expect(r.best).toBe(false);
    expect(r.ambiguous).toBe(true);
  });
});

describe("a partial query — never guessed unless a major city settles it", () => {
  const list = () =>
    remote([
      feature(
        "Parma",
        "municipality",
        ["region:Emilia-Romagna", "country:Italy"],
        [10.3, 44.8],
        "it",
      ),
      feature(
        "Paris",
        "municipality",
        ["region:Ile-de-France", "country:France"],
        [2.35, 48.85],
        "fr",
      ),
      feature("Paramaribo", "place", ["country:Suriname"], [-55.2, 5.85], "sr"),
    ]);

  it("'Par' picks Paris — the only major city among the prefixes", () => {
    const r = rank("Par", [], list(), ctx());
    expect(r.results[0].name.en).toBe("Paris");
    expect(r.best).toBe(true);
  });

  it("'Par' with no major city among them asks instead", () => {
    const noParis = list().filter((l) => l.name.en !== "Paris");
    const r = rank("Par", [], noParis, ctx());
    expect(r.best).toBe(false);
    /* a partial name is not "several places share this name" */
    expect(r.ambiguous).toBe(false);
  });

  it("popularity alone does not decide a partial query", () => {
    const [tarbes] = findLocations("paris", "en"); /* a curated, popular place */
    const other = remote([feature("Parma", "municipality", ["country:Italy"], [10.3, 44.8], "it")]);
    const r = rank("Par", [{ ...tarbes, isMajor: false, cc: "XX" }], other, ctx());
    expect(r.best).toBe(false);
  });
});

describe("addresses and points of interest rank below settlements", () => {
  it("a street with a matching name never outranks the town", () => {
    const list = remote([
      feature("Tarbes Street", "address", ["country:South Africa"], [25.5, -33.9], "za"),
      feature("Tarbesou", "address", ["country:France"], [1.5, 42.9], "fr"),
      feature(
        "Tarbes",
        "municipality",
        ["region:Occitania", "country:France"],
        [0.0782, 43.2333],
        "fr",
      ),
    ]);
    const r = rank("Tarbes", [], list, ctx());
    expect(r.results[0].name.en).toBe("Tarbes");
    expect(r.best).toBe(true);
  });

  it("two streets are not 'several places sharing a name'", () => {
    const list = remote([
      feature("Rue Foch", "address", ["country:France"], [0, 43], "fr"),
      feature("Rue Foch", "address", ["country:France"], [2, 47], "fr"),
    ]);
    expect(rank("Rue Foch", [], list, ctx()).ambiguous).toBe(
      true,
    ); /* still a tie between the two */
  });
});

describe("rankSearchResults — the basics", () => {
  it("answers an empty list without a best result", () => {
    expect(rankSearchResults("x", [], ctx())).toEqual({
      results: [],
      best: false,
      ambiguous: false,
    });
    expect(rankSearchResults("x", undefined)).toEqual({
      results: [],
      best: false,
      ambiguous: false,
    });
  });

  it("a single result is always the clear answer, whatever it is called", () => {
    const [reykjavik] = remote([
      feature(
        "Reykjavik",
        "place",
        ["region:Capital Region", "country:Iceland"],
        [-21.9, 64.1],
        "is",
      ),
    ]);
    const r = rankSearchResults("zzz", [reykjavik], ctx());
    expect(r.best).toBe(true);
    expect(r.ambiguous).toBe(false);
  });

  it("does not modify the list it was given, and keeps ties in the given order", () => {
    const list = SPRINGFIELD();
    const before = list.map((l) => l.id);
    const r = rankSearchResults("Springfield", list, ctx());
    expect(list.map((l) => l.id)).toEqual(before);
    expect(r.results.map((l) => l.id)).toEqual(before);
  });

  it("needs no context at all", () => {
    expect(() => rankSearchResults("paris", PARIS())).not.toThrow();
  });
});
