/* The Pressure legend's title. It once read "undefined (hPa)" because the
 * layer had a legend but no title key. These tests read the rendered legend
 * itself, in both languages, at phone and desktop widths, and by keyboard. */
import { test, expect, installMocks } from "./mocks.js";

const layer = (page, name) => page.locator(`.map-layer[data-map-layer="${name}"]`);
const legend = (page, name) => page.locator(`.map-legend[data-legend="${name}"]`);

async function openMap(page) {
  await installMocks(page);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  /* below the sidebar breakpoint the map link sits in the off-canvas drawer */
  const burger = page.locator("#burgerBtn");
  if (await burger.isVisible()) await burger.click();
  await page.locator('.side-item[data-view="map"]').click();
  await expect(page.locator("#mapWeatherPanel .map-panel-head")).toBeVisible();
}

async function selectPressure(page) {
  await layer(page, "pressure").scrollIntoViewIfNeeded();
  await layer(page, "pressure").click();
  await expect(layer(page, "pressure")).toHaveAttribute("aria-checked", "true", {
    timeout: 20000,
  });
  await expect(legend(page, "pressure")).toBeVisible({ timeout: 20000 });
}

const title = (page) => legend(page, "pressure").locator(".map-legend-title");

test.describe("Pressure legend title", () => {
  test("French: 'Pression (hPa)', never 'undefined'", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openMap(page);
    await selectPressure(page);
    await expect(title(page)).toHaveText("Pression (hPa)");
    await expect(page.locator("#mapWeatherControls")).not.toContainText("undefined");
    expect(errors).toEqual([]);
  });

  test("English: 'Pressure (hPa)', and the unit stays hPa", async ({ page }) => {
    await openMap(page);
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await selectPressure(page);
    await expect(title(page)).toHaveText("Pressure (hPa)");
    await expect(page.locator("#mapWeatherControls")).not.toContainText("undefined");
    /* the tick labels are hPa values, not converted to another unit */
    const ticks = await legend(page, "pressure").locator(".map-legend-ticks li").allInnerTexts();
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) expect(Number(tick.replace(/\s/g, ""))).toBeGreaterThan(800);
  });

  test("a language switch while the legend is open retitles it", async ({ page }) => {
    await openMap(page);
    await selectPressure(page);
    await expect(title(page)).toHaveText("Pression (hPa)");
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(title(page)).toHaveText("Pressure (hPa)");
  });

  test("screen readers get the scale sentence in hPa, and the layer is a named radio", async ({
    page,
  }) => {
    await openMap(page);
    await selectPressure(page);
    const bar = legend(page, "pressure").locator(".map-legend-bar");
    await expect(bar).toHaveAttribute("role", "img");
    await expect(bar).toHaveAttribute("aria-label", /^Échelle de couleurs de .+ à .+ hPa$/);
    await expect(bar).not.toHaveAttribute("aria-label", /undefined/);
    await expect(layer(page, "pressure")).toHaveAccessibleName(/Pression/);
    await expect(legend(page, "pressure")).toHaveJSProperty("tagName", "FIGURE");
  });

  test("is reachable and selectable from the keyboard", async ({ page }) => {
    await openMap(page);
    await layer(page, "wind").focus();
    await page.keyboard.press("ArrowRight"); /* Clouds is disabled without a key */
    await expect(layer(page, "pressure")).toBeFocused();
    await expect(layer(page, "pressure")).toHaveAttribute("aria-checked", "true", {
      timeout: 20000,
    });
    await expect(title(page)).toHaveText("Pression (hPa)", { timeout: 20000 });
  });

  test("the other legends keep their titles", async ({ page }) => {
    await openMap(page);
    for (const [name, text] of [
      ["temperature", "Température (°C)"],
      ["rain", "Précipitations (mm/h)"],
      ["wind", "Vitesse du vent (km/h)"],
    ]) {
      await layer(page, name).scrollIntoViewIfNeeded();
      await layer(page, name).click();
      await expect(legend(page, name).locator(".map-legend-title")).toHaveText(text, {
        timeout: 20000,
      });
    }
  });
});

test.describe("Pressure legend fits every layout", () => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`${viewport.width}px: the title is whole, on screen and unclipped`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openMap(page);
      await selectPressure(page);
      await expect(title(page)).toHaveText("Pression (hPa)");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await legend(page, "pressure").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
      const clipped = await legend(page, "pressure").evaluate((el) =>
        [el, ...el.querySelectorAll("figcaption, li")]
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.className || node.tagName),
      );
      expect(clipped).toEqual([]);
    });
  }
});
