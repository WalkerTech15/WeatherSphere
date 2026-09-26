/* One picture, one owner.
 *
 * Every location image has exactly one place it may be rendered as a photo: the
 * photo container (`.loc-photo`) that hydrateLocPhoto fills — the hero's
 * background layer, the map panel thumbnail, a Favorites card, an Explore
 * card. Everything else that "shows" a place — the City badge, a search row, a
 * card's emoji — is a compact glyph (an emoji or a flag), never an <img>.
 *
 * Lourdes is the case that used to break this rule: it is the one curated
 * place with its own reviewed photograph, and that photograph came out of the
 * badge, the container fallback AND the async hydration.
 */
import { test, expect, installMocks, json } from "./mocks.js";
import { EXPLORE_IDS } from "../src/js/data/locations.js";

/* Lourdes' reviewed Unsplash photo — see data/locations.js */
const LOURDES_IMG = "photo-1641070496002-8077aefba51c";
const LOURDES_LINK = "mnctB7nxJiQ";
const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const PEXELS_LINK = "https://www.pexels.com/photo/test-12345/";

/* A real <img> that is a picture, as opposed to a flag (the app has two flag
   classes: .flag from flagHtml() and .flag-img from the location chips) */
const PICTURE = "img:not(.flag):not(.flag-img)";

/* Opens the app with the curated Unsplash host answered, and returns what the
 * page did to it. The mocks abort every unknown external host, which is right
 * for the suite but would make Lourdes' photograph fail to load. */
async function open(page, { lang = "fr", unsplashDelayMs = 0, ...overrides } = {}) {
  await installMocks(page, overrides);
  const unsplash = [];
  await page.route("**://images.unsplash.com/**", async (route, request) => {
    unsplash.push(request.url());
    if (unsplashDelayMs) await new Promise((resolve) => setTimeout(resolve, unsplashDelayMs));
    return route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL_GIF });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.addInitScript((code) => localStorage.setItem("ws_lang", code), lang);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  return { unsplash, errors };
}

const QUERY = { lourdes: "Lourdes", paris: "Paris", tokyo: "Tokyo" };

/* Picks a curated place through the search box, exactly as a visitor does.
 * It does not wait for the weather or the photo, so two calls in a row overlap
 * the way quick real selections do. */
async function select(page, id) {
  await typeQuery(page, QUERY[id]);
  await page.locator("#searchResults .search-item", { hasText: QUERY[id] }).first().click();
}

/* Sidebar/bottom-nav clicks are hidden at some widths; the handler is the same */
const go = (page, view) =>
  page.evaluate((name) => document.querySelector(`[data-view="${name}"]`).click(), view);

async function heroShows(page, name) {
  await expect(page.locator("#heroCityName")).toContainText(name);
}
const settledHero = (page) => page.locator("#heroLandmark .loc-photo:not(.loading)");

async function typeQuery(page, query) {
  /* below 520px the field sits behind the mobile search button */
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").fill(query);
}

const LANGS = [
  {
    lang: "fr",
    place: "Lourdes",
    badge: "Ville",
    photoBy: "Photo exacte du lieu · Nick Castelli · Unsplash ↗",
  },
  {
    lang: "en",
    place: "Lourdes",
    badge: "City",
    photoBy: "Exact place photo · Nick Castelli · Unsplash ↗",
  },
];

