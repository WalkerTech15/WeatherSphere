/* Search as a visitor uses it: type a name, see the best match first, let
 * Enter take it when it is clear, and be asked when it is not.
 *
 * The provider answers below are the real MapTiler features (types, context
 * chain and order) captured for "Paris" and "Springfield". They are served
 * per query by a route registered AFTER installMocks(), which is how a test
 * overrides the default one-city geocoder. Reverse geocoding (a map click)
 * is passed through to the default handler untouched. */
import { test, expect, installMocks, json, reverseCoordsFrom } from "./mocks.js";

/* One MapTiler feature; `context` entries are "type:Name" or "type:Name|ISO". */
function feature(id, text, type, context, center, cc) {
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
  };
}

const US = "country:United States";
const PARIS = [
  feature(
    "place.p-fr",
    "Paris",
    "municipality",
    ["county:Paris", "region:Ile-de-France", "country:France"],
    [2.3522, 48.8566],
    "fr",
  ),
  feature(
    "place.p-tx",
    "Paris",
    "municipality",
    ["county:Lamar", "region:Texas|US-TX", US],
    [-95.5555, 33.6609],
    "us",
  ),
  feature(
    "place.p-tn",
    "Paris",
    "municipality",
    ["county:Henry", "region:Tennessee|US-TN", US],
    [-88.3273, 36.302],
    "us",
  ),
  feature(
    "place.p-on",
    "Paris",
    "place",
    ["county:Brant", "region:Ontario", "country:Canada"],
    [-80.3833, 43.2],
    "ca",
  ),
  feature(
    "place.p-ky",
    "Paris",
    "municipality",
    ["county:Bourbon", "region:Kentucky|US-KY", US],
    [-84.253, 38.2098],
    "us",
  ),
  feature(
    "place.p-il",
    "Paris",
    "municipality",
    ["county:Edgar", "region:Illinois|US-IL", US],
    [-87.6961, 39.6111],
    "us",
  ),
  feature(
    "place.p-me",
    "Paris",
    "municipality",
    ["county:Oxford", "region:Maine|US-ME", US],
    [-70.5001, 44.2612],
    "us",
  ),
];
const SPRINGFIELD = [
  feature(
    "place.s-il",
    "Springfield",
    "municipality",
    ["county:Sangamon", "region:Illinois|US-IL", US],
    [-89.6437, 39.7817],
    "us",
  ),
  feature(
    "place.s-ma",
    "Springfield",
    "municipality",
    ["county:Hampden", "region:Massachusetts|US-MA", US],
    [-72.5898, 42.1015],
    "us",
  ),
  feature(
    "place.s-mo",
    "Springfield",
    "municipality",
    ["county:Greene", "region:Missouri|US-MO", US],
    [-93.2923, 37.209],
    "us",
  ),
  feature(
    "place.s-oh",
    "Springfield",
    "municipality",
    ["county:Clark", "region:Ohio|US-OH", US],
    [-83.8088, 39.9242],
    "us",
  ),
  feature(
    "place.s-or",
    "Springfield",
    "municipality",
    ["county:Lane", "region:Oregon|US-OR", US],
    [-123.022, 44.0462],
    "us",
  ),
  feature(
    "place.s-nz",
    "Springfield",
    "place",
    ["county:Selwyn District", "region:Canterbury", "country:New Zealand"],
    [171.9333, -43.3333],
    "nz",
  ),
  feature(
    "place.s-va",
    "Springfield",
    "place",
    ["county:Fairfax", "region:Virginia|US-VA", US],
    [-77.1872, 38.7893],
    "us",
  ),
];
const OTHERS = {
  tokyo: [
    feature("place.t-region", "Tokyo", "region", ["country:Japan"], [139.4, 35.6], "jp"),
    feature("place.t-bay", "Tokyo Bay", "major_landform", ["country:Japan"], [139.9, 35.5], "jp"),
  ],
  "new york": [
    feature(
      "place.ny-sub",
      "New York",
      "subregion",
      ["region:New York|US-NY", US],
      [-74.0, 40.7],
      "us",
    ),
    feature("place.ny-state", "New York", "region", [US], [-75.5, 42.9], "us"),
    feature(
      "place.ny-uk",
      "New York",
      "place",
      ["county:Lincolnshire", "region:England", "country:United Kingdom"],
      [0.1, 53.1],
      "gb",
    ),
  ],
  tarbes: [
    feature(
      "place.tb-1",
      "Tarbes",
      "municipality",
      ["county:Hautes Pyrenees", "region:Occitania", "country:France"],
      [0.0782, 43.2333],
      "fr",
    ),
    feature(
      "place.tb-2",
      "Tarbes",
      "place",
      ["county:Lozère", "region:Occitania", "country:France"],
      [3.5, 44.5],
      "fr",
    ),
  ],
  france: [feature("country.fr", "France", "country", [], [2.2, 46.6], "fr")],
  "pacific ocean": [
    {
      ...feature("place.pac", "Pacific Ocean", "place", [], [-150, 0], ""),
      place_name: "Pacific Ocean",
    },
  ],
};

