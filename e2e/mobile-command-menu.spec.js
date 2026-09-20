/* The command menu and degraded-state notices at phone width (Pixel 5, 393px).
 *
 * The desktop specs cover behaviour; what is worth repeating here is what only
 * a phone can break: the suggestions inside the full-width overlay, tap-target
 * size, no sideways overflow, and hover hints staying out of the way of touch. */
import { test, expect, installMocks, GEOCODE_LABEL } from "./mocks.js";

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("command menu on mobile", () => {
  test("opening the overlay shows the suggestions, and picking one selects it", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await expect(app.locator("#searchResults .search-group-label").first()).toBeVisible();
    await expect(app.locator("#searchResults [role=option]").first()).toBeVisible();
    expect(await noOverflow(app)).toBeLessThanOrEqual(1);

    const before = await app.locator("#heroCityName").innerText();
    await app.locator("#searchResults .search-item").nth(1).tap();
    await expect(app.locator("#searchWrap")).toBeHidden();
    await expect(app.locator("#heroCityName")).not.toHaveText(before);
  });

  test("every suggestion row is a comfortable touch target", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    const rows = app.locator("#searchResults .search-item");
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box.height, `row ${i}`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the searching and failure states fit the overlay, with a retry that is tappable", async ({
    app,
  }) => {
    for (const pattern of [
      "**://api.maptiler.com/geocoding/**",
      "**://geocoding-api.open-meteo.com/**",
    ])
      await app.route(pattern, (route) => route.abort());
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill(GEOCODE_LABEL);
    const status = app.locator("#searchStatus");
    await expect(status).toContainText("La recherche est indisponible");
    expect(await noOverflow(app)).toBeLessThanOrEqual(1);
    const retry = await status.locator("button").boundingBox();
    expect(retry.height).toBeGreaterThanOrEqual(44);
    /* the whole status stays inside the viewport */
    const box = await status.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(app.viewportSize().width + 1);
  });
});

test.describe("notices and hints on mobile", () => {
  test("the demo-weather notice fits a phone and its action is a real tap target", async ({
    page,
  }) => {
    await installMocks(page);
    await page.route("**://api.open-meteo.com/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const notice = page.locator("#view-home .wx-notice .notice");
    await expect(notice).toBeVisible();
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    const box = await notice.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    const action = await notice.locator("button").boundingBox();
    expect(action.height).toBeGreaterThanOrEqual(44);
  });

  test("hover hints do not exist on touch, where they cannot be reached", async ({ app }) => {
    const shown = await app
      .locator("#themeBtn")
      .evaluate((el) => getComputedStyle(el, "::after").content);
    /* no `(hover: hover)`: the rule never applies, so there is nothing to
       get stuck open after a tap */
    expect(["none", "normal"]).toContain(shown);
    /* and the control is still fully named without it */
    await expect(app.locator("#themeBtn")).toHaveAttribute("aria-label", /.+/);
  });
});
