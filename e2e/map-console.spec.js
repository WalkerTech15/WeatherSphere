/* The map must not raise SDK warnings for a feature it never uses.
 *
 * @maptiler/sdk adds a starfield ("space") and an atmosphere ("halo") layer
 * for its globe view. WeatherSphere's map is permanently flat, so neither is
 * ever visible — but left on, the starfield's textures load asynchronously
 * and its first frames log "[CubemapLayer]: Texture is undefined" in
 * development, and a style without globe metadata logs
 * "[extractCustomLayerStyle]: No custom layer metadata …" on every map.
 * Turning both off at construction (features/map.js) is what silences them.
 *
 * Only these two SDK families are asserted on: this is not a "no console
 * output ever" check, so a genuine application error is never masked.
 */
import { test, expect, installMocks } from "./mocks.js";

test.describe.configure({ mode: "default", timeout: 90_000 });

const SDK_GLOBE_WARNING = /\[CubemapLayer\]|\[extractCustomLayerStyle\]|\[RadialGradientLayer\]/;

async function collectWarnings(page, path) {
  const seen = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning" || msg.type() === "error") seen.push(msg.text());
  });
  await installMocks(page);
  await page.goto(path);
  await expect(page.locator("#worldMap canvas, #homeMap canvas").first()).toBeVisible({
    timeout: 20000,
  });
  /* give the SDK's async texture load and first frames time to happen */
  await page.waitForTimeout(1500);
  return seen;
}

test.describe("the flat map stays quiet about the globe", () => {
  test("the Map view raises no starfield or halo warnings", async ({ page }) => {
    const seen = await collectWarnings(page, "/#/map");
    expect(seen.filter((text) => SDK_GLOBE_WARNING.test(text))).toEqual([]);
  });

  test("the Home mini-map raises none either", async ({ page }) => {
    const seen = await collectWarnings(page, "/");
    expect(seen.filter((text) => SDK_GLOBE_WARNING.test(text))).toEqual([]);
  });

  test("and the map still renders", async ({ page }) => {
    await collectWarnings(page, "/#/map");
    const canvas = await page.locator("#worldMap canvas").boundingBox();
    expect(canvas.width).toBeGreaterThan(200);
    expect(canvas.height).toBeGreaterThan(200);
    await expect(page.locator(".map-layer-switcher")).toBeVisible();
  });
});
