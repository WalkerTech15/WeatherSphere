import { test, expect } from "./mocks.js";

const goToSettings = (app) => app.locator('.side-item[data-view="settings"]').click();

test.describe("settings — weather provider", () => {
  test("shows Open-Meteo as current and the school API as not ready", async ({ app }) => {
    await goToSettings(app);
    const card = app.locator("#view-settings .set-provider");

    await expect(card).toBeVisible();
    await expect(card.locator(".is-current")).toContainText("Open-Meteo");
    await expect(card.locator(".is-current [data-i18n='providerCurrent']")).toBeVisible();
    await expect(card.locator(".is-unavailable")).toHaveAttribute("aria-disabled", "true");
    await expect(card.locator(".is-unavailable")).toContainText("API");
    await expect(card.locator(".is-unavailable [data-i18n='providerConfigure']")).toBeVisible();
    await expect(card.locator("button, input, select")).toHaveCount(0);
  });

  test("provider information translates with the Settings language", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#view-settings .set-tile[data-lang="en"]').click();
    const card = app.locator("#view-settings .set-provider");
    await expect(card).toContainText("Weather provider");
    await expect(card).toContainText("My school project API");

    await app.locator('#view-settings .set-tile[data-lang="fr"]').click();
    await expect(card).toContainText("Source météo");
    await expect(card).toContainText("API de mon projet scolaire");
    await expect(card).toContainText("À configurer");
  });

  test("provider card fits a mobile viewport without horizontal overflow", async ({ app }) => {
    await app.setViewportSize({ width: 375, height: 812 });
    await app.locator("#burgerBtn").click();
    await goToSettings(app);
    const card = app.locator("#view-settings .set-provider");
    await expect(card).toBeVisible();
    const sizes = await card.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      scrollWidth: el.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width + 1);
    expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
  });
});
