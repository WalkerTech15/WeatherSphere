/* The compact forecast timeline in the map's bottom-left card:
 *   Maintenant · +3 h · +6 h · +12 h · +24 h
 *   Affichage : <date and time>
 *   <metric> (<unit>) and its colour legend.
 *
 * What is checked here, against the real @maptiler/weather layers and the
 * mocked forecast:
 *  - the hours reach the layer, for every layer that has a forecast time;
 *  - an hour the provider's forecast does not reach is disabled, not faked;
 *  - Humidity reads the place's own hourly forecast (no second request);
 *  - the layers with NO forecast time (Air quality, Alerts, Lightning) show no
 *    timeline at all;
 *  - rapid clicks, loading, unavailable and failing states;
 *  - English and French, keyboard, reduced motion;
 *  - the card stays compact and inside the map at every width. */
import { test, expect, installMocks } from "./mocks.js";

/* Real WebGL layers per test — one after another in one worker, like
   map-weather-overlay.spec.js, so Chromium's WebGL context cap is never hit. */
test.describe.configure({ mode: "default", timeout: 90_000 });

const LAYER_TIMEOUT = 20000;
/* keyframes -3 h … +30 h: every offered hour, +12 h and +24 h included, is
   inside the provider's forecast */
const LONG_FORECAST = [-3, 0, 3, 6, 9, 12, 24, 30];
const HOURS = [0, 3, 6, 12, 24];

async function openMap(page, overrides = {}, hash = "/#/map") {
  await installMocks(page, overrides);
  await page.goto(hash);
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: LAYER_TIMEOUT });
}

async function chooseLayer(page, layer) {
  const button = page.locator(`.map-layer[data-map-layer="${layer}"]`);
  await button.click();
  await expect(button).toHaveClass(/is-active/, { timeout: LAYER_TIMEOUT });
}

const controls = (page) => page.locator("#mapWeatherControls");
const time = (page, hours) => page.locator(`.map-time[data-map-time="${hours}"]`);
const status = (page) => page.locator("#mapWeatherControls .map-time-status");
const checkedHour = (page) => page.locator('.map-time[aria-checked="true"]');
const humidityValue = (page) => page.locator("#mapWeatherControls .map-aqi-value");
const docOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function chooseHour(page, hours) {
  await time(page, hours).click();
  await expect(time(page, hours)).toHaveAttribute("aria-checked", "true");
}

