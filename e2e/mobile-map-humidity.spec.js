/* Humidity on a phone: the point-reading panel (not a map layer — see
 * features/map.js) fits the mobile layout without horizontal overflow and
 * stays reachable/tappable in the same 2-row switcher as every other
 * layer control. */
import { test, expect, installMocks } from "./mocks.js";

async function openMap(page) {
  await installMocks(page);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  await page.locator("#burgerBtn").click();
  await page.locator('.side-item[data-view="map"]').click();
}

test("the reading loads and the page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMap(page);

  const humidityBtn = page.locator('.map-layer[data-map-layer="humidity"]');
  await humidityBtn.scrollIntoViewIfNeeded();
  await expect(humidityBtn).toBeEnabled();
  await humidityBtn.click();

  const humidity = page.locator("#mapWeatherControls .map-humidity");
  await expect(humidity).toBeVisible({ timeout: 20000 });
  await expect(humidity.locator(".map-aqi-value")).toContainText("55");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the button is a real 44px touch target, not a disabled placeholder", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMap(page);

  const humidityBtn = page.locator('.map-layer[data-map-layer="humidity"]');
  await humidityBtn.scrollIntoViewIfNeeded();
  await expect(humidityBtn).toBeEnabled();
  const box = await humidityBtn.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
