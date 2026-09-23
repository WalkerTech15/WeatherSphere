import { test, expect, installMocks, json } from "./mocks.js";

async function openMap(page, lightningBody) {
  await installMocks(page);
  await page.route("**/api/xweather-lightning**", (route) =>
    route.fulfill(json(lightningBody)),
  );
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  await page.locator('.side-item[data-view="map"]').click();
  await expect(page.locator("#mapWeatherPanel .map-panel-head")).toBeVisible();
}

test.describe("Xweather lightning layer", () => {
  test("shows verified strikes, attribution, and an accessible map control", async ({ page }) => {
    await openMap(page, {
      provider: "Xweather",
      source: "https://www.xweather.com/docs/weather-api/endpoints/lightning",
      strikes: [{ lat: 48.8566, lon: 2.3522, type: "CG", amperage: 12000 }],
    });

    const button = page.locator('.map-layer[data-map-layer="lightning"]');
    await expect(button).toHaveAttribute("role", "radio");
    await button.click();
    await expect(button).toHaveAttribute("aria-checked", "true", { timeout: 15000 });
    await expect(page.locator("#mapWeatherControls")).toContainText("Xweather");
    await expect(page.locator("#mapWeatherControls")).toContainText("1 observation(s) récente(s)");
    await expect(page.locator("#mapLayerStatus")).toContainText("observation(s) récente(s)");
  });

  test("distinguishes valid empty data from an API failure", async ({ page }) => {
    await openMap(page, { provider: "Xweather", strikes: [] });
    await page.locator('.map-layer[data-map-layer="lightning"]').click();
    await expect(page.locator("#mapWeatherControls")).toContainText("Aucune foudre récente", {
      timeout: 15000,
    });
    await expect(page.locator("#mapWeatherControls")).not.toContainText("unavailable");
  });
});