test.describe("the five hours on the ramp layers", () => {
  for (const layer of ["temperature", "rain", "wind", "pressure"]) {
    test(`${layer}: every hour reaches the layer and names its own time`, async ({ page }) => {
      await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
      await chooseLayer(page, layer);
      await expect(controls(page)).toBeVisible();
      await expect(page.locator(".map-time:not(.map-anim)")).toHaveCount(5);

      const seen = new Set();
      for (const hours of HOURS) {
        await chooseHour(page, hours);
        await expect(status(page)).toContainText("Affichage", { timeout: LAYER_TIMEOUT });
        seen.add(await status(page).textContent());
        await expect(time(page, hours)).not.toBeDisabled();
      }
      /* five different moments, not the same picture five times */
      expect(seen.size).toBe(5);
      await expect(page.locator(".map-legend")).toHaveAttribute("data-legend", layer);
    });
  }

  test("an hour beyond the provider's forecast is disabled, never faked", async ({ page }) => {
    /* the default mock forecast ends at +9 h */
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(status(page)).toContainText("Affichage", { timeout: LAYER_TIMEOUT });

    for (const hours of [0, 3, 6]) await expect(time(page, hours)).toBeEnabled();
    for (const hours of [12, 24]) {
      await expect(time(page, hours)).toBeDisabled();
      await expect(time(page, hours)).toHaveAttribute("aria-checked", "false");
    }

    /* arrow keys skip what cannot be chosen */
    await time(page, 6).focus();
    await page.keyboard.press("ArrowRight");
    await expect(time(page, 0)).toBeFocused();
    await expect(time(page, 0)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("End");
    await expect(time(page, 6)).toBeFocused();
  });

  test("keyboard: arrows, Home and End walk all five hours, focus following the choice", async ({
    page,
  }) => {
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    await chooseLayer(page, "wind");
    await expect(status(page)).toContainText("Affichage", { timeout: LAYER_TIMEOUT });

    await time(page, 0).focus();
    for (const hours of [3, 6, 12, 24]) {
      await page.keyboard.press("ArrowRight");
      await expect(time(page, hours)).toBeFocused();
      await expect(time(page, hours)).toHaveAttribute("aria-checked", "true");
    }
    await page.keyboard.press("ArrowRight"); /* wraps */
    await expect(time(page, 0)).toBeFocused();
    await page.keyboard.press("End");
    await expect(time(page, 24)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(time(page, 0)).toBeFocused();

    /* one Tab stop for the group: only the chosen hour is tabbable */
    await expect(page.locator('.map-time:not(.map-anim)[tabindex="0"]')).toHaveCount(1);
    await expect(time(page, 0)).toHaveAttribute("tabindex", "0");
  });

  test("rapid clicking on hours and layers settles on the last choice", async ({ page }) => {
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    /* Real clicks, not forced ones: the card is rebuilt on every change and
       the page scrolls between the switcher and the timeline, so Playwright
       must wait for the button to be stable and unobscured (a forced click can
       land on the sticky header or on a legend that has just moved). */
    const click = (selector) => page.locator(selector).click();
    await chooseLayer(page, "temperature");

    for (const hours of [3, 24, 12, 6, 24, 3, 12])
      await click(`.map-time[data-map-time="${hours}"]`);
    await click('.map-layer[data-map-layer="rain"]');
    await click('.map-layer[data-map-layer="wind"]');
    await click('.map-time[data-map-time="24"]');
    await click('.map-time[data-map-time="6"]');

    await expect(page.locator('.map-layer[data-map-layer="wind"]')).toHaveClass(/is-active/, {
      timeout: LAYER_TIMEOUT,
    });
    await expect(checkedHour(page)).toHaveCount(1);
    await expect(time(page, 6)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".map-layer.is-active")).toHaveCount(1);
    await expect(page.locator(".map-layer.is-loading")).toHaveCount(0);
    await expect(page.locator(".map-legend")).toHaveCount(1);
    await expect(page.locator(".map-time-status[data-loading]")).toHaveCount(0);
    await expect(status(page)).toContainText("Affichage");
  });

  test("the legend names the metric and its unit beside the timeline", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    const title = page.locator(".map-legend-title");
    await expect(title).toBeVisible({ timeout: LAYER_TIMEOUT });
    await expect(title).toHaveText(/^Température \(.+\)$/);
    await expect(page.locator(".map-legend-ticks li").first()).toBeVisible();
    /* timeline first, legend after it, in the one card */
    const order = await controls(page).evaluate((host) =>
      [...host.children].map((child) => child.className.split(" ")[0]),
    );
    expect(order.indexOf("map-time-row")).toBeLessThan(order.indexOf("map-time-status"));
    expect(order.indexOf("map-time-status")).toBeLessThan(order.indexOf("map-legend"));
  });
});

