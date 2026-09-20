/* Degraded-state messaging: demo weather, an unavailable map, an empty
 * Favorites list, and the hover/focus hints.
 *
 * What each state must do is the same three things — say what happened in
 * plain words, stay quiet enough not to be an alarm, and offer the one useful
 * next step — so that is what these assert, in both languages. */
import { test, expect, installMocks } from "./mocks.js";

const SDK_JS = /@maptiler_sdk\.js|maptiler-sdk-[A-Za-z0-9]+\.js/;

/* Fail (or pass through) the live-weather request under test control. Layered
   over installMocks: `fallback()` hands the request to the mock underneath. */
async function steerWeather(page, control) {
  await page.route("**://api.open-meteo.com/**", (route) =>
    control.failing ? route.abort() : route.fallback(),
  );
}

async function openHome(page, { lang, failing = false } = {}) {
  await installMocks(page);
  const control = { failing };
  await steerWeather(page, control);
  if (lang) await page.addInitScript((l) => localStorage.setItem("ws_lang", l), lang);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  return control;
}

const homeNotice = (page) => page.locator("#view-home .wx-notice");

test.describe("demo weather notice", () => {
  test("a healthy load shows no notice at all", async ({ page }) => {
    await openHome(page);
    await expect(homeNotice(page)).toBeEmpty();
    await expect(page.locator("#view-forecast .wx-notice")).toBeEmpty();
  });

  test("when live weather fails, the notice says what the numbers are — and stays", async ({
    page,
  }) => {
    await openHome(page, { lang: "en", failing: true });
    const notice = homeNotice(page).locator(".notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Showing demo weather");
    await expect(notice).toContainText("sample data, not a real forecast");
    /* persistent, unlike the one-minute toast that used to be the only signal */
    await page.waitForTimeout(3500);
    await expect(notice).toBeVisible();
  });

  test("it is a polite status, an amber notice — not an alarm", async ({ page }) => {
    await openHome(page, { failing: true });
    const slot = homeNotice(page);
    await expect(slot).toHaveAttribute("role", "status");
    await expect(slot).toHaveAttribute("aria-live", "polite");
    await expect(slot.locator("[role=alert]")).toHaveCount(0);
    /* reuses the advisory's moderate (amber) tone; red is for real hazards */
    await expect(slot.locator(".notice")).toHaveClass(/adv--moderate/);
    await expect(slot.locator(".notice")).not.toHaveClass(/adv--high/);
    /* the icon is decoration; the words carry the meaning */
    await expect(slot.locator(".adv-icon")).toHaveAttribute("aria-hidden", "true");
  });

  test("the notice follows the interface language", async ({ page }) => {
    await openHome(page, { lang: "fr", failing: true });
    const notice = homeNotice(page).locator(".notice");
    await expect(notice).toContainText("Météo de démonstration affichée");
    await expect(notice.locator("button")).toHaveText("Réessayer");
  });

  test("the same numbers are flagged wherever they appear: Forecast and Map too", async ({
    page,
  }) => {
    await openHome(page, { failing: true });
    await page.locator('.side-item[data-view="forecast"]').click();
    await expect(page.locator("#view-forecast .wx-notice .notice")).toBeVisible();
    await page.locator('.side-item[data-view="map"]').click();
    await expect(page.locator("#view-map .wx-notice .notice")).toBeVisible();
  });

  test("Try again recovers: the notice disappears once live weather loads", async ({ page }) => {
    const control = await openHome(page, { lang: "en", failing: true });
    const retry = homeNotice(page).locator('[data-notice-action="retry-weather"]');
    await expect(retry).toBeVisible();

    control.failing = false;
    await retry.click();
    await expect(homeNotice(page)).toBeEmpty();
    await expect(page.locator("#view-forecast .wx-notice")).toBeEmpty();
  });

  test("Try again that fails again resets the button instead of leaving it stuck", async ({
    page,
  }) => {
    await openHome(page, { lang: "en", failing: true });
    const retry = homeNotice(page).locator('[data-notice-action="retry-weather"]');
    await retry.click();
    /* still failing: the notice comes back with a usable button, not a
       permanently disabled "Retrying…" */
    await expect(retry).toBeEnabled({ timeout: 10000 });
    await expect(retry).toHaveText("Try again");
  });

  test("a new selection clears the previous place's notice while it loads", async ({ page }) => {
    const control = await openHome(page, { failing: true });
    await expect(homeNotice(page).locator(".notice")).toBeVisible();

    control.failing = false;
    await page.locator("#searchInput").fill("Paris");
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText("Paris");
    await expect(homeNotice(page)).toBeEmpty();
  });
});

