/* Expanded map mode: the Map view's card takes over the workspace while the
 * top navigation and sidebar stay put.
 *
 * What these guard is the contract around the mode, not its pixel dimensions:
 * both landmarks survive it, the map keeps its camera/layer/selection, the
 * page cannot overflow, and every route out of the mode (the control, Escape,
 * navigating away) actually restores the normal layout. */
import { test, expect, installMocks, CLICK_CITY } from "./mocks.js";

/* Same reasoning as map-recents.spec.js: these drive a real MapLibre context,
   so they run one at a time within this file rather than fanning out. */
test.describe.configure({ mode: "default", timeout: 90_000 });

const MAP_TIMEOUT = 20000;

const expandBtn = (page) => page.locator("#mapExpandBtn");
const exitBtn = (page) => page.locator("#mapExitExpandBtn");
const isExpanded = (page) => page.evaluate(() => document.body.classList.contains("map-expanded"));

async function openMap(page) {
  await installMocks(page);
  await page.goto("/#/map");
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
}

test.describe("entering and leaving expanded map mode", () => {
  test("the control is labelled, reports its state, and both landmarks survive", async ({
    page,
  }) => {
    await openMap(page);
    await expect(expandBtn(page)).toBeVisible();
    await expect(expandBtn(page)).toHaveAttribute("aria-pressed", "false");

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    /* the whole point of not using the Fullscreen API: the app frame stays */
    await expect(page.locator(".topnav")).toBeVisible();
    await expect(page.locator("#sidebar")).toBeVisible();

    /* the exit control takes over, and carries the state the chip had */
    await expect(exitBtn(page)).toBeVisible();
    await expect(exitBtn(page)).toHaveAttribute("aria-pressed", "true");
    await expect(expandBtn(page)).toBeHidden();
  });

  test("the map grows into the freed space and shrinks back", async ({ page }) => {
    await openMap(page);
    const map = page.locator("#worldMap");
    const before = (await map.boundingBox()).height;

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);
    await expect.poll(async () => (await map.boundingBox()).height).toBeGreaterThan(before);

    /* and the canvas itself re-measured, not just its container — a MapLibre
       canvas left at the old size is the classic bug here */
    const box = await map.boundingBox();
    const canvas = await page.locator("#worldMap canvas").boundingBox();
    expect(Math.abs(canvas.height - box.height)).toBeLessThan(12);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    /* rounded, not exact: a bounding box is a float, and the restored height
       comes back as 600.0000305175781 against a measured 600 often enough to
       make an Object.is comparison here a coin toss. */
    await expect
      .poll(async () => Math.round((await map.boundingBox()).height))
      .toBe(Math.round(before));
  });

  test("Escape leaves the mode and returns focus to the control that opened it", async ({
    page,
  }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(expandBtn(page)).toBeFocused();
  });

  test("the control is operable from the keyboard alone", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(true);
    /* focus followed the control that replaced it, rather than dropping to
       <body> when the chip's row was hidden */
    await expect(exitBtn(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(expandBtn(page)).toBeFocused();
  });

  test("the page cannot scroll or overflow while expanded, and can again after", async ({
    page,
  }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return {
        vertical: el.scrollHeight - el.clientHeight,
        horizontal: el.scrollWidth - el.clientWidth,
      };
    });
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(1);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    /* the page scrolls normally again — the recents/popular cards are back */
    await expect(page.locator("#mapRecents")).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  });
});

test.describe("expanded mode leaves the map itself alone", () => {
  test("camera, active layer and URL all survive a round trip", async ({ page }) => {
    await installMocks(page);
    await page.goto(`/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=9`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });

    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const urlBefore = page.url();

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);
    /* entering the mode is a layout change and nothing else — it must not
       write to the hash the share link is built from */
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the layer switcher and detail panel stay reachable and unclipped", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await expect(page.locator(".map-layer-switcher")).toBeVisible();
    const panel = page.locator("#mapWeatherPanel");
    await expect(panel).toBeVisible();

    /* the panel shares the top-right corner with the exit control, so in
       this mode it starts below it instead of underneath it */
    const exit = await exitBtn(page).boundingBox();
    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(exit.y + exit.height - 1);

    /* and it still fits inside the card rather than spilling past its edge */
    const card = await page.locator("#mapCard").boundingBox();
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(card.y + card.height + 1);
  });
});

test.describe("the mode never outlives the Map view", () => {
  test("navigating away restores the normal layout", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await page.locator('.side-item[data-view="forecast"]').click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    /* the footer and page scrolling belong to every other view too */
    await expect(page.locator(".footer")).toBeVisible();

    /* and coming back does not silently resume it */
    await page.locator('.side-item[data-view="map"]').click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(expandBtn(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("a resize while expanded keeps the mode coherent, not stuck", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await page.setViewportSize({ width: 900, height: 700 });
    await expect.poll(() => isExpanded(page)).toBe(true);
    await expect(exitBtn(page)).toBeVisible();

    /* still no overflow at the new size, and the map re-measured to it */
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(1);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(page.locator("#mapRecents")).toBeVisible();
  });
});