test.describe("Humidity reads the place's own hourly forecast", () => {
  test("each hour shows that hour's real humidity, with the same five options", async ({
    page,
  }) => {
    await openMap(page, { weatherKind: "humidityRamp" });
    await chooseLayer(page, "humidity");
    await expect(page.locator(".map-time:not(.map-anim)")).toHaveCount(5);
    await expect(time(page, 0)).toHaveAttribute("aria-checked", "true");
    await expect(humidityValue(page)).toHaveText("30%");
    await expect(status(page)).toContainText("Affichage");

    /* 30 % now, +1 point per hour in the mocked forecast */
    for (const [hours, value] of [
      [3, "33%"],
      [6, "36%"],
      [12, "42%"],
      [24, "54%"],
      [0, "30%"],
    ]) {
      await chooseHour(page, hours);
      await expect(humidityValue(page)).toHaveText(value);
    }
  });

  test("choosing an hour makes no request of its own: the forecast is already fetched", async ({
    page,
  }) => {
    const forecastRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("api.open-meteo.com")) forecastRequests.push(request.url());
    });
    await openMap(page, { weatherKind: "humidityRamp" });
    await chooseLayer(page, "humidity");
    await expect(humidityValue(page)).toHaveText("30%");
    await page.waitForTimeout(500);
    const before = forecastRequests.length;
    for (const hours of [3, 12, 24, 6, 0]) await chooseHour(page, hours);
    await page.waitForTimeout(500);
    expect(forecastRequests.length).toBe(before);
  });

  test("keeps the chosen hour when the user changes place, and never mixes places up", async ({
    page,
  }) => {
    await openMap(page, { weatherKind: "humidityRamp" });
    await chooseLayer(page, "humidity");
    await chooseHour(page, 12);
    await expect(humidityValue(page)).toHaveText("42%");

    /* several places chosen in quick succession */
    const places = page.locator("#mapPopular .map-popular-place");
    const count = Math.min(await places.count(), 4);
    for (let index = 0; index < count; index++) await places.nth(index).click({ force: true });

    await expect(time(page, 12)).toHaveAttribute("aria-checked", "true");
    await expect(humidityValue(page)).toHaveText("42%", { timeout: LAYER_TIMEOUT });
    await expect(checkedHour(page)).toHaveCount(1);
    await expect(page.locator("#mapWeatherControls .map-aqi-status[data-loading]")).toHaveCount(0);
  });

  test("a failed forecast is reported in words, with no invented reading", async ({ page }) => {
    await openMap(page, { weatherStatus: 500 });
    await chooseLayer(page, "humidity");
    await expect(
      page.locator("#mapWeatherControls .map-aqi-status[data-state='error']"),
    ).toBeVisible({ timeout: LAYER_TIMEOUT });
    /* no number is invented, and there is no dash-filled or fake reading */
    await expect(humidityValue(page)).toHaveCount(0);
    await expect(page.locator(".map-time:not(.map-anim)")).toHaveCount(5);
    /* with no forecast at any hour there is nothing to switch to: the chosen
       hour stays selected and enabled, the others are disabled, not faked */
    await expect(time(page, 0)).toBeEnabled();
    await expect(time(page, 0)).toHaveAttribute("aria-checked", "true");
    for (const hours of [3, 6, 12, 24]) await expect(time(page, hours)).toBeDisabled();
    await expect(controls(page)).toBeVisible();
  });

  test("the reading is announced with the hour it is for", async ({ page }) => {
    await openMap(page, { weatherKind: "humidityRamp" });
    await chooseLayer(page, "humidity");
    await chooseHour(page, 6);
    await expect(page.locator("#mapLayerStatus")).toContainText(/Humidité, 36%.*Affichage/);
  });
});

test.describe("layers that have no forecast hour of their own", () => {
  for (const layer of ["airQuality", "alerts", "lightning"]) {
    test(`${layer} shows no timeline, at any hour`, async ({ page }) => {
      await openMap(page);
      await chooseLayer(page, "temperature");
      await chooseHour(page, 3);
      await chooseLayer(page, layer);
      await expect(page.locator(".map-time")).toHaveCount(0);
      await expect(page.locator(".map-time-row")).toHaveCount(0);
    });
  }

  test("satellite keeps its own imagery, with no timeline", async ({ page }) => {
    await openMap(page);
    await expect(controls(page)).toBeHidden();
    await expect(page.locator(".map-time")).toHaveCount(0);
  });

  test("a shared link's t= is dropped for them, and kept for Humidity", async ({ page }) => {
    await openMap(page, { weatherKind: "humidityRamp" }, "/#/map?layer=airQuality&t=12");
    await expect(page.locator(".map-time")).toHaveCount(0);
    await page.goto("/#/map?layer=humidity&t=24");
    await expect(time(page, 24)).toHaveAttribute("aria-checked", "true", {
      timeout: LAYER_TIMEOUT,
    });
    await expect(humidityValue(page)).toHaveText("54%");
  });
});

