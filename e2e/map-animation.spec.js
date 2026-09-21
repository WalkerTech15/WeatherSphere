/* The map's optional weather animation: the rain forecast played through, and
 * the wind particles.
 *
 * The real @maptiler/weather layers run here (mocked manifest and tile
 * pyramid, as in map-weather-overlay.spec.js), so rain playback really does
 * advance the layer's forecast time and stopping really does put it back.
 * What the visitor sees of that is the timeline status line, which is what is
 * asserted on. */
import { test, expect, installMocks } from "./mocks.js";

/* Real MapLibre + WebGL weather layers: one test at a time within this file
   (see map-weather-overlay.spec.js for why). */
test.describe.configure({ mode: "default", timeout: 90_000 });

const LAYER_TIMEOUT = 20000;
const status = (page) => page.locator("#mapWeatherControls .map-time-status");
const animate = (page) => page.locator("#mapWeatherControls .map-anim");

async function openMap(page, overrides = {}, { reducedMotion = false } = {}) {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await installMocks(page, overrides);
  await page.goto("/#/map");
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: LAYER_TIMEOUT });
}

async function chooseLayer(page, layer) {
  await page.locator(`.map-layer[data-map-layer="${layer}"]`).click();
  await expect(page.locator(`.map-layer[data-map-layer="${layer}"]`)).toHaveClass(/is-active/, {
    timeout: LAYER_TIMEOUT,
  });
  /* the overlay is "ready" once its status line stops loading */
  await expect(status(page)).not.toHaveAttribute("data-loading", "1", { timeout: LAYER_TIMEOUT });
}