test.describe("map unavailable", () => {
  test("says the map could not load and offers the forecast, which needs no map", async ({
    page,
  }) => {
    await installMocks(page);
    await page.route(SDK_JS, (route) => route.abort());
    await page.addInitScript(() => localStorage.setItem("ws_lang", "en"));
    await page.goto("/#/map");

    const notice = page.locator("#worldMap .map-offline .notice");
    await expect(notice).toBeVisible({ timeout: 20000 });
    await expect(notice).toContainText("The map couldn't load");
    /* the Map page IS the map, so its failure is announced */
    await expect(notice).toHaveAttribute("role", "alert");
    await notice.locator("button").click();
    await expect(page.locator("#view-forecast")).toBeVisible();
  });

  test("a repaint after the failure does not put a spinner back over the notice", async ({
    page,
  }) => {
    /* Regression. The weather lands AFTER the map has already failed once, so
       renderAllWeather() repaints the map, updateMap() re-adds is-loading, and
       the second failure used to hit mapError's "notice already shown" guard
       and never clear it — the notice sat in the DOM (so "visible" to
       Playwright) with a loading spinner drawn over it. The delay reproduces
       that ordering; with instant mocks the weather always wins the race. */
    await installMocks(page);
    await page.route("**://api.open-meteo.com/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fallback();
    });
    await page.route(SDK_JS, (route) => route.abort());
    await page.goto("/#/map");
    await expect(page.locator("#worldMap .map-offline .notice")).toBeVisible({ timeout: 20000 });
    /* wait out the delayed weather and the repaint it triggers */
    await expect(page.locator("#mapWeatherPanel .map-panel-head")).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    await expect(page.locator("#worldMap .map-offline .notice")).toBeVisible();
    await expect(page.locator("#worldMap")).not.toHaveClass(/is-loading/);
  });

  test("the Home preview fails quietly, as a polite status", async ({ page }) => {
    await installMocks(page);
    await page.route(SDK_JS, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const notice = page.locator("#homeMap .map-offline .notice");
    await expect(notice).toBeVisible({ timeout: 20000 });
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toContainText("La carte n'a pas pu se charger");
  });
});

test.describe("empty Favorites", () => {
  test("explains itself and offers the one thing to do: search", async ({ page }) => {
    await openHome(page, { lang: "en" });
    await page.locator('.side-item[data-view="favorites"]').click();
    const empty = page.locator("#view-favorites .empty-state");
    await expect(empty).toContainText("No favorites yet");
    const action = empty.locator('[data-empty-action="search"]');
    await expect(action).toHaveText("Search for a place");
    await action.click();
    await expect(page.locator("#searchInput")).toBeFocused();
  });

  test("the action is in French too", async ({ page }) => {
    await openHome(page, { lang: "fr" });
    await page.locator('.side-item[data-view="favorites"]').click();
    await expect(page.locator("#view-favorites .empty-action")).toHaveText("Rechercher un lieu");
  });
});