for (const { lang, place, badge, photoBy } of LANGS) {
  test.describe(`Lourdes, France (${lang})`, () => {
    test.beforeEach(async ({ page }) => {
      await open(page, { lang });
      await select(page, "lourdes");
      await heroShows(page, place);
      await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);
    });

    test("renders exactly one hero image", async ({ page }) => {
      const hero = page.locator("#heroLandmark");
      await expect(hero.locator("img")).toHaveCount(1);
      await expect(hero.locator("img.loc-photo-img")).toHaveAttribute(
        "src",
        new RegExp(LOURDES_IMG),
      );
      /* …and nowhere else in the hero, whatever its class */
      await expect(page.locator(`.hero ${PICTURE}[src*="${LOURDES_IMG}"]`)).toHaveCount(1);
      await expect(page.locator("#heroInner").locator(PICTURE)).toHaveCount(0);
      await expect(page.locator(`.hero-loc-kicker ${PICTURE}`)).toHaveCount(0);
      /* the container keeps its emoji fallback underneath, as a glyph */
      await expect(hero.locator(".loc-photo-fallback")).toHaveText("⛪");
    });

    test("shows the attribution exactly once, with its source", async ({ page }) => {
      const credit = page.locator(".hero .loc-credit");
      await expect(credit).toHaveCount(1);
      await expect(credit).toHaveText(photoBy);
      await expect(credit).toHaveAttribute("href", new RegExp(LOURDES_LINK));
      await expect(credit).toHaveAttribute("data-provider", "unsplash");
      await expect(credit).toHaveAttribute("data-provenance", "exact");
      await expect(credit).toHaveAttribute("aria-label", /Nick Castelli/);
      await expect(page.locator(`.hero a[href*="${LOURDES_LINK}"]`)).toHaveCount(1);
    });

    test("keeps the City badge to its compact emoji", async ({ page }) => {
      const kicker = page.locator(".hero-loc-kicker");
      await expect(kicker.locator("img, picture, video, canvas")).toHaveCount(0);
      await expect(kicker).toContainText("⛪");
      await expect(kicker).toContainText(badge);
      /* compact: a one-line pill, not something the photo has stretched */
      const box = await kicker.boundingBox();
      expect(box.height).toBeLessThan(48);
    });
  });
}

test.describe("a dynamic city still gets its provider image", () => {
  for (const lang of ["fr", "en"]) {
    test(`Reykjavik: one Pexels image, one credit, an emoji badge (${lang})`, async ({ page }) => {
      await open(page, { lang });
      await typeQuery(page, "Reykjavik");
      await page.locator("#searchResults .search-item", { hasText: "Reykjavik" }).first().click();
      await heroShows(page, "Reykjavik");
      await expect(settledHero(page)).toHaveClass(/has-photo/);

      await expect(page.locator("#heroLandmark img")).toHaveCount(1);
      await expect(page.locator("#heroLandmark img")).toHaveAttribute("src", /^data:image\/gif/);
      const credit = page.locator(".hero .loc-credit");
      await expect(credit).toHaveCount(1);
      await expect(credit).toHaveAttribute("href", PEXELS_LINK);
      await expect(credit).toContainText("Pexels ↗");
      await expect(page.locator(".hero-loc-kicker").locator("img")).toHaveCount(0);
    });
  }
});