test.describe("the hour in the shared link", () => {
  /* Restoring a weather layer is a full rebuild (map readiness, manifest, tile
     pyramid, GPU upload), so it gets the longer allowance map-url.spec.js uses. */
  const RESTORE_TIMEOUT = 35000;

  test("a link with t=12 opens on +12 h, and the URL follows the timeline", async ({ page }) => {
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    await page.goto("/#/map?layer=temperature&t=12");
    await expect(time(page, 12)).toHaveAttribute("aria-checked", "true", {
      timeout: RESTORE_TIMEOUT,
    });
    await chooseHour(page, 24);
    await expect.poll(() => page.url()).toContain("t=24");
    await chooseHour(page, 0);
    await expect.poll(() => page.url()).not.toContain("t=");
  });

  test("reloading restores +24 h", async ({ page }) => {
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    await chooseLayer(page, "rain");
    await chooseHour(page, 24);
    await expect.poll(() => page.url()).toContain("t=24");
    await page.reload();
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: LAYER_TIMEOUT });
    await expect(time(page, 24)).toHaveAttribute("aria-checked", "true", {
      timeout: RESTORE_TIMEOUT,
    });
  });

  test("an hour that is not offered falls back to now", async ({ page }) => {
    await openMap(page);
    await page.goto("/#/map?layer=temperature&t=18");
    await expect(time(page, 0)).toHaveAttribute("aria-checked", "true", {
      timeout: RESTORE_TIMEOUT,
    });
  });
});

test.describe("loading and failing states, inside the same card", () => {
  test("says it is loading while the weather source is slow, then shows the time", async ({
    page,
  }) => {
    await openMap(page, { weatherManifestDelayMs: 2500 });
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator(".map-time-status[data-loading]")).toBeVisible();
    await expect(status(page)).toContainText("Mise à jour");
    /* the card is already there, timeline included, while it waits */
    await expect(page.locator(".map-time:not(.map-anim)")).toHaveCount(5);
    await expect(status(page)).toContainText("Affichage", { timeout: LAYER_TIMEOUT });
    await expect(page.locator(".map-time-status[data-loading]")).toHaveCount(0);
  });

  test("a weather source that fails leaves a clear message, not a stuck spinner", async ({
    page,
  }) => {
    await openMap(page, { weatherManifestStatus: 500 });
    await page.locator('.map-layer[data-map-layer="temperature"]').click();
    /* either the card explains itself or the layer falls back to the basemap
       with a toast — never an endless "loading" */
    await expect
      .poll(
        async () => {
          const spinning = await page.locator(".map-time-status[data-loading]").count();
          const loadingButton = await page.locator(".map-layer.is-loading").count();
          return spinning + loadingButton;
        },
        { timeout: 30_000 },
      )
      .toBe(0);
    const card = controls(page);
    if (await card.isVisible()) {
      await expect(status(page)).toContainText(/indisponible|n'a pas pu/i);
    }
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("English and French", () => {
  test("French labels by default", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(page.locator(".map-time:not(.map-anim)")).toHaveText([
      "Maintenant",
      "+3 h",
      "+6 h",
      "+12 h",
      "+24 h",
    ]);
    await expect(page.locator(".map-time-row")).toHaveAttribute("aria-label", "Heure de prévision");
    await expect(status(page)).toContainText("Affichage :", { timeout: LAYER_TIMEOUT });
  });

  test("English labels when the language is English", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ws_lang", "en"));
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(page.locator(".map-time:not(.map-anim)")).toHaveText([
      "Now",
      "+3 h",
      "+6 h",
      "+12 h",
      "+24 h",
    ]);
    await expect(page.locator(".map-time-row")).toHaveAttribute("aria-label", "Forecast time");
    await expect(status(page)).toContainText("Showing", { timeout: LAYER_TIMEOUT });
  });

  test("Humidity is translated the same way", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ws_lang", "en"));
    await openMap(page, { weatherKind: "humidityRamp" });
    await chooseLayer(page, "humidity");
    await expect(page.locator(".map-time:not(.map-anim)").first()).toHaveText("Now");
    await expect(status(page)).toContainText("Showing");
  });
});

test.describe("reduced motion", () => {
  test("the timeline still works, and the buttons do not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    await chooseLayer(page, "temperature");
    await chooseHour(page, 12);
    await chooseHour(page, 24);
    const duration = await time(page, 24).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.05);
    /* no replay is offered for a layer that has none to play */
    await expect(page.locator(".map-anim")).toHaveCount(0);
  });
});