test.describe("hover and focus hints", () => {
  const tipOf = (page, selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => ({
        text: el.dataset.tip,
        content: getComputedStyle(el, "::after").content,
        opacity: getComputedStyle(el, "::after").opacity,
        display: getComputedStyle(el, "::after").display,
      }));

  test("the theme control explains itself on hover, and keeps its own label", async ({ page }) => {
    await openHome(page, { lang: "en" });
    await expect(page.locator("#themeBtn")).toHaveAttribute("aria-label", "Choose theme");
    await page.locator("#themeBtn").hover();
    await expect.poll(async () => (await tipOf(page, "#themeBtn")).opacity).toBe("1");
    const tip = await tipOf(page, "#themeBtn");
    expect(tip.text).toBe("Light, dark, or match your device");
    expect(tip.content).toContain("Light, dark, or match your device");
  });

  test("keyboard focus shows the hint straight away", async ({ page }) => {
    await openHome(page, { lang: "en" });
    await page.locator("#themeBtn").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect.poll(async () => (await tipOf(page, "#themeBtn")).opacity).toBe("1");
  });

  test("hint text follows the language", async ({ page }) => {
    await openHome(page, { lang: "fr" });
    expect((await tipOf(page, "#themeBtn")).text).toBe("Clair, sombre, ou selon votre appareil");
  });

  test("an open theme menu owns the space, so the hint steps aside", async ({ page }) => {
    await openHome(page, { lang: "en" });
    await page.locator("#themeBtn").click();
    await expect(page.locator("#themeBtn")).toHaveAttribute("aria-expanded", "true");
    await page.locator("#themeBtn").hover();
    await page.waitForTimeout(500);
    /* display:none leaves the computed `content` string intact, so the check
       has to be on display, which is what actually removes it from view */
    expect((await tipOf(page, "#themeBtn")).display).toBe("none");
  });

  test("map layers and the expand control carry hints, and every one keeps a visible label", async ({
    page,
  }) => {
    await installMocks(page);
    await page.addInitScript(() => localStorage.setItem("ws_lang", "en"));
    await page.goto("/#/map");
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });

    const layers = {
      satellite: "Satellite imagery, no weather overlay",
      temperature: "Forecast air temperature",
      rain: "Rain and snow forecast",
      wind: "Wind speed and direction",
    };
    for (const [layer, hint] of Object.entries(layers)) {
      const button = page.locator(`.map-layer[data-map-layer="${layer}"]`);
      await expect(button).toHaveAttribute("data-tip", hint);
      /* a hint never stands in for a label */
      expect((await button.innerText()).trim().length).toBeGreaterThan(0);
    }
    const expand = page.locator("#mapExpandBtn");
    await expect(expand).toHaveAttribute("data-tip", /Press Esc/);
    expect((await expand.innerText()).trim()).toBe("Expand map");

    await expand.click();
    await expect(page.locator("#mapExitExpandBtn")).toHaveAttribute("data-tip", /\(Esc\)/);
    expect((await page.locator("#mapExitExpandBtn").innerText()).trim()).toBe("Exit expanded map");
  });

  test("hints never widen the page — not even while hidden", async ({ page }) => {
    /* Regression: the hint was hidden with opacity, but a hidden box still
       counts toward the scrollable width. A 240px hint under a control near the
       edge made the Map page scroll sideways at 900px with nobody hovering. */
    await installMocks(page);
    await page.goto("/#/map");
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
    for (const width of [1440, 1280, 1024, 900, 821]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
    /* and at rest no hint occupies layout at all */
    const display = await page
      .locator("#themeBtn")
      .evaluate((el) => getComputedStyle(el, "::after").display);
    expect(display).toBe("none");
  });

  test("hints are pure decoration for assistive technology: no title, no duplicate name", async ({
    page,
  }) => {
    await openHome(page, { lang: "en" });
    /* data-tip, not title: the browser's own delayed tooltip would double it,
       and a title would be read as an extra description */
    await expect(page.locator("#themeBtn")).not.toHaveAttribute("title", /.+/);
    await expect(page.locator("#themeBtn")).toHaveAttribute("aria-label", "Choose theme");
  });
});
