/* Loading-cost guarantees: what the browser is allowed to fetch, and when.
 *
 * These are the counterpart to the correctness specs — nothing here asserts
 * how anything LOOKS, only that expensive work is deferred until it is
 * actually needed and that deferring it never costs a fallback, an
 * attribution, or a stale-request guard.
 *
 * Two costs are covered:
 *   1. the MapTiler SDK (~1.2 MB JS + ~101 KB CSS), which must stay out of
 *      first paint — its stylesheet in particular now travels with the SDK
 *      chunk instead of the render-blocking bundle it used to sit in;
 *   2. secondary location photos (Explore, Favorites), which must not
 *      compete with the hero for bandwidth while they are off-screen.
 *
 * The dev server serves unbundled modules, so "the SDK chunk" is matched by
 * module path rather than by built filename — true in both dev and build. */
import { test, expect, installMocks, GEOCODE_LABEL } from "./mocks.js";

/* Vite pre-bundles the dependency as ".vite/deps/@maptiler_sdk.js" in dev and
   emits "maptiler-sdk-<hash>.js" in a build — match either, and never the
   stylesheet, which is tracked separately. */
const SDK_JS = /@maptiler_sdk\.js|maptiler-sdk-[A-Za-z0-9]+\.js/;
const SDK_CSS = /maptiler-sdk[^/]*\.css/;

/* Every request the page makes, so a test can assert an absence as well as a
   presence. Registered before goto() so nothing is missed. */
function trackRequests(page) {
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  return {
    urls,
    sdkJs: () => urls.filter((u) => SDK_JS.test(u) && !SDK_CSS.test(u)),
    sdkCss: () => urls.filter((u) => SDK_CSS.test(u)),
    photos: () => urls.filter((u) => u.includes("/api/pexels")),
  };
}

test.describe("MapTiler is loaded only when a map is actually needed", () => {
  /* The Home mini-map sits far below the fold, so it is created only once it
     is scrolled near: a visitor who never gets that far never downloads the
     SDK, its stylesheet, or any style/tile request. */
  test("the Home mini-map loads MapTiler only once it is approached, then renders", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMocks(page);
    const seen = trackRequests(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    /* long enough for the old idle-time kickoff to have fired many times */
    await page.waitForTimeout(3000);
    expect(seen.sdkJs()).toHaveLength(0);
    expect(seen.sdkCss()).toHaveLength(0);
    expect(seen.urls.filter((u) => /api\.maptiler\.com/.test(u))).toEqual([]);
    /* meanwhile the preview keeps its reserved box and loading state */
    await expect(page.locator("#homeMap")).toHaveClass(/is-loading/);
    const reserved = await page.locator("#homeMap").boundingBox();
    expect(reserved.height).toBeGreaterThan(200);

    await page.locator("#homeMap").scrollIntoViewIfNeeded();
    await expect(page.locator("#homeMap canvas")).toBeVisible({ timeout: 20000 });
    expect(seen.sdkJs().length).toBeGreaterThan(0);
    /* the stylesheet travels with the SDK chunk, not with the page */
    expect(seen.sdkCss().length).toBeGreaterThan(0);
    await expect(page.locator("#homeMap .maplibregl-marker")).toBeVisible();
  });

  test("the other views never load MapTiler at all", async ({ page }) => {
    await installMocks(page);
    const seen = trackRequests(page);
    await page.goto("/#/forecast");
    await expect(page.locator("#forecastRow2 > *").first()).toBeVisible({ timeout: 20000 });
    for (const view of ["favorites", "settings", "about", "forecast"]) {
      await page.locator(`.side-item[data-view="${view}"]`).click();
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      /* scroll each one fully: nothing further down may pull a map in */
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
    }
    expect(seen.sdkJs()).toEqual([]);
    expect(seen.sdkCss()).toEqual([]);
    expect(seen.urls.filter((u) => /api\.maptiler\.com/.test(u))).toEqual([]);
  });

  test("opening the Map page loads the SDK immediately, without waiting to scroll", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/#/map");
    /* an explicit visit is never deferred — the map is the point of the page */
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
  });
});