const FEATURES = { paris: PARIS, springfield: SPRINGFIELD, ...OTHERS };

/* Answers each forward search from FEATURES by what was typed. `delayMs`
   holds every answer back, which is how the loading state is observed. */
async function serveGeocoding(page, { delayMs = 0, table = FEATURES } = {}) {
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

const rows = (page) => page.locator("#searchResults [role=option]");
const active = (page) => page.locator('#searchResults [role=option][aria-selected="true"]');
const status = (page) => page.locator("#searchStatus");

async function openSearch(page) {
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  /* below 520px the field sits behind the mobile search button */
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").click();
}

async function search(page, text) {
  await openSearch(page);
  await page.locator("#searchInput").fill(text);
}

async function start(page, opts = {}) {
  await installMocks(page);
  await serveGeocoding(page, opts);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

const initialCity = (page) => page.locator("#heroCityName").innerText();

test.describe("typing a common name — Paris", () => {
  test("lists Paris, France first, highlighted, with Texas and Ontario after it", async ({
    page,
  }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).nth(4)).toBeVisible(); /* the remote results have arrived */
    const first = rows(page).first();
    await expect(first).toContainText("Paris");
    await expect(first).toContainText("France");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#searchInput")).toHaveAttribute("aria-activedescendant", "sr-0");
    await expect(rows(page).nth(1)).toContainText("Texas");
    await expect(rows(page).nth(2)).toContainText("Ontario");
    await expect(active(page)).toHaveCount(1);
  });

  test("Enter selects Paris, France — no arrowing, no long name to click", async ({ page }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).nth(4)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Paris");
    await expect(page.locator(".hero-region")).toContainText("France");
    await expect(page.locator("#searchInput")).toHaveValue(/Paris.*France/);
    await expect(page.locator("#searchPanel")).toBeHidden();
  });

  test("Enter straight after typing, before the online lookup answers, still picks Paris", async ({
    page,
  }) => {
    await start(page, { delayMs: 2500 });
    await search(page, "Paris");
    await expect(rows(page).first()).toContainText("France"); /* the built-in matches, instantly */
    await page.keyboard.press("Enter");
    await expect(page.locator(".hero-region")).toContainText("France");
  });

  test("'Paris Texas' and 'Paris, Ontario' put those first, and Enter takes them", async ({
    page,
  }) => {
    await start(page);
    await search(page, "Paris Texas");
    await expect(rows(page).first()).toContainText("Texas");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator(".hero-region")).toContainText("Texas");

    await search(page, "Paris, Ontario");
    await expect(rows(page).first()).toContainText("Ontario");
    await page.keyboard.press("Enter");
    await expect(page.locator(".hero-region")).toContainText("Ontario");
  });

  test("shows a country or region label and a flag on every row", async ({ page }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).nth(4)).toBeVisible();
    for (const i of [0, 1, 2, 3, 4]) {
      const row = rows(page).nth(i);
      await expect(row.locator(".si-sub")).not.toBeEmpty();
      await expect(row.locator(".location-flags")).toHaveCount(1);
    }
    await expect(rows(page).first().locator(".si-sub")).toContainText("France");
    await expect(rows(page).nth(2).locator(".si-sub")).toContainText("Canada");
  });
});

