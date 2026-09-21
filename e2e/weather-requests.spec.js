/* Weather request behaviour as a visitor experiences it: quick changes of
 * place end on the last one without downloading every superseded forecast,
 * lists never send the same request twice at once, and the Map page's
 * nearby-places lookup only runs while the Map is open. */
import { test, expect, installMocks } from "./mocks.js";

const isForecast = (url) =>
  url.includes("api.open-meteo.com/v1/forecast") && url.includes("forecast_days=8");
const isFavoritesBatch = (url) =>
  url.includes("api.open-meteo.com/v1/forecast") &&
  url.includes("temperature_2m_max%2Ctemperature_2m_min");
const isNearbyBatch = (url) =>
  url.includes("api.open-meteo.com/v1/forecast") &&
  url.includes("hourly=precipitation_probability&");
const isReverseGeocode = (url) =>
  /api\.maptiler\.com\/geocoding\/-?\d+(\.\d+)?,-?\d+(\.\d+)?\.json/.test(url);

/* Holds every Open-Meteo forecast answer for `ms`, so requests are still in
   flight when the next action happens. */
async function slowForecasts(page, ms) {
  await page.route("**://api.open-meteo.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    try {
      await route.fallback();
    } catch {
      /* the page cancelled it meanwhile */
    }
  });
}

function recordRequests(page) {
  const started = [];
  const failed = [];
  page.on("request", (request) => started.push(request.url()));
  page.on("requestfailed", (request) => failed.push(request.url()));
  return { started, failed };
}

test.describe("changing place quickly", () => {
  test("ends on the last place and cancels the forecasts it replaced", async ({ app }) => {
    await slowForecasts(app, 1200);
    const log = recordRequests(app);
    const cards = app.locator("#exploreCarousel .explore-open");
    const count = Math.min(3, await cards.count());
    expect(count).toBeGreaterThanOrEqual(2);
    const lastName = await cards
      .nth(count - 1)
      .locator("xpath=..")
      .locator(".explore-name")
      .innerText();

    for (let i = 0; i < count; i++) {
      await cards.nth(i).evaluate((button) => button.click());
    }

    await expect(app.locator("#heroCityName")).toContainText(lastName, { timeout: 10000 });
    await expect.poll(() => log.failed.filter(isForecast).length).toBe(count - 1);
    expect(log.started.filter(isForecast)).toHaveLength(count);
    /* a cancellation is not an error: no demo-weather notice for the last place */
    await expect(app.locator("#view-home .wx-notice")).toBeEmpty();
  });
});

test.describe("favorites", () => {
  test("starring a place and opening Favorites sends one favorites request", async ({ app }) => {
    await slowForecasts(app, 800);
    const log = recordRequests(app);
    await app.locator("#heroFavBtn").click();
    await app.locator('.side-item[data-view="favorites"]').click();
    await expect(app.locator("#favGrid")).toContainText(/\d/, { timeout: 10000 });
    expect(log.started.filter(isFavoritesBatch)).toHaveLength(1);
  });
});

test.describe("nearby places", () => {
  test("are not looked up while the Map view is closed", async ({ app }) => {
    const log = recordRequests(app);
    await app
      .locator("#exploreCarousel .explore-open")
      .first()
      .evaluate((b) => b.click());
    await app.waitForTimeout(1500);
    expect(log.started.filter(isNearbyBatch)).toHaveLength(0);
    expect(log.started.filter(isReverseGeocode)).toHaveLength(0);
  });

  test("load when the Map view opens, in French and in English", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const log = recordRequests(page);
    await page.locator('.side-item[data-view="map"]').click();

    const body = page.locator("#mapPanelNearbyBody");
    await expect(body.locator(".map-nearby-place").first()).toBeVisible({ timeout: 10000 });
    expect(log.started.filter(isNearbyBatch)).toHaveLength(1);
    await expect(page.locator(".map-panel-nearby-title")).toHaveText("Lieux à proximité");

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(page.locator(".map-panel-nearby-title")).toHaveText("Nearby places");
    await expect(body.locator(".map-nearby-place").first()).toBeVisible();
    /* a language change repaints from the cached lookup, not a new one */
    expect(log.started.filter(isNearbyBatch)).toHaveLength(1);
  });

  test("a place picked on Home is looked up on the next visit to the Map", async ({ app }) => {
    const card = app.locator("#exploreCarousel .explore-open").first();
    const name = await card.locator("xpath=..").locator(".explore-name").innerText();
    await card.evaluate((b) => b.click());
    await expect(app.locator("#heroCityName")).toContainText(name);
    const log = recordRequests(app);
    await app.locator('.side-item[data-view="map"]').click();
    await expect(app.locator(".map-panel-head")).toContainText(name);
    await expect(
      app
        .locator("#mapPanelNearbyBody .map-nearby-place, #mapPanelNearbyBody [data-state]")
        .first(),
    ).toBeVisible({ timeout: 10000 });
    await expect.poll(() => log.started.filter(isReverseGeocode).length).toBeGreaterThan(0);
  });
});