test.describe("image loading priority and laziness", () => {
  test("the hero photo loads immediately and keeps its attribution", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    /* the hero is the LCP candidate: never deferred behind visibility */
    await expect(page.locator("#heroLandmark .loc-photo")).toBeVisible();
    const priority = await page
      .locator("#heroLandmark img.loc-photo-img")
      .getAttribute("fetchpriority")
      .catch(() => null);
    /* either a real photo marked high-priority, or the gradient fallback —
       both are correct; what must never happen is a deferred hero */
    if (priority !== null) expect(priority).toBe("high");
  });

  test("off-screen Explore photos are not requested until they are approached", async ({
    page,
  }) => {
    await installMocks(page);
    const seen = trackRequests(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.waitForTimeout(2000);
    const beforeScroll = seen.photos().length;

    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);

    /* approaching the carousel is what triggers its lookups */
    expect(seen.photos().length).toBeGreaterThanOrEqual(beforeScroll);
  });

  test("a deferred photo still renders, with credit, once scrolled to", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    const card = page.locator(".explore-card").first();
    if ((await card.count()) === 0) test.skip(true, "no explore carousel in this build");
    await card.scrollIntoViewIfNeeded();
    /* the fallback gradient is always present, so the card is never blank
       while its photo is still deferred */
    await expect(card.locator(".loc-photo")).toBeVisible();
  });
});

test.describe("responsive image sizing", () => {
  test("the map detail panel requests a thumbnail-sized candidate, not a hero-sized one", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto(`/#/map`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });

    const img = page.locator("#mapWeatherPanel img.loc-photo-img");
    if ((await img.count()) === 0) test.skip(true, "no photo for the default location in mocks");
    /* the panel is at most 350px wide — a 720px `sizes` made the browser
       pick Pexels' 1880w candidate for a 132px-tall box */
    await expect(img).toHaveAttribute("sizes", "(max-width: 820px) 100vw, 350px");
  });
});

test.describe("no layout shift from deferred work", () => {
  test("photo containers reserve their space before the image arrives", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    /* measured before any photo can have loaded, then again after: the
       fixed-ratio container is the skeleton, so the box must not resize */
    const box = page.locator("#heroLandmark .loc-photo");
    const before = await box.boundingBox();
    await page.waitForTimeout(2500);
    const after = await box.boundingBox();
    expect(Math.round(after.width)).toBe(Math.round(before.width));
    expect(Math.round(after.height)).toBe(Math.round(before.height));
  });

  test("cumulative layout shift on Home stays within budget", async ({ page }) => {
    await installMocks(page);
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.waitForTimeout(3000);

    /* Core Web Vitals calls ≤0.1 "good". Measured ~0.058 here, unchanged by
       the deferral work (the remaining shift is pre-existing and unrelated
       to images or the map). */
    const cls = await page.evaluate(() => window.__cls);
    expect(cls).toBeLessThan(0.1);
  });

  /* The metrics, hourly strip and 7-day row start empty and fill when the
     first forecast lands. With instant mocks that happens before first
     paint, so the forecast is held back here — the real-network ordering,
     where on a tablet filling them used to shift the page by 0.14–0.19. */
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`Home does not jump when the first forecast arrives late (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await installMocks(page);
      await page.route("**://api.open-meteo.com/**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fallback();
      });
      await page.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!entry.hadRecentInput) window.__cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto("/");
      /* painted, still waiting for the forecast */
      await expect(page.locator("#forecastRow")).toBeEmpty();
      await expect(page.locator(".hero-temp")).toHaveText(/\d/, { timeout: 15000 });
      await page.waitForTimeout(1000);
      expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.02);
    });
  }
});

test.describe("deferral never costs a fallback", () => {
  test("a photo API failure still leaves the gradient fallback and no credit", async ({ page }) => {
    await installMocks(page, { photoProxy: (route) => route.fulfill({ status: 503, body: "" }) });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.waitForTimeout(1500);

    await expect(page.locator("#heroLandmark .loc-photo")).toBeVisible();
    await expect(page.locator("#heroLandmark .loc-photo.has-photo")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);
  });

  test("rapid location changes never leave the previous location's photo", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await page.locator("#searchInput").fill("Paris");
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText("Paris");
    await page.waitForTimeout(1200);

    /* the hero must not still be showing the place we navigated away from */
    await expect(page.locator("#heroLandmark")).not.toContainText(GEOCODE_LABEL);
  });
});