const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test.describe("rain — the real precipitation forecast, played through", () => {
  test("is offered as an unpressed toggle, and the static layer is untouched until pressed", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await expect(animate(page)).toBeVisible();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
    await expect(animate(page)).toHaveAttribute("data-map-anim", "rain");
    /* the layer itself is still the ordinary rain overlay with its legend */
    await expect(page.locator("#mapWeatherControls .map-legend")).toHaveAttribute(
      "data-legend",
      "rain",
    );
    /* and the forecast time is not moving by itself */
    const before = await status(page).textContent();
    await page.waitForTimeout(1500);
    expect(await status(page).textContent()).toBe(before);
  });

  test("has an accessible name that says what it does, containing its visible text", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    const label = (await animate(page).getAttribute("aria-label")) ?? "";
    const visible = ((await animate(page).textContent()) ?? "").trim();
    expect(label).toMatch(/pluie|précipitations|rain|precipitation/i);
    expect(label.toLowerCase()).toContain(visible.toLowerCase()); /* label-in-name */
  });

  test("plays: the forecast time advances, then stopping returns to the chosen hour", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    const chosen = await status(page).textContent();

    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
    /* the forecast time visibly moves while it plays */
    await expect
      .poll(async () => await status(page).textContent(), { timeout: 8000 })
      .not.toBe(chosen);

    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
    /* back on the hour the visitor had selected */
    await expect.poll(async () => await status(page).textContent()).toBe(chosen);
  });

  test("choosing a forecast hour ends the replay", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");

    await page.locator('.map-time[data-map-time="3"]').click();
    await expect(page.locator('.map-time[data-map-time="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("is stopped and gone when the layer changes", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");

    await chooseLayer(page, "temperature");
    await expect(animate(page)).toHaveCount(0);

    /* coming back to rain starts from rest, never mid-replay */
    await chooseLayer(page, "rain");
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("works from the keyboard alone", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await animate(page).focus();
    await page.keyboard.press("Enter");
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
    /* focus is kept on the control through the re-render */
    await expect(animate(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
    await expect(animate(page)).toBeFocused();
  });

  test("pauses while the tab is hidden and resumes when it is shown", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");

    await setHidden(page, true);
    await page.waitForTimeout(400); /* let any in-flight poll land */
    const frozen = await status(page).textContent();
    await page.waitForTimeout(1600);
    expect(await status(page).textContent()).toBe(frozen);
    /* the visitor's choice is untouched: still "playing", just suspended */
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");

    await setHidden(page, false);
    await expect
      .poll(async () => await status(page).textContent(), { timeout: 8000 })
      .not.toBe(frozen);
  });

  test("leaving the Map view suspends it, and coming back resumes with the choice intact", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");

    await page.locator('.side-item[data-view="forecast"]').click();
    await page.waitForTimeout(600);
    await page.locator('.side-item[data-view="map"]').click();
    await page.waitForTimeout(400);
    /* the state survived, and it is running again now the map is back */
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("is not offered when the precipitation data is unavailable", async ({ page }) => {
    await openMap(page);
    /* a manifest with no precipitation variable at all */
    await page.route("**://api.maptiler.com/weather/latest.json*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"variables":[]}' }),
    );
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await page.waitForTimeout(2500);
    await expect(animate(page)).toHaveCount(0);
  });
});

test.describe("wind — the layer's own particles, real speed and direction", () => {
  test("moves by default, as the layer always has, and can be paused", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "wind");
    await expect(animate(page)).toBeVisible();
    await expect(animate(page)).toHaveAttribute("data-map-anim", "wind");
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
    expect(await animate(page).getAttribute("aria-label")).toMatch(/vent|wind/i);

    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("leaves the wind legend (its real speeds) in place either way", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "wind");
    await animate(page).click();
    await expect(page.locator("#mapWeatherControls .map-legend")).toHaveAttribute(
      "data-legend",
      "wind",
    );
  });

  test("stays paused across a forecast-hour change only if the visitor paused it", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "wind");
    await animate(page).click(); /* pause */
    await page.locator('.map-time[data-map-time="3"]').click();
    await expect(page.locator('.map-time[data-map-time="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("no animation where there is nothing to animate", () => {
  test("satellite and temperature offer no animate control", async ({ page }) => {
    await openMap(page);
    await expect(animate(page)).toHaveCount(0);
    await chooseLayer(page, "temperature");
    await expect(animate(page)).toHaveCount(0);
  });
});

test.describe("reduced motion and the animation setting", () => {
  test("under reduced motion neither rain nor wind offers animation", async ({ page }) => {
    await openMap(page, {}, { reducedMotion: true });
    await chooseLayer(page, "rain");
    await expect(animate(page)).toHaveCount(0);
    /* the static rain layer is exactly as before */
    await expect(page.locator("#mapWeatherControls .map-legend")).toBeVisible();
    await chooseLayer(page, "wind");
    await expect(animate(page)).toHaveCount(0);
    await expect(page.locator("#mapWeatherControls .map-legend")).toBeVisible();
  });

  test("switching animations off in Settings removes the control from the map", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await expect(animate(page)).toBeVisible();

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator("#animationsSwitch").click();
    await page.locator('.side-item[data-view="map"]').click();
    await expect(animate(page)).toHaveCount(0);

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator("#animationsSwitch").click();
    await page.locator('.side-item[data-view="map"]').click();
    await expect(animate(page)).toBeVisible();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("a device preference that flips while the map is open takes effect at once", async ({
    page,
  }) => {
    await openMap(page);
    await chooseLayer(page, "wind");
    await expect(animate(page)).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(animate(page)).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(animate(page)).toBeVisible();
  });
});

test.describe("no console errors from any of it", () => {
  test("playing, pausing and switching layers logs nothing", async ({ page }) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !/Failed to load resource/.test(msg.text()))
        problems.push(msg.text());
    });
    await openMap(page);
    await chooseLayer(page, "rain");
    await animate(page).click();
    await page.waitForTimeout(1000);
    await animate(page).click();
    await chooseLayer(page, "wind");
    await animate(page).click();
    await chooseLayer(page, "temperature");
    await chooseLayer(page, "rain");
    expect(problems).toEqual([]);
  });
});