test.describe("several equally likely places — Springfield", () => {
  test("is never chosen for the visitor: nothing highlighted, the list says why", async ({
    page,
  }) => {
    await start(page);
    const before = await initialCity(page);
    await search(page, "Springfield");
    await expect(rows(page).nth(4)).toBeVisible();
    await expect(active(page)).toHaveCount(0);
    await expect(status(page)).toContainText(
      "Plusieurs lieux correspondent — choisissez-en un dans la liste.",
    );
    await page.keyboard.press("Enter");
    /* Enter asks instead of guessing: same page, panel open, message still there */
    await expect(page.locator("#searchPanel")).toBeVisible();
    await expect(status(page)).toContainText("choisissez-en un");
    await expect(page.locator("#searchAnnounce")).toContainText("choisissez-en un");
    expect(await initialCity(page)).toBe(before);
  });

  test("the visitor chooses with the arrows and Enter", async ({ page }) => {
    await start(page);
    await search(page, "Springfield");
    await expect(rows(page).nth(4)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Springfield");
    await expect(page.locator(".hero-region")).toContainText("Massachusetts");
  });

  test("a favourite among them settles it, and Enter takes it", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "ws_favs",
        JSON.stringify([
          {
            id: "mt-place.s-or",
            kind: "city",
            cc: "US",
            flag: "📍",
            lat: 44.0462,
            lon: -123.022,
            name: { en: "Springfield", fr: "Springfield" },
            region: { en: "Oregon", fr: "Oregon" },
            country: { en: "United States", fr: "États-Unis" },
            landmark: null,
            aliases: [],
            grad: ["#3B82F6", "#1E40AF"],
            dynamic: true,
            regionCode: "US-OR",
          },
        ]),
      );
    });
    await start(page);
    await search(page, "Springfield");
    await expect(rows(page).nth(4)).toBeVisible();
    await expect(rows(page).first()).toContainText("Oregon");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(status(page)).not.toContainText("choisissez-en un");
    await page.keyboard.press("Enter");
    await expect(page.locator(".hero-region")).toContainText("Oregon");
  });
});

test.describe("keyboard and the 'More results' option", () => {
  test("shows five places, then 'Plus de résultats (2)' — reachable by arrow key", async ({
    page,
  }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page)).toHaveCount(6);
    const more = rows(page).nth(5);
    await expect(more).toContainText("Plus de résultats (2)");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
    await expect(more).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#searchInput")).toHaveAttribute("aria-activedescendant", "sr-5");
    await page.keyboard.press("Enter");
    /* everything is listed, the panel stays open, and the first new row is active */
    await expect(rows(page)).toHaveCount(7);
    await expect(rows(page).nth(5)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#searchPanel")).toBeVisible();
    await expect(page.locator(".search-more")).toHaveCount(0);
  });

  test("a tap on 'More results' expands the list and keeps the input focused", async ({ page }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page)).toHaveCount(6);
    await page.locator(".search-more").click();
    await expect(rows(page)).toHaveCount(7);
    await expect(page.locator("#searchInput")).toBeFocused();
    /* the hidden places are real, selectable places */
    await rows(page).nth(6).locator(".search-item").click();
    await expect(page.locator("#heroCityName")).toHaveText("Paris");
    await expect(page.locator(".hero-region")).toContainText("Maine");
  });

  test("a new query starts from its best few again", async ({ page }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page)).toHaveCount(6);
    await page.locator(".search-more").click();
    await expect(rows(page)).toHaveCount(7);
    await search(page, "Springfield");
    await expect(rows(page)).toHaveCount(6);
  });

  test("Arrow Up and Arrow Down move the highlight; Escape closes the list", async ({ page }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).nth(4)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(active(page)).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#searchPanel")).toBeHidden();
    await expect(page.locator("#searchCombo")).toHaveAttribute("aria-expanded", "false");
  });

  test("the highlighted row is visible without relying on colour", async ({ page }) => {
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).nth(4)).toBeVisible();
    const outline = await rows(page)
      .first()
      .locator(".search-item")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("speaks English after a language switch", async ({ page }) => {
    await start(page);
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await search(page, "Paris");
    await expect(rows(page)).toHaveCount(6);
    await expect(rows(page).nth(5)).toContainText("More results (2)");
    await search(page, "Springfield");
    await expect(status(page)).toContainText("Several places match — choose one from the list.");
  });
});

test.describe("loading, no result, and network error", () => {
  test("says it is searching while the online lookup is in flight", async ({ page }) => {
    await start(page, { delayMs: 1800 });
    await search(page, "Springfield");
    await expect(status(page)).toContainText("Recherche en cours…");
    await expect(rows(page).nth(4)).toBeVisible({ timeout: 10000 });
    await expect(status(page)).not.toContainText("Recherche en cours");
  });

  test("says so when nothing matches — and does not pick a place anyway", async ({ page }) => {
    await start(page, { table: {} });
    await page.route("**://geocoding-api.open-meteo.com/**", (route) =>
      route.fulfill(json({ results: [] })),
    );
    const before = await initialCity(page);
    await search(page, "Qqzzxx");
    await expect(page.locator(".search-empty")).toContainText("Aucun lieu ne correspond");
    await page.keyboard.press("Enter");
    expect(await initialCity(page)).toBe(before);
  });

  test("says the search is unavailable on a network error, and retries", async ({ page }) => {
    await installMocks(page);
    let failing = true;
    await page.route("**://geocoding-api.open-meteo.com/**", (route) => route.abort());
    await page.route("**://api.maptiler.com/geocoding/**", async (route, request) => {
      if (reverseCoordsFrom(request.url())) return route.fallback();
      if (failing) return route.fulfill({ status: 500, body: "{}" });
      return route.fulfill(json({ features: PARIS }));
    });
    await page.goto("/");
    await search(page, "Qqzzxx");
    await expect(status(page)).toContainText("La recherche est indisponible");
    await expect(page.locator(".search-retry")).toBeVisible();
    failing = false;
    await page.locator(".search-retry").click();
    await expect(page.locator(".search-empty, #searchResults [role=option]").first()).toBeVisible();
    await expect(status(page)).not.toContainText("indisponible");
  });
});

