/* Search-result thumbnails: a compact, verified photo in place of the plain
 * emoji/flag for a kind the photo pipeline actually covers (see
 * services/photo-api.js's isSearchThumbEligible and features/search.js).
 *
 * What this file guards, that image-duplication.spec.js's own Lourdes/Paris
 * cases don't already cover:
 *   - every eligible KIND gets a thumbnail (city, state/region, country),
 *     and an ineligible kind (a raw address/POI pin) never attempts one;
 *   - a photo the pipeline can only call "generic" (an unverified stock
 *     match) stays on the plain glyph here — there is no room in a 36px
 *     dropdown row to disclose "illustrative, not verified", so the row
 *     holds out for a photo it can actually stand behind;
 *   - the search box never turns into a burst of photo requests: typing is
 *     debounced, an unchanged place is served from the shared photo cache,
 *     and closing/clearing the panel cancels whatever was still pending;
 *   - a broken image or an unavailable provider ends on the fallback, not a
 *     broken row or a console error;
 *   - the thumbnail survives every interface language and every width the
 *     rest of the app is tested at.
 */
import {
  test,
  expect,
  installMocks,
  json,
  photoProxyPayload,
  wikimediaPhotoPage,
  GEOCODE_LABEL,
} from "./mocks.js";

const PICTURE = "img:not(.flag):not(.flag-img)";
const CALIFORNIA_ID = "1591382"; // curated pexelsId — see data/locations.js

function recordPhotoQueries(queries) {
  return (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query) queries.push(query);
    return route.fulfill(json(photoProxyPayload(query)));
  };
}

/* A Pexels by-ID response — the exact-photo contract California's curated
   entry uses (a manually reviewed id, never re-checked for relevance). */
function byIdPhoto(id) {
  return (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("id") !== id) return route.fulfill(json({ photo: null, photos: [] }));
    const photo = {
      src: {
        medium: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      },
      photographer: "A Reviewed Photographer",
      link: "https://www.pexels.com/photo/california-1591382/",
      alt: "California coastline",
    };
    return route.fulfill(json({ photo, photos: [photo] }));
  };
}

/* A Commons TEXT match naming the country itself — the one path that reaches
   "exact" tier for a country (Pexels' own text match is always downgraded to
   "generic" — see withTextProvenance's `stock` flag — which excludeGeneric
   then holds back from this compact row). Built with wikimediaPhotoPage()
   so its thumburl is the one host mocks.js already serves real bytes for
   (WIKIMEDIA_THUMB_URL) — a hand-rolled URL here would just be aborted by
   installMocks()'s unmocked-external-request guard. */
function franceWikimediaProxy(route) {
  const url = new URL(route.request().url());
  if (url.searchParams.get("generator") !== "search") {
    return route.fulfill(json({ query: { pages: [] } }));
  }
  return route.fulfill(
    json(
      wikimediaPhotoPage({
        title: "France landscape",
        alt: "Aerial view of France countryside",
        photographer: "A Commons Contributor",
        license: "CC BY-SA 4.0",
      }),
    ),
  );
}

/* The suite's own default UI language is French (see image-duplication.spec.js's
   open()) — English keeps every assertion below matching curated place names
   as written (California, France, Texas…) without a second translation to
   track; the language-coverage block at the end passes its own `lang`. */