test.describe("a place with no photo keeps its emoji and gradient", () => {
  test("nothing from the provider: fallback only, no image, no credit", async ({ page }) => {
    await open(page, {
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
    });
    await select(page, "paris");
    await heroShows(page, "Paris");
    await expect(settledHero(page)).toBeVisible();

    const slot = page.locator("#heroLandmark .loc-photo");
    await expect(slot).not.toHaveClass(/has-photo/);
    await expect(slot).toHaveAttribute("data-photo-confidence", "none");
    await expect(slot.locator("img")).toHaveCount(0);
    await expect(slot.locator(".loc-photo-fallback")).toHaveText("🗼");
    await expect(slot).toHaveCSS("background-image", /linear-gradient/);
    await expect(page.locator(".hero .loc-credit")).toHaveCount(0);
    await expect(page.locator(".hero-loc-kicker")).toContainText("🗼");
  });

  test("a failing provider ends the same way", async ({ page }) => {
    await open(page, { photoProxy: (route) => route.fulfill({ status: 503, body: "down" }) });
    await select(page, "tokyo");
    await heroShows(page, "Tokyo");
    await expect(settledHero(page)).toBeVisible();
    await expect(page.locator("#heroLandmark img")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveAttribute(
      "data-photo-confidence",
      "none",
    );
  });
});

test.describe("search suggestions", () => {
  for (const lang of ["fr", "en"]) {
    test(`list Lourdes once, as a glyph, never as a picture (${lang})`, async ({ page }) => {
      await open(page, { lang });
      await typeQuery(page, "Lourdes");
      const rows = page.locator("#searchResults .search-item");
      await expect(rows.first()).toContainText("Lourdes");
      /* let the online lookup land and merge with the curated hit */
      await expect(page.locator("#searchStatus .map-panel-spinner")).toHaveCount(0);

      await expect(page.locator("#searchResults .si-name", { hasText: "Lourdes" })).toHaveCount(1);
      await expect(page.locator(`#searchResults ${PICTURE}`)).toHaveCount(0);
      await expect(rows.first().locator(".si-visual")).toHaveText("⛪");
    });
  }

  test("never list two identical rows", async ({ page }) => {
    await open(page);
    for (const query of ["paris", "lourdes", "tokyo", "reykjavik"]) {
      await typeQuery(page, query);
      await expect(page.locator("#searchResults .search-item").first()).toBeVisible();
      await expect(page.locator("#searchStatus .map-panel-spinner")).toHaveCount(0);
      const texts = await page
        .locator("#searchResults .search-item")
        .evaluateAll((items) => items.map((item) => item.textContent.replace(/\s+/g, " ").trim()));
      expect(new Set(texts).size, `${query}: ${texts.join(" | ")}`).toBe(texts.length);
    }
  });

  test("the empty-field menu lists a place once, even when it is popular AND a favourite", async ({
    page,
  }) => {
    await open(page);
    await select(page, "paris");
    await heroShows(page, "Paris");
    await page.locator("#heroFavBtn").click();
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await page.locator("#heroFavBtn").click();

    await page
      .locator("#searchInput")
      .isVisible()
      .then(async (visible) => {
        if (!visible) await page.locator("#mobileSearchBtn").click();
      });
    await page.locator("#searchInput").fill("");
    await page.locator("#searchInput").focus();
    const rows = page.locator("#searchResults .search-item");
    await expect(rows.first()).toBeVisible();
    const names = await page.locator("#searchResults .si-name").allTextContents();
    const clean = names.map((name) => name.replace(/\s+/g, " ").trim());
    expect(new Set(clean).size, clean.join(" | ")).toBe(clean.length);
    await expect(page.locator(`#searchResults ${PICTURE}`)).toHaveCount(0);
  });
});

test.describe("Favorites, Explore, Map and Forecast keep one image after re-rendering", () => {
  test("Favorites: one photo and one credit per place, in the cards and the table", async ({
    page,
  }) => {
    await open(page);
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await page.locator("#heroFavBtn").click();
    await go(page, "favorites");

    const card = page.locator('.favx-card[data-fav-id="lourdes"]');
    const row = page.locator('#favTable tr[data-loc="lourdes"]');
    const checkCard = async () => {
      await expect(card).toHaveCount(1);
      await expect(card.locator(".favx-bg")).toHaveClass(/has-photo/);
      await expect(card.locator(PICTURE)).toHaveCount(1);
      await expect(card.locator(".favx-emoji").locator("img")).toHaveCount(0);
      await expect(card.locator(".favx-emoji")).toHaveText("⛪");
      await expect(card.locator(".loc-credit")).toHaveCount(1);
    };
    const checkRow = async () => {
      await expect(row).toHaveCount(1);
      await expect(row.locator(".ft-visual")).toHaveClass(/has-photo/);
      await expect(row.locator(PICTURE)).toHaveCount(1);
      await expect(row.locator(".loc-photo-fallback").locator("img")).toHaveCount(0);
      await expect(row.locator(".loc-credit")).toHaveCount(1);
    };
    await checkCard();

    /* the table hydrates when it is shown; a language change repaints both */
    await page.locator('[data-favview="list"]').click();
    await checkRow();
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await checkRow();
    await page.locator('[data-favview="grid"]').click();
    await checkCard();
  });

  test("Explore: ten cards, none doubled, no picture in any emoji slot", async ({ page }) => {
    await open(page);
    const cards = page.locator("#exploreCarousel .explore-card");
    const check = async () => {
      await expect(cards).toHaveCount(EXPLORE_IDS.length);
      const ids = await cards.evaluateAll((els) => els.map((el) => el.dataset.loc));
      expect(ids).toEqual(EXPLORE_IDS);
      await expect(
        page.locator("#exploreCarousel .explore-emoji").locator("img:not(.flag)"),
      ).toHaveCount(0);
      for (const id of EXPLORE_IDS) {
        const card = page.locator(`.explore-card[data-loc="${id}"]`);
        expect(await card.locator(PICTURE).count(), id).toBeLessThanOrEqual(1);
        expect(await card.locator(".loc-credit").count(), id).toBeLessThanOrEqual(1);
      }
    };
    /* cards hydrate only when they are near the viewport */
    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await expect(cards.first().locator(".explore-bg")).toHaveClass(/has-photo/);
    await check();
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await expect(cards.first().locator(".explore-bg")).toHaveClass(/has-photo/);
    await check();
  });

  test("Map panel: one photo and one credit, still one after a repaint", async ({ page }) => {
    await open(page);
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await go(page, "map");
    const panel = page.locator("#mapWeatherPanel");
    const photo = panel.locator(".map-panel-photo");
    await expect(photo).toHaveClass(/has-photo/);
    await expect(panel.locator(".map-panel-photo")).toHaveCount(1);
    await expect(panel.locator(PICTURE)).toHaveCount(1);
    await expect(panel.locator(".loc-credit")).toHaveCount(1);

    /* the favourite button repaints the whole panel */
    await page.locator("#mapFavoriteBtn").click();
    await expect(page.locator("#mapFavoriteBtn")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator(".map-panel-photo")).toHaveClass(/has-photo/);
    await expect(panel.locator(".map-panel-photo")).toHaveCount(1);
    await expect(panel.locator(PICTURE)).toHaveCount(1);
    await expect(panel.locator(".loc-credit")).toHaveCount(1);
  });

  test("Forecast: no location picture at all, before or after a repaint", async ({ page }) => {
    await open(page);
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await go(page, "forecast");
    const view = page.locator("#view-forecast");
    await expect(view.locator(".loc-photo, .loc-credit")).toHaveCount(0);
    await expect(view.locator(`${PICTURE}[src*="${LOURDES_IMG}"]`)).toHaveCount(0);
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(view.locator(".loc-photo, .loc-credit")).toHaveCount(0);
    await expect(view.locator(`${PICTURE}[src*="${LOURDES_IMG}"]`)).toHaveCount(0);
  });

  test("no view leaves a duplicate id, a doubled panel or a doubled overlay", async ({ page }) => {
    await open(page);
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await page.locator("#heroFavBtn").click();
    for (const view of ["map", "forecast", "favorites", "home"]) {
      await go(page, view);
      await page.locator("#langBtn").click();
      await page.locator(`#langMenu button[data-lang="${view === "map" ? "en" : "fr"}"]`).click();
    }
    const dupes = await page.evaluate(() => {
      const seen = new Map();
      for (const el of document.querySelectorAll("[id]")) {
        seen.set(el.id, (seen.get(el.id) || 0) + 1);
      }
      return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`);
    });
    expect(dupes).toEqual([]);
    for (const selector of [
      "#mapWeatherPanel .map-panel",
      "#heroLandmark .loc-photo",
      "#searchPanel",
    ]) {
      expect(await page.locator(selector).count(), selector).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("one click is one action after many re-renders", () => {
  test("the favourite buttons are not bound twice by a repaint", async ({ page }) => {
    await open(page);
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    const toggleLanguage = async (code) => {
      await page.locator("#langBtn").click();
      await page.locator(`#langMenu button[data-lang="${code}"]`).click();
    };
    /* every one of these repaints the hero, the map panel and the cards */
    await toggleLanguage("en");
    await toggleLanguage("fr");
    await toggleLanguage("en");
    await go(page, "map");
    const star = () => page.locator("#mapFavoriteBtn");
    await star().click(); /* the panel is rebuilt by this very click */
    await expect(star()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#favBadge")).toHaveText("1");
    await star().click();
    await expect(star()).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#favBadge")).toBeHidden();
    await star().click();
    await expect(star()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#favBadge")).toHaveText("1");

    /* and the hero's own star, rebuilt by every one of those repaints */
    await go(page, "home");
    await expect(page.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#heroFavBtn").click();
    await expect(page.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#favBadge")).toBeHidden();
  });

  test("the loading skeleton is gone once the hero has painted, and none is repeated", async ({
    page,
  }) => {
    await open(page);
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);
    await expect(page.locator("#heroInner .skeleton")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveCount(1);
    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
  });
});

test.describe("rapid location changes never leave an old image behind", () => {
  test("Lourdes' slow photo does not land on Tokyo", async ({ page }) => {
    await open(page, { unsplashDelayMs: 700 });
    await select(page, "lourdes");
    await select(page, "tokyo");
    await heroShows(page, "Tokyo");
    await expect(settledHero(page)).toBeVisible();
    /* long enough for the delayed Lourdes response to have arrived */
    await page.waitForTimeout(1200);
    await expect(page.locator(`.hero img[src*="${LOURDES_IMG}"]`)).toHaveCount(0);
    await expect(page.locator(".hero a[href*='mnctB7nxJiQ']")).toHaveCount(0);
    await expect(page.locator("#heroLandmark img")).toHaveCount(1);
    await expect(page.locator(".hero .loc-credit")).toHaveCount(1);
    await expect(page.locator(".hero .loc-credit")).toContainText("Pexels");
  });

  test("Tokyo's slow provider photo does not land on Lourdes", async ({ page }) => {
    await open(page, {
      photoProxy: async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const query = new URL(route.request().url()).searchParams.get("query") || "";
        const photo = {
          src: {
            medium:
              "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          },
          photographer: "Slow Shooter",
          link: PEXELS_LINK,
          alt: `Tokyo skyline — ${query}`,
        };
        return route.fulfill(json({ photo, photos: [photo] }));
      },
    });
    await select(page, "tokyo");
    await select(page, "lourdes");
    await heroShows(page, "Lourdes");
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);
    await page.waitForTimeout(1200);
    await expect(page.locator("#heroLandmark img")).toHaveCount(1);
    await expect(page.locator("#heroLandmark img")).toHaveAttribute("src", new RegExp(LOURDES_IMG));
    await expect(page.locator(".hero .loc-credit")).toHaveCount(1);
    await expect(page.locator(".hero .loc-credit")).toContainText("Nick Castelli");
    await expect(page.locator(".hero .loc-credit")).not.toContainText("Slow Shooter");
  });

  test("five changes in a row end on the last place with one image and one credit", async ({
    page,
  }) => {
    await open(page, { unsplashDelayMs: 300 });
    for (const id of ["lourdes", "paris", "lourdes", "tokyo", "lourdes"]) await select(page, id);
    await heroShows(page, "Lourdes");
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);
    await page.waitForTimeout(1000);
    await expect(page.locator("#heroLandmark img")).toHaveCount(1);
    await expect(page.locator("#heroLandmark img")).toHaveAttribute("src", new RegExp(LOURDES_IMG));
    await expect(page.locator(".hero .loc-credit")).toHaveCount(1);
    await expect(page.locator(".hero .loc-credit")).toContainText("Nick Castelli");
    await expect(page.locator(".hero-loc-kicker").locator("img")).toHaveCount(0);
  });
});

test.describe("no repeated provider or weather request for one selection", () => {
  test("each photo and forecast URL is requested once across Home, Map and Favorites", async ({
    page,
  }) => {
    await open(page);
    const urls = [];
    page.on("request", (request) => {
      const url = request.url();
      const single =
        /open-meteo\.com\/v1\/forecast/.test(url) &&
        !new URL(url).searchParams.get("latitude").includes(",");
      if (/\/api\/(pexels|places|mapillary)|commons\.wikimedia\.org/.test(url) || single) {
        urls.push(url);
      }
    });
    await typeQuery(page, "Reykjavik");
    await page.locator("#searchResults .search-item", { hasText: "Reykjavik" }).first().click();
    await heroShows(page, "Reykjavik");
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);
    await page.locator("#heroFavBtn").click();
    await go(page, "map");
    await expect(page.locator("#mapWeatherPanel .map-panel-photo")).toHaveClass(/has-photo/);
    await go(page, "favorites");
    await expect(page.locator(".favx-card .favx-bg").first()).toHaveClass(/has-photo/);
    await page.waitForTimeout(500);

    const counts = new Map();
    for (const url of urls) counts.set(url, (counts.get(url) || 0) + 1);
    const repeated = [...counts].filter(([, n]) => n > 1).map(([url, n]) => `${n}× ${url}`);
    expect(repeated).toEqual([]);
  });
});

test.describe("layouts stay valid with the single image", () => {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    test(`Lourdes at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 800 : 900 });
      const { errors } = await open(page);
      await select(page, "lourdes");
      await heroShows(page, "Lourdes");
      await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);

      await expect(page.locator("#heroLandmark img")).toHaveCount(1);
      await expect(page.locator(".hero .loc-credit")).toHaveCount(1);
      await expect(page.locator(".hero-loc-kicker").locator("img")).toHaveCount(0);

      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const hero = rect(".hero");
        const photo = rect("#heroLandmark img");
        const credit = rect(".hero .loc-credit");
        const kicker = rect(".hero-loc-kicker");
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          photoInsideHero:
            photo.left >= hero.left - 1 &&
            photo.right <= hero.right + 1 &&
            photo.top >= hero.top - 1 &&
            photo.bottom <= hero.bottom + 1,
          creditInsideViewport: credit.left >= 0 && credit.right <= window.innerWidth,
          kickerHeight: kicker.height,
        };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      expect(geometry.photoInsideHero).toBe(true);
      expect(geometry.creditInsideViewport).toBe(true);
      expect(geometry.kickerHeight).toBeLessThan(48);
      expect(errors).toEqual([]);
    });
  }
});
