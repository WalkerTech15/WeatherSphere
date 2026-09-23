/* Official alerts on a phone: several warnings at once must stay readable
 * and must not push the page sideways — the list scrolls inside its own
 * card rather than growing it (see styles/views/map.css). */
import { test, expect, installMocks, nwsAlertFeature, nwsAlertsPayload } from "./mocks.js";

const alertsBtn = (page) => page.locator('.map-layer[data-map-layer="alerts"]');

async function openMapAt(page, overrides) {
  await installMocks(page, overrides);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  await page.locator("#burgerBtn").click();
  await page.locator('.side-item[data-view="map"]').click();
}

/* New York (cc US) is inside NWS coverage; the carousel card also returns
   to Home, so the Map view is re-opened afterwards. */
async function selectUnitedStates(page) {
  await page
    .locator("#exploreCarousel .explore-open")
    .nth(1)
    .evaluate((b) => b.click());
  await expect(page.locator("#heroCityName")).toContainText("New York");
  await page.locator("#burgerBtn").click();
  await page.locator('.side-item[data-view="map"]').click();
}

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("a long warning never pushes the page sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMapAt(page, {
    nwsBody: nwsAlertsPayload([
      nwsAlertFeature({
        areaDesc:
          "Cleveland County, OK; McClain County, OK; Grady County, OK; Canadian County, OK; Oklahoma County, OK",
        senderName: "NWS Norman OK",
      }),
    ]),
  });
  await selectUnitedStates(page);
  await alertsBtn(page).scrollIntoViewIfNeeded();
  await alertsBtn(page).click();

  const alert = page.locator("#mapWeatherControls .map-alert").first();
  await expect(alert).toBeVisible({ timeout: 20000 });
  await expect(alert.locator(".map-alert-event")).toHaveText("Tornado Warning");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("several alerts stay inside the card instead of growing the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMapAt(page, {
    nwsBody: nwsAlertsPayload([
      nwsAlertFeature({ event: "Tornado Warning", severity: "Extreme" }),
      nwsAlertFeature({ event: "Severe Thunderstorm Warning", severity: "Severe" }),
      nwsAlertFeature({ event: "Flash Flood Warning", severity: "Severe" }),
    ]),
  });
  await selectUnitedStates(page);
  await alertsBtn(page).scrollIntoViewIfNeeded();
  await alertsBtn(page).click();

  const list = page.locator("#mapWeatherControls .map-alerts-list");
  await expect(list).toBeVisible({ timeout: 20000 });
  await expect(list.locator(".map-alert")).toHaveCount(3);

  const box = await list.boundingBox();
  expect(box.width).toBeLessThanOrEqual(375);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("the no-coverage message fits a phone without overflowing", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMapAt(page); /* Paris — outside NWS coverage */
  await alertsBtn(page).scrollIntoViewIfNeeded();
  await alertsBtn(page).click();

  const panel = page.locator("#mapWeatherControls");
  await expect(panel).toContainText("Aucune couverture d'alertes officielles", { timeout: 20000 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("the button is a real 44px touch target, not a disabled placeholder", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMapAt(page);
  await alertsBtn(page).scrollIntoViewIfNeeded();
  await expect(alertsBtn(page)).toBeEnabled();
  const box = await alertsBtn(page).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