test.describe("compact, inside the map's bottom-left card, at every width", () => {
  const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440];

  for (const width of WIDTHS) {
    test(`${width}px: one row, inside the card, nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
      await chooseLayer(page, "temperature");
      await expect(page.locator(".map-legend")).toBeVisible({ timeout: LAYER_TIMEOUT });

      const geometry = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const controlsBox = box("#mapWeatherControls");
        const card = box("#mapCard");
        const row = document.querySelector(".map-time-row");
        const buttons = [...document.querySelectorAll(".map-time:not(.map-anim)")].map((b) =>
          b.getBoundingClientRect(),
        );
        const switcher = box(".map-layer-switcher");
        const panel = document.querySelector("#mapWeatherPanel");
        const panelBox =
          panel && !panel.hidden && getComputedStyle(panel).position === "absolute"
            ? panel.getBoundingClientRect()
            : null;
        const overlaps = (a, b) =>
          Boolean(a && b) &&
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        return {
          insideCard:
            controlsBox.left >= card.left - 1 &&
            controlsBox.right <= card.right + 1 &&
            controlsBox.top >= card.top - 1,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          oneRow: new Set(buttons.map((b) => Math.round(b.top))).size === 1,
          minHeight: Math.min(...buttons.map((b) => b.height)),
          hostWidth: Math.round(controlsBox.width),
          rowFits: row.scrollWidth <= row.clientWidth + 1,
          overSwitcher: overlaps(controlsBox, switcher),
          overPanel: overlaps(controlsBox, panelBox),
          hostHeight: Math.round(controlsBox.height),
        };
      });

      expect(geometry.docOverflow).toBeLessThanOrEqual(0);
      expect(geometry.insideCard).toBe(true);
      expect(geometry.oneRow).toBe(true);
      expect(geometry.overSwitcher).toBe(false);
      expect(geometry.overPanel).toBe(false);
      expect(geometry.minHeight).toBeGreaterThanOrEqual(32);
      /* compact: never a big panel */
      expect(geometry.hostHeight).toBeLessThan(220);
      if (width >= 1024) {
        expect(geometry.rowFits, "all five options fit without scrolling").toBe(true);
        expect(geometry.hostWidth).toBeLessThanOrEqual(350);
      }
    });
  }

  test("320px: the last hour can still be reached and shown in full", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    await chooseLayer(page, "temperature");
    await time(page, 0).focus();
    await page.keyboard.press("End");
    await expect(time(page, 24)).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const row = document.querySelector(".map-time-row").getBoundingClientRect();
          const last = document
            .querySelector('.map-time[data-map-time="24"]')
            .getBoundingClientRect();
          return last.left >= row.left - 1 && last.right <= row.right + 1;
        }),
      )
      .toBe(true);
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("a focused hour keeps a visible focus ring inside the scrolling row", async ({ page }) => {
    await openMap(page, { weatherKeyframeHours: LONG_FORECAST });
    await chooseLayer(page, "temperature");
    await time(page, 3).focus();
    await page.keyboard.press("ArrowRight");
    const ring = await time(page, 6).evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThan(0);
  });

  test("Humidity's card stays as compact as the ramp layers'", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page, { weatherKind: "humidityRamp" });
    await chooseLayer(page, "humidity");
    await expect(humidityValue(page)).toBeVisible();
    const box = await controls(page).boundingBox();
    const card = await page.locator("#mapCard").boundingBox();
    expect(box.width).toBeLessThanOrEqual(350);
    expect(box.height).toBeLessThan(220);
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("no console errors", () => {
  test("choosing every hour on every layer with a forecast time", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(String(error)));

    await openMap(page, { weatherKeyframeHours: LONG_FORECAST, weatherKind: "humidityRamp" });
    for (const layer of ["temperature", "rain", "wind", "pressure", "humidity"]) {
      await chooseLayer(page, layer);
      for (const hours of HOURS) await chooseHour(page, hours);
    }
    await chooseLayer(page, "satellite");
    expect(errors).toEqual([]);
  });
});
