/* Weather request behaviour on a phone: the Map page's nearby places are
 * looked up only once the Map is opened from the drawer, and a quick run of
 * picks on Home still ends on the last place. */
import { test, expect } from "./mocks.js";

const isNearbyBatch = (url) =>
  url.includes("api.open-meteo.com/v1/forecast") &&
  url.includes("hourly=precipitation_probability&");

function recordRequests(page) {
  const started = [];
  page.on("request", (request) => started.push(request.url()));
  return started;
}

async function openView(page, view) {
  await page.locator("#burgerBtn").click();
  await page.locator(`.side-item[data-view="${view}"]`).click();
}

test("nearby places load only when the Map is opened", async ({ app }) => {
  const started = recordRequests(app);
  await app.waitForTimeout(1000);
  expect(started.filter(isNearbyBatch)).toHaveLength(0);

  await openView(app, "map");
  await expect(app.locator("#mapPanelNearbyBody .map-nearby-place").first()).toBeAttached({
    timeout: 10000,
  });
  expect(started.filter(isNearbyBatch)).toHaveLength(1);
});

test("a quick run of picks ends on the last place", async ({ app }) => {
  await app.route("**://api.open-meteo.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    try {
      await route.fallback();
    } catch {
      /* cancelled by the page */
    }
  });
  const cards = app.locator("#exploreCarousel .explore-open");
  const lastName = await cards.nth(1).locator("xpath=..").locator(".explore-name").innerText();
  await cards.nth(0).evaluate((button) => button.click());
  await cards.nth(1).evaluate((button) => button.click());
  await expect(app.locator("#heroCityName")).toContainText(lastName, { timeout: 10000 });
  await expect(app.locator("#view-home .wx-notice")).toBeEmpty();
});
