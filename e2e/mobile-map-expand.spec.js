/* Expanded map mode at mobile widths. Runs only in the "mobile" Playwright
 * project (Pixel 5, 393px — under both the 900px drawer breakpoint and the
 * 820px sheet breakpoint).
 *
 * The thing worth guarding here is that the mode does not fight the two
 * behaviours this width already has: the sidebar is a drawer rather than a
 * visible landmark, and the detail panel is a draggable bottom sheet. Neither
 * may be broken by, or lost to, expanding the map. */
import { test, expect } from "./mocks.js";

const expandBtn = (app) => app.locator("#mapExpandBtn");
const exitBtn = (app) => app.locator("#mapExitExpandBtn");
const isExpanded = (app) => app.evaluate(() => document.body.classList.contains("map-expanded"));

async function openMap(app) {
  await app.locator("#burgerBtn").click();
  await app.locator('.side-item[data-view="map"]').click();
  await expect(app.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
}

test.describe("expanded map mode on mobile", () => {
  test("expands without overflowing the viewport horizontally", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const overflowX = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test("the exit control stays on screen and reachable", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const exit = exitBtn(app);
    await expect(exit).toBeVisible();
    const box = await exit.boundingBox();
    const viewport = app.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    /* the same 44px bar the other key mobile controls meet — this is the
       only way out of the mode on touch */
    expect(box.height).toBeGreaterThanOrEqual(44);

    await exit.click();
    await expect.poll(() => isExpanded(app)).toBe(false);
  });

  test("the draggable bottom sheet survives the mode and still snaps", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const sheet = app.locator("#mapWeatherPanel");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-sheet-state", "half");

    /* the handle still cycles it, so the sheet controller is intact and the
       expanded layout has not covered or detached it */
    await app.locator("#mapPanelHandle").click();
    await expect(sheet).toHaveAttribute("data-sheet-state", "expanded");
  });

  test("Escape collapses the sheet first, and only then leaves the mode", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);
    await expect(app.locator("#mapWeatherPanel")).toHaveAttribute("data-sheet-state", "half");

    /* first Escape belongs to the nearer thing — the open sheet */
    await app.keyboard.press("Escape");
    await expect(app.locator("#mapWeatherPanel")).toHaveAttribute("data-sheet-state", "collapsed");
    expect(await isExpanded(app)).toBe(true);

    /* with nothing nearer left open, the next one leaves the mode */
    await app.keyboard.press("Escape");
    await expect.poll(() => isExpanded(app)).toBe(false);
  });

  test("the layer switcher is still usable while expanded", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const switcher = app.locator(".map-layer-switcher");
    await expect(switcher).toBeVisible();
    const box = await switcher.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
  });

  test("the exit control does not cover the layer switcher", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    /* At this width the switcher spans the full width of the map, so the
       top-right corner the exit control takes on desktop is already spoken
       for — putting it there hid Température/Pluie/Vent behind it. */
    const exit = await exitBtn(app).boundingBox();
    const switcher = await app.locator(".map-layer-switcher").boundingBox();
    const overlaps =
      exit.x < switcher.x + switcher.width &&
      exit.x + exit.width > switcher.x &&
      exit.y < switcher.y + switcher.height &&
      exit.y + exit.height > switcher.y;
    expect(overlaps).toBe(false);

    /* and every layer button is genuinely hittable, not just unobscured on
       paper — Playwright refuses a click that lands on another element */
    for (const layer of ["temperature", "rain", "wind"]) {
      await app.locator(`.map-layer[data-map-layer="${layer}"]`).scrollIntoViewIfNeeded();
      await app.locator(`.map-layer[data-map-layer="${layer}"]`).click({ trial: true });
    }
  });

  test("opening the nav drawer from expanded mode still works", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    /* the top navigation is deliberately still there, so its burger must
       still open the drawer over the expanded map */
    await app.locator("#burgerBtn").click();
    await expect(app.locator("#sidebar")).toHaveClass(/is-open/);

    /* and choosing another view leaves the mode behind */
    await app.locator('.side-item[data-view="favorites"]').click();
    await expect.poll(() => isExpanded(app)).toBe(false);
  });
});
