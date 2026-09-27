/* Phone-profile checks for the forecast page's chart and carousel polish. */
import { test, expect } from "./mocks.js";

test.describe("forecast page on a phone", () => {
  test("the day carousel keeps scrolling horizontally without any page overflow", async ({
    app,
  }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="forecast"]').click();

    const row = app.locator("#forecastRow2");
    await expect(row).toHaveCSS("overflow-x", "auto");
    await expect(row.locator(".forecast-card")).toHaveCount(7);

    /* renderForecastPage() runs again once air-quality resolves (see
       features/location.js), rebuilding this row's innerHTML a second time.
       The card count above can already read 7 from that first pass while the
       row is still mid-transition into the forecast view (or about to be
       cleared and refilled by that second pass) — its scrollWidth reads 0 for
       that instant. Under normal load the window is too short to observe;
       under the full serial suite's CPU contention it widens enough to catch.
       Poll for a genuinely laid-out, non-zero row instead of one snapshot. */
    await expect
      .poll(() => app.evaluate(() => document.querySelector("#forecastRow2").scrollWidth))
      .toBeGreaterThan(0);

    const before = await app.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      row: document.querySelector("#forecastRow2").scrollWidth,
    }));
    expect(before.doc).toBeLessThanOrEqual(0);
    const rowBox = await row.boundingBox();
    expect(before.row).toBeGreaterThan(rowBox.width); /* content genuinely overflows */

    await row.evaluate((el) => {
      el.scrollLeft = 200;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(app.locator("#fcFadeLeft")).toHaveClass(/is-visible/);

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("chart axis labels stay readable and unclipped at phone width", async ({ app }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="forecast"]').click();

    const labels = app.locator("#fcChartHost svg text");
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
    const xs = await labels.evaluateAll((els) => els.map((el) => el.getBBox().x));
    xs.forEach((x) => expect(x).toBeGreaterThanOrEqual(0));

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
