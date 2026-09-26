/* Typing a country's name means the country.
 *
 * "Japan" must offer Japan first, let Enter take it, and still list Japan,
 * Missouri underneath — never the other way round. The provider answers below
 * put the namesake FIRST on purpose (the worst case for the ranking), and are
 * served per query by a route registered after installMocks(), the same way
 * search-ranking.spec.js does it.
 *
 * Every pick is then followed through the whole app: the hero name, the flag,
 * the photo request, the photo's provenance and the coordinates written to the
 * URL must all describe the SAME country. */
import { test, expect, installMocks, json, reverseCoordsFrom, photoProxyPayload } from "./mocks.js";

/* One MapTiler feature. `context` entries are "type:Name" or "type:Name|ISO". */
function feature(id, text, type, context, center, cc, extra = {}) {
  return {
    id,
    text,
    place_name: [text, ...context.map((c) => c.split("|")[0].split(":")[1])].join(", "),
    place_type: [type],
    center,
    properties: cc ? { country_code: cc } : {},
    context: context.map((entry, i) => {
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

const US = "country:United States";

/* `curated`: the name is in data/locations.js, so it appears before any lookup. */
const CASES = [
  {
    en: "Canada",
    bounds: [-141, 41.7, -52, 83.2] /* [west, south, east, north] */,
    fr: "Canada",
    cc: "ca",
    curated: true,
    country: feature("country.ca", "Canada", "country", [], [-98.3, 61.4], "ca"),
    namesake: feature(
      "place.canada-es",
      "Cañada",
      "place",
      ["county:Alicante", "region:Valencian Community", "country:Spain"],
      [-0.72, 38.63],
      "es",
    ),
    namesakeRegion: "Valencian Community",
    namesakeCc: "es",
  },
  {
    en: "Japan",
    bounds: [122, 24, 146, 46] /* [west, south, east, north] */,
    fr: "Japon",
    cc: "jp",
    curated: true,
    country: feature("country.jp", "Japan", "country", [], [138.25, 36.2], "jp", {
      text_en: "Japan",
      text_fr: "Japon",
    }),
    namesake: feature(
      "place.japan-mo",
      "Japan",
      "place",
      ["county:Wright", "region:Missouri|US-MO", US],
      [-92.5, 37.2],
      "us",
    ),
    namesakeRegion: "Missouri",
    namesakeCc: "us",
  },
  {
    en: "Brazil",
    bounds: [-74, -34, -34, 5.3] /* [west, south, east, north] */,
    fr: "Brésil",
    cc: "br",
    curated: false,
    country: feature("country.br", "Brazil", "country", [], [-53.1, -10.8], "br", {
      text_en: "Brazil",
      text_fr: "Brésil",
    }),
    namesake: feature(
      "place.brazil-in",
      "Brazil",
      "municipality",
      ["county:Clay", "region:Indiana|US-IN", US],
      [-87.12, 39.52],
      "us",
    ),
    namesakeRegion: "Indiana",
    namesakeCc: "us",
  },
  {
    en: "Germany",
    bounds: [5.8, 47.2, 15.1, 55.1] /* [west, south, east, north] */,
    fr: "Allemagne",
    cc: "de",
    curated: true,
    country: feature("country.de", "Germany", "country", [], [10.4, 51.1], "de", {
      text_en: "Germany",
      text_fr: "Allemagne",
    }),
    namesake: feature(
      "place.germany-pa",
      "Germany",
      "place",
      ["county:Adams", "region:Pennsylvania|US-PA", US],
      [-77.05, 39.75],
      "us",
    ),
    namesakeRegion: "Pennsylvania",
    namesakeCc: "us",
  },
  {
    en: "Mexico",
    bounds: [-118.5, 14.5, -86.7, 32.8] /* [west, south, east, north] */,
    fr: "Mexique",
    cc: "mx",
    curated: false,
    country: feature("country.mx", "Mexico", "country", [], [-102.5, 23.6], "mx", {
      text_en: "Mexico",
      text_fr: "Mexique",
    }),
    namesake: feature(
      "place.mexico-ph",
      "Mexico",
      "municipality",
      ["county:Pampanga", "region:Central Luzon", "country:Philippines"],
      [120.72, 15.07],
      "ph",
    ),
    namesakeRegion: "Central Luzon",
    namesakeCc: "ph",
  },
  {
    en: "Vietnam",
    bounds: [102, 8.5, 109.5, 23.4] /* [west, south, east, north] */,
    fr: "Viêt Nam",
    cc: "vn",
    curated: true,
    country: feature("country.vn", "Vietnam", "country", [], [106.3, 16.6], "vn", {
      text_en: "Vietnam",
      text_fr: "Viêt Nam",
    }),
    namesake: feature(
      "place.vietnam-ug",
      "Vietnam",
      "locality",
      ["county:Wakiso", "region:Central Region", "country:Uganda"],
      [32.55, 0.36],
      "ug",
    ),
    namesakeRegion: "Central Region",
    namesakeCc: "ug",
  },
  {
    en: "United Kingdom",
    bounds: [-8.7, 49.8, 1.8, 60.9] /* [west, south, east, north] */,
    fr: "Royaume-Uni",
    cc: "gb",
    curated: true,
    country: feature("country.gb", "United Kingdom", "country", [], [-2.2, 54.6], "gb", {
      text_en: "United Kingdom",
      text_fr: "Royaume-Uni",
    }),
    namesake: feature(
      "place.uk-dubai",
      "United Kingdom",
      "locality",
      ["region:Dubai", "country:United Arab Emirates"],
      [55.31, 25.07],
      "ae",
    ),
    namesakeRegion: "Dubai",
    namesakeCc: "ae",
  },
  {
    en: "South Africa",
    bounds: [16.4, -35, 32.9, -22] /* [west, south, east, north] */,
    fr: "Afrique du Sud",
    cc: "za",
    curated: false,
    country: feature("country.za", "South Africa", "country", [], [25.1, -28.9], "za", {
      text_en: "South Africa",
      text_fr: "Afrique du Sud",
    }),
    namesake: feature(
      "place.sa-ky",
      "South Africa",
      "place",
      ["county:Hardin", "region:Kentucky|US-KY", US],
      [-86.0, 37.7],
      "us",
    ),
    namesakeRegion: "Kentucky",
    namesakeCc: "us",
  },
];

/* The namesake is listed first, as the provider might. */
const tableFor = (c) => ({ [c.en.toLowerCase()]: [c.namesake, c.country] });

const PARIS_TABLE = {
  paris: [
    feature(
      "place.p-tx",
      "Paris",
      "municipality",
      ["county:Lamar", "region:Texas|US-TX", US],
      [-95.5555, 33.6609],
      "us",
    ),
    feature(
      "place.p-fr",
      "Paris",
      "municipality",
      ["county:Paris", "region:Ile-de-France", "country:France"],
      [2.3522, 48.8566],
      "fr",
    ),
  ],
  dallas: [
    feature(
      "place.d-tx",
      "Dallas",
      "municipality",
      ["county:Dallas", "region:Texas|US-TX", US],
      [-96.797, 32.7767],
      "us",
    ),
    feature(
      "place.d-or",
      "Dallas",
      "place",
      ["county:Polk", "region:Oregon|US-OR", US],
      [-123.3, 44.92],
      "us",
    ),
  ],
};

/* Answers each forward search from `table` by what was typed (any language the
   table lists). `delayMs` holds every answer back. */
async function serveGeocoding(page, table, { delayMs = 0 } = {}) {
  await page.route("**://api.maptiler.com/geocoding/**", async (route, request) => {
    if (reverseCoordsFrom(request.url())) return route.fallback();
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const typed = decodeURIComponent(new URL(request.url()).pathname.split("/").pop())
      .replace(/\.json$/, "")
      .toLowerCase();
    const key = Object.keys(table).find((name) => typed.startsWith(name));
    return route.fulfill(json({ features: key ? table[key] : [] }));
  });
}

/* Every photo query the app makes, so a test can say what the picture was for. */
function recordPhotoQueries(queries) {
  return (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query) queries.push(query);
    return route.fulfill(json(photoProxyPayload(query)));
  };
}

const rows = (page) => page.locator("#searchResults [role=option]");
const active = (page) => page.locator('#searchResults [role=option][aria-selected="true"]');

async function start(page, table, { delayMs = 0, photoQueries } = {}) {
  await installMocks(page, photoQueries ? { photoProxy: recordPhotoQueries(photoQueries) } : {});
  await serveGeocoding(page, table, { delayMs });
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

async function search(page, text) {
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").click();
  await page.locator("#searchInput").fill(text);
}

/* `sel=lat,lon` from the address bar, or null. */
function selFromUrl(page) {
  const query = page.url().split("?")[1] || "";
  const sel = new URLSearchParams(query.split("#")[0]).get("sel");
  if (!sel) return null;
  const [lat, lon] = sel.split(",").map(Number);
  return { lat, lon };
}

const near = (point, [lon, lat], degrees = 1.5) =>
  Boolean(point) && Math.abs(point.lat - lat) < degrees && Math.abs(point.lon - lon) < degrees;

/* A point inside a country's bounding box: a curated country sits on its
   capital, the provider's on its centre, and both are "the country". */
const inside = (point, [west, south, east, north]) =>
  Boolean(point) &&
  point.lon >= west &&
  point.lon <= east &&
  point.lat >= south &&
  point.lat <= north;

const heroFlags = (page) => page.locator("#heroInner img[src*='/countries/']");

test.describe("an exact country name ranks the country first", () => {
  for (const c of CASES) {
    test(`${c.en}: the country first and highlighted, ${c.namesakeRegion} below it`, async ({
      page,
    }) => {
      await start(page, tableFor(c));
      await search(page, c.en);
      await expect(rows(page).nth(1)).toBeVisible(); /* the online answer has arrived */

      const first = rows(page).first();
      await expect(first.locator(".si-kind")).toHaveText("Pays");
      await expect(first).toContainText(c.fr);
      await expect(first).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#searchInput")).toHaveAttribute("aria-activedescendant", "sr-0");
      await expect(active(page)).toHaveCount(1);

      /* the namesake stays visible, one row down, with its own region and country */
      const second = rows(page).nth(1);
      await expect(second).toContainText(c.namesake.text);
      await expect(second.locator(".si-sub")).toContainText(c.namesakeRegion);
      await expect(second.locator(".si-kind")).not.toHaveText("Pays");
      await expect(second.locator(".location-flags")).toHaveCount(1);

      /* nothing is "ambiguous": the country is a clear answer */
      await expect(page.locator("#searchStatus")).not.toContainText("Plusieurs lieux");
    });

    test(`${c.en}: typing its French name (${c.fr}) finds the same country first`, async ({
      page,
    }) => {
      await start(page, { ...tableFor(c), [c.fr.toLowerCase()]: [c.namesake, c.country] });
      await search(page, c.fr);
      /* the online lookup has answered (the provider lists only what matches
         the French spelling, so the row count is not the signal here) */
      await expect(page.locator("#searchStatus .map-panel-spinner")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(rows(page).first().locator(".si-kind")).toHaveText("Pays");
      await expect(rows(page).first()).toContainText(c.fr);
      await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    });

    test(`${c.en}: Enter selects the country — its name, flag, photo and URL all agree`, async ({
      page,
    }) => {
      const photoQueries = [];
      await start(page, tableFor(c), { photoQueries });
      await search(page, c.en);
      await expect(rows(page).nth(1)).toBeVisible();
      await page.keyboard.press("Enter");

      /* the hero is the country, not the namesake */
      await expect(page.locator("#heroCityName")).toHaveText(c.fr);
      await expect(page.locator("#searchPanel")).toBeHidden();
      await expect(page.locator("#searchInput")).toHaveValue(new RegExp(`${c.en}|${c.fr}`));
      await expect(page.locator("#heroInner")).not.toContainText(c.namesakeRegion);

      /* its own flag — and no other country's */
      await expect(heroFlags(page).first()).toHaveAttribute("src", new RegExp(`/${c.cc}\\.svg`));
      await expect(page.locator(`#heroInner img[src*='/countries/${c.namesakeCc}.']`)).toHaveCount(
        c.namesakeCc === c.cc ? 1 : 0,
      );

      /* the URL carries the country's own coordinates */
      await expect.poll(() => inside(selFromUrl(page), c.bounds)).toBe(true);

      /* the photo was asked for the country by name — never the namesake's region */
      await expect.poll(() => photoQueries.length).toBeGreaterThan(0);
      expect(photoQueries.join(" | ")).not.toContain(c.namesakeRegion);
      expect(photoQueries.some((q) => q.includes(c.en) || q.includes(c.fr))).toBe(true);

      /* and it never claims to be a photo of the exact place */
      const credit = page.locator("#heroInner .loc-credit");
      if (await credit.count()) {
        await expect(credit).not.toHaveAttribute("data-provenance", "exact");
      }
    });

    test(`${c.en}, ${c.namesakeRegion}: choosing it deliberately follows the namesake everywhere`, async ({
      page,
    }) => {
      const photoQueries = [];
      await start(page, tableFor(c), { photoQueries });
      await search(page, c.en);
      await expect(rows(page).nth(1)).toBeVisible();
      const namesakeRow = rows(page).filter({ hasText: c.namesakeRegion }).first();
      await expect(namesakeRow).toBeVisible();
      await namesakeRow.locator(".search-item").click();

      await expect(page.locator("#heroInner")).toContainText(c.namesakeRegion);
      await expect(page.locator("#heroInner")).not.toContainText(c.fr === c.en ? "\u0000" : c.fr);
      await expect(
        page.locator(`#heroInner img[src*='/countries/${c.namesakeCc}.']`).first(),
      ).toBeAttached();
      await expect.poll(() => near(selFromUrl(page), c.namesake.center, 0.05)).toBe(true);
      await expect.poll(() => photoQueries.length).toBeGreaterThan(0);
      expect(photoQueries.join(" | ")).toContain(c.namesakeRegion);
    });
  }
});

test.describe("Enter never picks a namesake while a country exists", () => {
  for (const c of CASES.filter((item) => item.curated)) {
    test(`${c.en}: Enter straight after typing, before the online lookup, picks the country`, async ({
      page,
    }) => {
      await start(page, tableFor(c), { delayMs: 2500 });
      await search(page, c.en);
      /* the built-in country is listed at once, and highlighted */
      await expect(rows(page).first().locator(".si-kind")).toHaveText("Pays");
      await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(page.locator("#heroCityName")).toHaveText(c.fr);
    });
  }

  for (const c of CASES.filter((item) => !item.curated)) {
    test(`${c.en}: Enter before the online lookup answers selects nothing, then the country`, async ({
      page,
    }) => {
      await start(page, tableFor(c), { delayMs: 2000 });
      const before = await page.locator("#heroCityName").innerText();
      await search(page, c.en);
      await page.keyboard.press("Enter"); /* nothing to pick yet */
      await expect(page.locator("#heroCityName")).toHaveText(before);
      await expect(rows(page).nth(1)).toBeVisible({ timeout: 10_000 });
      await expect(rows(page).first().locator(".si-kind")).toHaveText("Pays");
      await page.keyboard.press("Enter");
      await expect(page.locator("#heroCityName")).toHaveText(c.fr);
    });
  }

  test("a click on the namesake's row still selects the namesake", async ({ page }) => {
    const c = CASES[1]; /* Japan, Missouri */
    await start(page, tableFor(c));
    await search(page, c.en);
    await expect(rows(page).nth(1)).toBeVisible();
    await rows(page).nth(1).locator(".search-item").click();
    await expect(page.locator("#heroCityName")).toHaveText("Japan");
    await expect(page.locator(".hero-region")).toContainText("Missouri");
  });
});

test.describe("ordinary city search behaves as before", () => {
  test("Paris: France first and picked by Enter, Texas still listed", async ({ page }) => {
    await start(page, PARIS_TABLE);
    await search(page, "Paris");
    await expect(rows(page).nth(1)).toBeVisible();
    await expect(rows(page).first()).toContainText("France");
    await expect(rows(page).first().locator(".si-kind")).not.toHaveText("Pays");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(rows(page).nth(1)).toContainText("Texas");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Paris");
    await expect(page.locator(".hero-region")).toContainText("France");
  });

  test("Paris Texas: Texas first, and Enter takes it", async ({ page }) => {
    await start(page, PARIS_TABLE);
    await search(page, "Paris Texas");
    await expect(rows(page).first()).toContainText("Texas");
    await page.keyboard.press("Enter");
    await expect(page.locator(".hero-region")).toContainText("Texas");
    await expect.poll(() => near(selFromUrl(page), [-95.5555, 33.6609], 0.05)).toBe(true);
  });

  test("Dallas: the city, with no country in the list", async ({ page }) => {
    await start(page, PARIS_TABLE);
    await search(page, "Dallas");
    await expect(rows(page).nth(1)).toBeVisible();
    await expect(rows(page).first()).toContainText("Texas");
    await expect(page.locator("#searchResults .si-kind", { hasText: "Pays" })).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Dallas");
  });

  test("Tokyo (built in): still the city, not Japan", async ({ page }) => {
    await start(page, {});
    await search(page, "Tokyo");
    await expect(rows(page).first().locator(".si-kind")).not.toHaveText("Pays");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Tokyo");
  });
});

test.describe("the result row says what it is and where", () => {
  test("a country row shows the type and its flag; a namesake row shows its region and country", async ({
    page,
  }) => {
    const c = CASES[3]; /* Germany, Pennsylvania */
    await start(page, tableFor(c));
    await search(page, c.en);
    await expect(rows(page).nth(1)).toBeVisible();

    const country = rows(page).first();
    await expect(country.locator(".si-kind")).toHaveText("Pays");
    await expect(country.locator(".si-visual")).toBeVisible();

    const namesake = rows(page).nth(1);
    await expect(namesake.locator(".si-kind")).toHaveText(/Ville|Lieu/);
    await expect(namesake.locator(".si-sub")).toContainText("Pennsylvania");
    await expect(namesake.locator(".si-sub")).toContainText(/États-Unis|United States/);
    await expect(namesake.locator(".location-flags img")).not.toHaveCount(0);
  });

  test("the search list is announced, and an English UI reads 'Country'", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ws_lang", "en"));
    const c = CASES[1];
    await start(page, tableFor(c));
    await search(page, c.en);
    await expect(rows(page).nth(1)).toBeVisible();
    await expect(rows(page).first().locator(".si-kind")).toHaveText("Country");
    await expect(rows(page).first()).toContainText("Japan");
    await expect(page.locator("#searchAnnounce")).not.toBeEmpty();
  });
});
