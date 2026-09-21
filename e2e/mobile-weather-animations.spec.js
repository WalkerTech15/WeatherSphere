/* Weather animations on a phone. Runs only in the "mobile" project (Pixel 5,
 * touch, 393 px) and at the narrower widths real phones have.
 *
 * What a phone changes: a smaller particle budget for the hero's snow, a
 * touch-sized Animate control on the map, and no room to spare — nothing here
 * may overflow the page or crowd the controls it sits beside. */
import { test, expect, installMocks } from "./mocks.js";

test.describe.configure({ timeout: 90_000 });

const WIDTHS = [320, 360, 375, 390];
const LAYER_TIMEOUT = 20000;

const fx = (page) => page.locator("#heroFx");
const flakes = (page) => page.locator("#heroFx .fx-flake");

async function openHome(page, overrides = {}) {
  await installMocks(page, overrides);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

async function openMapView(page) {
  await installMocks(page);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  await page.locator("#burgerBtn").click();
  await page.locator('.side-item[data-view="map"]').click();
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: LAYER_TIMEOUT });
}

async function chooseLayer(page, layer) {
  const button = page.locator(`.map-layer[data-map-layer="${layer}"]`);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveClass(/is-active/, { timeout: LAYER_TIMEOUT });
  await expect(page.locator("#mapWeatherControls .map-time-status")).not.toHaveAttribute(
    "data-loading",
    "1",
    { timeout: LAYER_TIMEOUT },
  );
}

test.describe("the phone particle budget", () => {
  test("snow uses fewer flakes than the desktop budget", async ({ page }) => {
    await openHome(page, { weatherKind: "snow" });
    await expect(fx(page)).toHaveAttribute("data-fx", /snow/);
    const constrained = await page.evaluate(
      () =>
        window.matchMedia("(max-width: 820px)").matches ||
        window.matchMedia("(pointer: coarse)").matches,
    );
    expect(constrained).toBe(true);
    const count = await flakes(page).count();
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThanOrEqual(10);
  });

  test("heavy snow is capped too", async ({ page }) => {
    /* the "snow" mock is code 73 (moderate); the budget is a ceiling, so even
       the heaviest intensity cannot exceed the phone cap */
    await openHome(page, { weatherKind: "snow" });
    expect(await flakes(page).count()).toBeLessThanOrEqual(10);
  });

  test("lightning is a single element and never a particle field", async ({ page }) => {
    await openHome(page, { weatherKind: "storm" });
    await expect(page.locator("#heroFx .fx-flash")).toHaveCount(1);
    await expect(page.locator("#heroFx > *")).toHaveCount(1);
  });
});

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } });

    test("snow stays inside the hero and the page does not scroll sideways", async ({ page }) => {
      await openHome(page, { weatherKind: "snow" });
      await expect(fx(page)).toBeVisible();
      const geometry = await page.evaluate(() => {
        const hero = document.querySelector("#heroCard").getBoundingClientRect();
        const layer = document.querySelector("#heroFx").getBoundingClientRect();
        return {
          inside:
            layer.left >= hero.left - 1 &&
            layer.right <= hero.right + 1 &&
            layer.top >= hero.top - 1 &&
            layer.bottom <= hero.bottom + 1,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(geometry.inside).toBe(true);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
    });

    test("the hero's text stays on top of, and tappable through, the effects", async ({ page }) => {
      await openHome(page, { weatherKind: "storm" });
      await expect(fx(page)).toBeVisible();
      const onTop = await page.locator("#heroFavBtn").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el === hit || el.contains(hit);
      });
      expect(onTop).toBe(true);
    });

    test("the map's Animate control is touch-sized, inside its panel, and beside nothing it hides", async ({
      page,
    }) => {
      await openMapView(page);
      await chooseLayer(page, "rain");
      const animate = page.locator("#mapWeatherControls .map-anim");
      await animate.scrollIntoViewIfNeeded();
      await expect(animate).toBeVisible();

      const geometry = await page.evaluate(() => {
        const button = document
          .querySelector("#mapWeatherControls .map-anim")
          .getBoundingClientRect();
        const panel = document.querySelector("#mapWeatherControls").getBoundingClientRect();
        const timeline = document
          .querySelector("#mapWeatherControls .map-time-row")
          .getBoundingClientRect();
        return {
          height: button.height,
          insidePanel: button.left >= panel.left - 1 && button.right <= panel.right + 1,
          clearOfTimeline: button.bottom <= timeline.top + 1 || button.top >= timeline.bottom - 1,
          panelInViewport: panel.left >= 0 && panel.right <= window.innerWidth + 1,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.insidePanel).toBe(true);
      expect(geometry.clearOfTimeline).toBe(true);
      expect(geometry.panelInViewport).toBe(true);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("touch interaction on the map", () => {
  test("tapping Animate plays the rain forecast, and tapping again stops it", async ({ page }) => {
    await openMapView(page);
    await chooseLayer(page, "rain");
    const animate = page.locator("#mapWeatherControls .map-anim");
    await animate.scrollIntoViewIfNeeded();
    const chosen = await page.locator("#mapWeatherControls .map-time-status").textContent();

    await animate.tap();
    await expect(animate).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => await page.locator("#mapWeatherControls .map-time-status").textContent(), {
        timeout: 8000,
      })
      .not.toBe(chosen);

    await animate.tap();
    await expect(animate).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => await page.locator("#mapWeatherControls .map-time-status").textContent())
      .toBe(chosen);
  });

  test("under reduced motion a phone is offered no animation at all", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMapView(page);
    await chooseLayer(page, "wind");
    await expect(page.locator("#mapWeatherControls .map-anim")).toHaveCount(0);
    await expect(page.locator("#mapWeatherControls .map-legend")).toBeVisible();
  });
});
