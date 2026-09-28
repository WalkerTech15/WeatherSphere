/* Settings → Units: the three new independent controls (pressure,
 * precipitation, visibility) added beside the existing temperature and wind
 * controls. See core/units.js (conversion), features/settings.js
 * (setUnitPressure/setUnitPrecip/setUnitVisibility) and the Home metric
 * card / map pressure legend that read them.
 *
 * The one thing every test here has to prove, beyond "the number changes":
 * each of these three is its OWN setting — switching temperature to °F must
 * never silently switch pressure to inHg, precipitation to in/h, or
 * visibility to mi, the way distance and precipitation used to (and
 * distance, deliberately unmentioned here, still does). */
import { test, expect, installMocks } from "./mocks.js";

const goToSettings = (app) => app.locator('.side-item[data-view="settings"]').click();
const goToHome = (app) => app.locator('.side-item[data-view="home"]').click();
const goToMap = (app) => app.locator('.side-item[data-view="map"]').click();
const goToDetailed = (app) => app.locator('#modeToggleSide button[data-mode="detailed"]').click();

const metricValue = (app, key) => app.locator(`.metric-card[data-metric="${key}"] .metric-value`);

test.describe("Settings → Units: pressure, precipitation, visibility", () => {
  test("the Units card offers all five controls, defaulting to their metric unit", async ({
    app,
  }) => {
    await goToSettings(app);
    await expect(app.locator("#chipPressure button")).toHaveCount(2);
    await expect(app.locator("#chipPrecip button")).toHaveCount(2);
    await expect(app.locator("#chipVisibility button")).toHaveCount(2);

    await expect(app.locator('#chipPressure button[data-up="hpa"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipPrecip button[data-upr="mm"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipVisibility button[data-uv="km"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    /* every new control is a real ARIA radio, same as the existing ones */
    for (const group of ["chipPressure", "chipPrecip", "chipVisibility"]) {
      await expect(app.locator(`#${group}`)).toHaveAttribute("role", "radiogroup");
      await expect(app.locator(`#${group} button`).first()).toHaveAttribute("role", "radio");
    }
  });

  test("switching pressure to inHg updates the Home metric card, immediately", async ({ app }) => {
    await goToDetailed(app);
    await goToHome(app);
    await expect(metricValue(app, "pressure")).toContainText("hPa");
    await expect(metricValue(app, "pressure")).toContainText("1014");

    await goToSettings(app);
    await app.locator('#chipPressure button[data-up="inhg"]').click();
    await expect(app.locator('#chipPressure button[data-up="inhg"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await goToHome(app);
    await expect(metricValue(app, "pressure")).toContainText("inHg");
    await expect(metricValue(app, "pressure")).toContainText("29.94"); // 1014 hPa
  });

  test("switching visibility to miles updates the Home metric card, immediately", async ({
    app,
  }) => {
    await goToDetailed(app);
    await goToHome(app);
    await expect(metricValue(app, "visibility")).toContainText("km");
    await expect(metricValue(app, "visibility")).toContainText("20");

    await goToSettings(app);
    await app.locator('#chipVisibility button[data-uv="mi"]').click();
    await goToHome(app);
    await expect(metricValue(app, "visibility")).toContainText("mi");
    await expect(metricValue(app, "visibility")).toContainText("12"); // 20km ≈ 12.4mi
  });

  test("switching the pressure unit updates the map's pressure legend", async ({ app }) => {
    await goToMap(app);
    await app.locator('.map-layer[data-map-layer="pressure"]').click();
    const legend = app.locator('.map-legend[data-legend="pressure"]');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("hPa");

    await goToSettings(app);
    await app.locator('#chipPressure button[data-up="inhg"]').click();
    await goToMap(app);
    await expect(app.locator('.map-legend[data-legend="pressure"]')).toContainText("inHg");
  });

  test("switching the precipitation unit updates the map's rain legend", async ({ app }) => {
    await goToMap(app);
    await app.locator('.map-layer[data-map-layer="rain"]').click();
    const legend = app.locator('.map-legend[data-legend="rain"]');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("mm/h");

    await goToSettings(app);
    await app.locator('#chipPrecip button[data-upr="in"]').click();
    await goToMap(app);
    await expect(app.locator('.map-legend[data-legend="rain"]')).toContainText("in/h");
  });

  test("each new unit is independent — switching temperature or wind never touches the other three", async ({
    app,
  }) => {
    await goToSettings(app);
    await app.locator('#chipTemp button[data-ut="f"]').click();
    await app.locator('#chipWind button[data-uw="mph"]').click();

    await expect(app.locator('#chipPressure button[data-up="hpa"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipPrecip button[data-upr="mm"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipVisibility button[data-uv="km"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await goToDetailed(app);
    await goToHome(app);
    await expect(metricValue(app, "pressure")).toContainText("hPa");
    await expect(metricValue(app, "visibility")).toContainText("km");
  });

  test("settings persist across a reload", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#chipPressure button[data-up="inhg"]').click();
    await app.locator('#chipPrecip button[data-upr="in"]').click();
    await app.locator('#chipVisibility button[data-uv="mi"]').click();

    await app.reload();
    await expect(app.locator("#heroCityName")).not.toBeEmpty();
    await goToSettings(app);

    await expect(app.locator('#chipPressure button[data-up="inhg"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipPrecip button[data-upr="in"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipVisibility button[data-uv="mi"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    /* and the temperature/wind preference from before this task is untouched */
    await expect(app.locator('#chipTemp button[data-ut="c"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the new labels are translated in every interface language", async ({ page }) => {
    const LABELS = {
      fr: ["Pression", "Précipitations", "Visibilité"],
      en: ["Pressure", "Precipitation", "Visibility"],
      es: ["Presión", "Precipitación", "Visibilidad"],
      vi: ["Áp suất", "Lượng mưa", "Tầm nhìn xa"],
    };
    await installMocks(page);
    for (const [lang, [pressure, precip, visibility]] of Object.entries(LABELS)) {
      await page.addInitScript((code) => localStorage.setItem("ws_lang", code), lang);
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      await page.locator('.side-item[data-view="settings"]').click();
      await expect(
        page.locator("#chipPressure").locator("xpath=preceding-sibling::span[1]"),
      ).toHaveText(pressure);
      await expect(
        page.locator("#chipPrecip").locator("xpath=preceding-sibling::span[1]"),
      ).toHaveText(precip);
      await expect(
        page.locator("#chipVisibility").locator("xpath=preceding-sibling::span[1]"),
      ).toHaveText(visibility);
    }
  });

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    test(`${width}px: no overflow or clipping in the Units card`, async ({ page }) => {
      /* set BEFORE navigation, like every other per-width test in this
         suite (e.g. photo-confidence.spec.js) — resizing mid-session while
         a drawer/overlay from the previous width is still open is exactly
         the kind of transitional state this avoids. */
      await page.setViewportSize({ width, height: 800 });
      await installMocks(page);
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();

      /* below the sidebar breakpoint the sidebar is an off-canvas drawer —
         its items stay "visible" by Playwright's own definition (not
         display:none) even while translated out of the viewport, so the
         burger button itself (present only below that breakpoint) is what
         actually signals which layout this is — same convention
         mobile-forecast.spec.js and friends use. */
      const burger = page.locator("#burgerBtn");
      if (await burger.isVisible()) await burger.click();
      await page.locator('.side-item[data-view="settings"]').click();

      const card = page
        .locator("#chipPressure")
        .locator("xpath=ancestor::div[contains(@class,'set-card')][1]");
      await expect(card).toBeVisible();
      const cardBox = await card.boundingBox();
      for (const group of ["#chipPressure", "#chipPrecip", "#chipVisibility"]) {
        const box = await page.locator(group).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("keyboard: every new radio is reachable and toggled with a real click, no console error", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator('.side-item[data-view="settings"]').click();

    const inhg = page.locator('#chipPressure button[data-up="inhg"]');
    await inhg.focus();
    await expect(inhg).toBeFocused();
    await inhg.press("Enter");
    await expect(inhg).toHaveAttribute("aria-checked", "true");

    const inches = page.locator('#chipPrecip button[data-upr="in"]');
    await inches.focus();
    await inches.press("Enter");
    await expect(inches).toHaveAttribute("aria-checked", "true");

    const miles = page.locator('#chipVisibility button[data-uv="mi"]');
    await miles.focus();
    await miles.press("Enter");
    await expect(miles).toHaveAttribute("aria-checked", "true");

    expect(errors).toEqual([]);
  });
});