test.describe("representative places", () => {
  test("Tokyo — the major city first, Enter takes it", async ({ page }) => {
    await start(page);
    await search(page, "Tokyo");
    await expect(rows(page).first()).toContainText("Japon");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Tokyo");
  });

  test("New York — the city, not the state or the English village", async ({ page }) => {
    await start(page);
    await search(page, "New York");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(rows(page).first()).toContainText("New York");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("New York");
    await expect(page.locator(".hero-region")).toContainText("États-Unis");
  });

  test("Tarbes — the town, once, with its region", async ({ page }) => {
    await start(page);
    await search(page, "Tarbes");
    await expect(rows(page).first()).toContainText("Tarbes");
    await expect(rows(page).first()).toContainText("France");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Tarbes");
  });

  test("a country — France, with its flag", async ({ page }) => {
    await start(page);
    await search(page, "France");
    await expect(rows(page).first()).toContainText("France");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toContainText("France");
  });

  test("an ocean — Pacific Ocean, selectable, with no country attached", async ({ page }) => {
    await start(page);
    await search(page, "Pacific Ocean");
    await expect(rows(page).first()).toContainText("Pacific Ocean");
    await expect(rows(page).first().locator(".location-flags")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toContainText(/Pacific|Pacifique/);
  });
});

test.describe("recent searches are preserved", () => {
  test("a place chosen with Enter is offered again when the field is emptied", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ws_recents_on", "1"));
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).nth(4)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".hero-region")).toContainText("France");
    await search(page, "");
    await page.locator("#searchInput").click();
    await expect(page.locator("#searchResults .search-group-label").first()).toHaveText("Récents");
    await expect(page.locator("#searchResults [role=option]").first()).toContainText("Paris");
  });
});

test.describe("fits every layout", () => {
  const widths = [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const viewport of widths) {
    test(`${viewport.width}px: the list, its rows and 'More results' fit and can be used`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await start(page);
      await search(page, "Paris");
      await expect(rows(page)).toHaveCount(6);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const panel = await page.locator("#searchPanel").boundingBox();
      expect(panel.x).toBeGreaterThanOrEqual(-0.5);
      expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 0.5);

      /* every row is a comfortable tap target and nothing spills out sideways */
      for (let i = 0; i < 6; i++) {
        const row = rows(page).nth(i);
        await row.scrollIntoViewIfNeeded();
        const box = await row.boundingBox();
        expect(box.height, `row ${i}`).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width, `row ${i}`).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      }
      const clipped = await page
        .locator("#searchResults")
        .evaluate((list) =>
          [...list.querySelectorAll(".si-name, .si-sub, .search-more")]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.className),
        );
      expect(clipped).toEqual([]);

      await page.locator(".search-more").click();
      await expect(rows(page)).toHaveCount(7);
      await expect(page.locator("#searchPanel")).toBeVisible();
    });
  }

  test("the status line and ambiguity message stay readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await start(page);
    await search(page, "Springfield");
    await expect(status(page)).toContainText("choisissez-en un");
    const box = await status(page).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(320.5);
    const clipped = await status(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  });

  test("respects reduced motion: the list appears without an animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await start(page);
    await search(page, "Paris");
    await expect(rows(page).first()).toBeVisible();
    const seconds = await page
      .locator("#searchPanel")
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(seconds).toBeLessThan(0.001);
  });
});

test.describe("the console stays clean", () => {
  test("no page error or console error while searching, choosing and expanding", async ({
    page,
  }) => {
    const problems = [];
    page.on("pageerror", (e) => problems.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(m.text());
    });
    await start(page);
    await search(page, "Paris");
    await expect(rows(page)).toHaveCount(6);
    await page.locator(".search-more").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator("#heroCityName")).toHaveText("Paris");
    await search(page, "Springfield");
    await page.keyboard.press("Enter");
    expect(problems).toEqual([]);
  });
});