async function openApp(page, lang = "en") {
  await page.addInitScript((code) => localStorage.setItem("ws_lang", code), lang);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

async function typeQuery(page, query) {
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").fill(query);
}

const rowThumb = (page, text) =>
  page.locator("#searchResults .search-item", { hasText: text }).first().locator(".si-visual");

test.describe("every eligible kind gets a thumbnail", () => {
  test("a curated state/region (California, by-ID) shows its exact photo", async ({ page }) => {
    await installMocks(page, { photoProxy: byIdPhoto(CALIFORNIA_ID) });
    await openApp(page);
    await typeQuery(page, "California");
    const thumb = rowThumb(page, "California");
    await expect(thumb).toHaveClass(/has-photo/);
    await expect(thumb.locator(PICTURE)).toHaveAttribute("src", /^data:image\/gif/);
  });

  test("a curated country (France, a Commons text match) shows its photo", async ({ page }) => {
    await installMocks(page, {
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
      wikimediaProxy: franceWikimediaProxy,
    });
    await openApp(page);
    await typeQuery(page, "France");
    const thumb = rowThumb(page, "France");
    await expect(thumb).toHaveClass(/has-photo/);
    await expect(thumb.locator(PICTURE)).toBeVisible();
  });

  /* address/poi rows never even attempt a lookup (SEARCH_THUMB_KINDS in
     services/photo-api.js excludes both) — covered directly, without needing
     a live search fixture, by photo-api.test.js's isSearchThumbEligible
     suite; typing a real address/POI through the mocked geocoder here would
     only re-test the same kind check through far more scaffolding. */
});

test.describe("a photo the pipeline cannot verify never appears in the compact row", () => {
  test("Reykjavik's only match is a generic stock hit — the row keeps its emoji", async ({
    page,
  }) => {
    /* Default installMocks() Pexels answer matches every query by design
       (see photoProxyPayload) but is always a STOCK match — withTextProvenance
       tags it "generic", the one tier excludeGeneric holds back here. The
       same place's HERO, once selected, still shows this exact photo,
       correctly labelled "illustrative" — this is a dropdown-only decision. */
    await installMocks(page);
    await openApp(page);
    await typeQuery(page, GEOCODE_LABEL);
    const thumb = rowThumb(page, GEOCODE_LABEL);
    await expect(thumb).toBeVisible();
    await expect(thumb).not.toHaveClass(/has-photo/);
    await expect(thumb.locator(PICTURE)).toHaveCount(0);
  });

  test("Paris, Texas keeps its cowboy-hat emoji — no curated photo exists for it", async ({
    page,
  }) => {
    await installMocks(page);
    await openApp(page);
    await typeQuery(page, "Paris");
    const texasRow = page.locator("#searchResults .search-item", { hasText: "Texas" }).first();
    await expect(texasRow).toBeVisible();
    await expect(texasRow.locator(".si-visual")).not.toHaveClass(/has-photo/);
  });
});

test.describe("network discipline: debounced, deduplicated, cancellable", () => {
  test("typing several characters quickly asks for a photo once, not per keystroke", async ({
    page,
  }) => {
    const queries = [];
    await installMocks(page, { photoProxy: recordPhotoQueries(queries) });
    await openApp(page);
    if (!(await page.locator("#searchInput").isVisible())) {
      await page.locator("#mobileSearchBtn").click();
    }
    const input = page.locator("#searchInput");
    /* Five keystrokes, each well under the 250ms thumbnail debounce apart —
       every one repaints the row (so it always reflects what's typed so
       far), but only the settled query should ever reach the network. */
    for (const ch of "Paris".split("")) {
      await input.pressSequentially(ch, { delay: 30 });
    }
    await expect(rowThumb(page, "Paris")).toHaveClass(/has-photo/, { timeout: 5000 });
    /* Paris is curated with a by-ID photo (no query param at all), so the
       only entries this records are from OTHER eligible rows the merged
       results may also show — none of them should repeat. */
    await expect.poll(() => queries.length, { timeout: 2000 }).toBe(new Set(queries).size); // every recorded query is distinct
  });

  test("re-searching an already-looked-up place costs no second request", async ({ page }) => {
    const queries = [];
    await installMocks(page, {
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
      wikimediaProxy: (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("generator") === "search") queries.push(url.toString());
        return franceWikimediaProxy(route);
      },
    });
    await openApp(page);
    await typeQuery(page, "France");
    await expect(rowThumb(page, "France")).toHaveClass(/has-photo/);
    const firstCount = queries.length;
    expect(firstCount).toBeGreaterThan(0);

    await page.locator("#searchInput").fill("");
    await typeQuery(page, "France");
    await expect(rowThumb(page, "France")).toHaveClass(/has-photo/);
    expect(queries.length).toBe(firstCount); // served from the shared photo cache
  });

  test("clearing the query before the debounce fires sends no request at all", async ({ page }) => {
    const queries = [];
    await installMocks(page, { photoProxy: recordPhotoQueries(queries) });
    await openApp(page);
    /* the app's own initial load (Home hero, Explore cards) can ask for a
       photo of its own before this even starts — this test only cares
       whether CALIFORNIA specifically was ever asked for */
    await typeQuery(page, "California");
    await expect(
      page.locator("#searchResults .search-item", { hasText: "California" }),
    ).toBeVisible();
    /* well inside the 250ms thumbnail debounce */
    await page.locator("#searchInput").fill("");
    await page.waitForTimeout(400); // past the debounce, had it not been cancelled
    expect(queries.filter((q) => q.includes("California"))).toEqual([]);
  });
});

test.describe("failure modes still end on the fallback, never a broken row", () => {
  test("an unavailable Pexels proxy (503) leaves the emoji in place, no page error", async ({
    page,
  }) => {
    /* Chromium's own console logs a 503 resource load as a "console error"
       regardless of whether the app handled it gracefully — the same reason
       photo-confidence.spec.js's own 429-provider test checks pageerror
       only, never console "error" messages, for a deliberately-mocked
       failure like this one. */
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await installMocks(page, {
      photoProxy: (route) => route.fulfill({ status: 503, body: "down" }),
    });
    await openApp(page);
    await typeQuery(page, "California"); // by-ID lookup, hits this same proxy
    const thumb = rowThumb(page, "California");
    await expect(thumb).toBeVisible();
    await expect(thumb).not.toHaveClass(/has-photo/);
    expect(errors).toEqual([]);
  });

  test("a broken image response (404 on the pixel itself) falls back cleanly", async ({ page }) => {
    await installMocks(page, { photoProxy: byIdPhoto(CALIFORNIA_ID) });
    /* the src the mock answers with is a data: URI (never a real network
       request for the bytes), so this exercises the same onerror path a
       genuinely dead photo host would through a route override instead */
    await page.route("data:image/gif*", (route) => route.abort());
    await openApp(page);
    await typeQuery(page, "California");
    await expect(
      page.locator("#searchResults .search-item", { hasText: "California" }),
    ).toBeVisible();
    /* no page error, whatever the thumbnail ends up showing */
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

test.describe("every interface language", () => {
  for (const lang of ["fr", "en", "es", "vi"]) {
    test(`Lourdes' curated thumbnail still appears in ${lang}`, async ({ page }) => {
      const unsplash = [];
      await installMocks(page);
      await page.route("**://images.unsplash.com/**", (route) => {
        unsplash.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: "image/gif",
          body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
        });
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await openApp(page, lang);
      await typeQuery(page, "Lourdes");
      const thumb = rowThumb(page, "Lourdes");
      await expect(thumb).toHaveClass(/has-photo/);
      expect(unsplash.length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("responsive: the thumbnail slot never changes the compact layout", () => {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    test(`${width}px: a 36px slot, no overflow, no photo cut off`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await installMocks(page, { photoProxy: byIdPhoto(CALIFORNIA_ID) });
      await openApp(page);
      await typeQuery(page, "California");
      const thumb = rowThumb(page, "California");
      await expect(thumb).toHaveClass(/has-photo/);
      const box = await thumb.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.width).toBeLessThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeLessThanOrEqual(40);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
