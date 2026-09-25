/* The Clouds layer: OpenWeatherMap clouds_new raster tiles, relayed by the
 * same-origin proxy. The proxy is mocked, so these tests prove what the
 * BROWSER does — enable only when a key exists, ask only the proxy for tiles,
 * credit the provider, explain every failure and draw nothing of its own. */
import { test, expect, installMocks, json, WEATHER_TILE_PNG } from "./mocks.js";

const button = (page) => page.locator('.map-layer[data-map-layer="clouds"]');
const panel = (page) => page.locator("#mapWeatherControls");
const status = (page) => panel(page).locator(".map-clouds-status");

const withKey = (tile) => (route) => {
  const url = new URL(route.request().url());
  if (url.searchParams.get("status")) return route.fulfill(json({ available: true }));
  return tile(route);
};
const png = (route) =>
  route.fulfill({ status: 200, contentType: "image/png", body: WEATHER_TILE_PNG });
const failing = (code, error) => (route) => route.fulfill({ ...json({ error }), status: code });

/* `cloudsProxy` answers both the availability probe and the tiles. */
async function openMap(page, cloudsProxy, { hash = "" } = {}) {
  await installMocks(page, { cloudsProxy });
  await page.goto(`/${hash}`);
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  if (!hash) {
    /* below the sidebar breakpoint the map link sits in the off-canvas drawer */
    const burger = page.locator("#burgerBtn");
    if (await burger.isVisible()) await burger.click();
    await page.locator('.side-item[data-view="map"]').click();
  }
  await expect(page.locator("#mapWeatherPanel .map-panel-head")).toBeVisible();
}

test.describe("availability follows the server's key", () => {
  test("without OPENWEATHER_API_KEY the button stays disabled, says why, and asks for no tile", async ({
    page,
  }) => {
    const tiles = [];
    page.on("request", (request) => {
      if (/openweather-clouds\?z=/.test(request.url())) tiles.push(request.url());
    });
    await openMap(page, undefined); /* the default mock: no key */
    await expect(button(page)).toBeDisabled();
    await expect(button(page)).toHaveAttribute("aria-disabled", "true");
    await expect(button(page).locator(".map-layer-badge")).toHaveText("Indisponible");
    await expect(button(page)).toHaveAttribute("data-tip", /indisponible/i);
    await button(page)
      .click({ force: true })
      .catch(() => {});
    await expect(button(page)).not.toHaveClass(/is-active/);
    await expect(panel(page)).toBeHidden();
    expect(tiles).toEqual([]);
  });

  test("a probe that fails outright (no route, HTML fallback) also leaves it disabled — no fake layer", async ({
    page,
  }) => {
    await openMap(page, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>app</p>" }),
    );
    await expect(button(page)).toBeDisabled();
    await expect(button(page).locator(".map-layer-badge")).toBeVisible();
  });

  test("with a key the button is enabled, unbadged, and named for what it shows", async ({
    page,
  }) => {
    await openMap(page, withKey(png));
    await expect(button(page)).toBeEnabled();
    await expect(button(page)).not.toHaveAttribute("aria-disabled", "true");
    await expect(button(page).locator(".map-layer-badge")).toBeHidden();
    await expect(button(page)).toHaveAttribute("role", "radio");
    await expect(button(page)).toHaveAccessibleName(/Nuages/);
    await expect(button(page)).toHaveAttribute("data-tip", /OpenWeatherMap/);
  });
});

test.describe("the real tile layer", () => {
  test("shows cloud tiles from the proxy only, with the provider credited", async ({ page }) => {
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openMap(page, withKey(png));
    await button(page).click();
    await expect(button(page)).toHaveAttribute("aria-checked", "true", { timeout: 20000 });
    await expect(status(page)).toHaveText("La couverture nuageuse est affichée sur la carte.", {
      timeout: 20000,
    });
    await expect(page.locator("#mapLayerStatus")).toContainText("couverture nuageuse");

    /* tiles come from the same-origin proxy, as z/x/y integers */
    const tiles = requests.filter((url) => /\/api\/openweather-clouds\?z=/.test(url));
    expect(tiles.length).toBeGreaterThan(0);
    for (const url of tiles) {
      expect(new URL(url).searchParams.get("z")).toMatch(/^\d+$/);
      expect(new URL(url).searchParams.get("x")).toMatch(/^\d+$/);
      expect(new URL(url).searchParams.get("y")).toMatch(/^\d+$/);
    }
    /* the browser never talks to OpenWeatherMap itself, and no request carries a key */
    expect(requests.some((url) => /openweathermap\.org\/(map|data)/.test(url))).toBe(false);
    expect(requests.some((url) => /appid=/.test(url))).toBe(false);

    /* attribution: the panel, and the map's own attribution control */
    const link = panel(page).locator(".map-clouds-meta a");
    await expect(panel(page).locator(".map-clouds-meta")).toContainText("Données de nuages ©");
    await expect(link).toHaveText("OpenWeatherMap");
    await expect(link).toHaveAttribute("href", "https://openweathermap.org");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(page.locator("#worldMap .maplibregl-ctrl-attrib-inner")).toContainText(
      "OpenWeatherMap",
    );
    expect(errors).toEqual([]);
  });

  test("speaks English after a language switch", async ({ page }) => {
    await openMap(page, withKey(png));
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await button(page).click();
    await expect(status(page)).toHaveText("Cloud cover is shown on the map.", { timeout: 20000 });
    await expect(panel(page).locator(".map-clouds-meta")).toContainText("Cloud data ©");
  });

  test("leaving the layer removes its panel, its tiles and its credit", async ({ page }) => {
    await openMap(page, withKey(png));
    await button(page).click();
    await expect(status(page)).toContainText("affichée", { timeout: 20000 });
    await page.locator('.map-layer[data-map-layer="satellite"]').click();
    await expect(page.locator('.map-layer[data-map-layer="satellite"]')).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 20000 },
    );
    await expect(panel(page)).toBeHidden();
    /* MapLibre hides the control (rather than emptying it) once no source
       carries a credit — so the credit is no longer on screen */
    await expect(page.locator("#worldMap .maplibregl-ctrl-attrib")).toHaveClass(
      /maplibregl-attrib-empty/,
    );
  });

  test("the other layers still work beside it", async ({ page }) => {
    await openMap(page, withKey(png));
    await button(page).click();
    await expect(status(page)).toContainText("affichée", { timeout: 20000 });
    const rain = page.locator('.map-layer[data-map-layer="rain"]');
    await rain.click();
    await expect(rain).toHaveAttribute("aria-checked", "true", { timeout: 20000 });
    await expect(panel(page).locator(".map-clouds-status")).toHaveCount(0);
    await expect(page.locator(".map-legend")).toBeVisible();
    await expect(button(page)).toHaveAttribute("aria-checked", "false");
  });

  test("a shared #/map?layer=clouds link opens the layer", async ({ page }) => {
    await openMap(page, withKey(png), { hash: "#/map?layer=clouds" });
    await expect(button(page)).toHaveAttribute("aria-checked", "true", { timeout: 25000 });
    await expect(status(page)).toContainText("affichée", { timeout: 25000 });
  });

  test("the same link without a key says the layer is unavailable instead of pretending", async ({
    page,
  }) => {
    await openMap(page, undefined, { hash: "#/map?layer=clouds" });
    await expect(status(page)).toHaveText(
      "La couverture nuageuse est indisponible pour le moment.",
      {
        timeout: 25000,
      },
    );
    await expect(button(page)).toBeDisabled();
  });
});

test.describe("every failure is explained and draws nothing", () => {
  const cases = [
    [
      "a rejected or missing key (503 from the proxy)",
      failing(503, "unavailable"),
      "La couverture nuageuse est indisponible pour le moment.",
    ],
    [
      "a rate limit (429)",
      failing(429, "rate_limited"),
      "Trop de requêtes de nuages — réessayez dans une minute.",
    ],
    [
      "an upstream timeout (504)",
      failing(504, "timeout"),
      "Délai dépassé pour les nuages — resélectionnez la couche pour réessayer.",
    ],
    [
      "an upstream error (502)",
      failing(502, "upstream_error"),
      "La couverture nuageuse n'a pas pu être chargée.",
    ],
  ];
  for (const [label, tile, message] of cases) {
    test(label, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await openMap(page, withKey(tile));
      await button(page).click();
      await expect(panel(page).locator('[data-state="error"]')).toHaveText(message, {
        timeout: 25000,
      });
      await expect(page.locator("#mapLayerStatus")).toHaveText(message);
      await expect(panel(page)).not.toContainText("affichée");
      /* no success message and no credit for data that never arrived */
      await expect(panel(page).locator(".map-clouds-meta")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("a tile that never answers ends in a timeout, not an endless spinner", async ({ page }) => {
    test.setTimeout(60000);
    await openMap(
      page,
      withKey(() => new Promise(() => {})),
    );
    await button(page).click();
    await expect(panel(page).locator("[data-loading]")).toHaveText(
      "Chargement de la couverture nuageuse…",
      { timeout: 20000 },
    );
    await expect(panel(page).locator('[data-state="error"]')).toContainText("Délai dépassé", {
      timeout: 30000,
    });
    await expect(button(page)).not.toHaveClass(/is-loading/);
  });

  test("selecting the layer again retries after a failure", async ({ page }) => {
    let fail = true;
    await openMap(
      page,
      withKey((route) => (fail ? failing(502, "upstream_error")(route) : png(route))),
    );
    await button(page).click();
    await expect(panel(page).locator('[data-state="error"]')).toBeVisible({ timeout: 25000 });
    fail = false;
    await button(page).click();
    await expect(status(page)).toContainText("affichée", { timeout: 25000 });
  });
});

test.describe("keyboard, screen reader and reduced motion", () => {
  test("is reached by the arrow keys from Wind and activates like its neighbours", async ({
    page,
  }) => {
    await openMap(page, withKey(png));
    const wind = page.locator('.map-layer[data-map-layer="wind"]');
    await wind.focus();
    await page.keyboard.press("ArrowRight");
    await expect(button(page)).toBeFocused();
    await expect(button(page)).toHaveAttribute("aria-checked", "true", { timeout: 25000 });
    /* roving tab stop: the checked layer is the group's single Tab stop */
    await expect(button(page)).toHaveAttribute("tabindex", "0");
    await expect(wind).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#mapLayerStatus")).toHaveAttribute("aria-live", "polite");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('.map-layer[data-map-layer="pressure"]')).toBeFocused();
  });

  test("Enter selects it, and the credit link is a keyboard-reachable link", async ({ page }) => {
    await openMap(page, withKey(png));
    await button(page).focus();
    await page.keyboard.press("Enter");
    await expect(status(page)).toContainText("affichée", { timeout: 25000 });
    const link = panel(page).locator(".map-clouds-meta a");
    await link.focus();
    await expect(link).toBeFocused();
  });

  test("announces loading, and stops the spinner under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await openMap(
      page,
      withKey(async (route) => {
        await held;
        await png(route);
      }),
    );
    await button(page).click();
    const loading = panel(page).locator("[data-loading]");
    await expect(loading).toHaveText("Chargement de la couverture nuageuse…", { timeout: 20000 });
    await expect(page.locator("#mapLayerStatus")).toHaveText(
      "Chargement de la couverture nuageuse…",
    );
    const animation = await loading.evaluate((el) => getComputedStyle(el, "::after").animationName);
    expect(animation).toBe("none");
    release();
    await expect(status(page)).toContainText("affichée", { timeout: 25000 });
  });
});

test.describe("fits every layout", () => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`${viewport.width}px: the button, the message and the credit stay on screen`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openMap(page, withKey(png));
      await button(page).scrollIntoViewIfNeeded();
      await button(page).click();
      await expect(status(page)).toContainText("affichée", { timeout: 25000 });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const b = await button(page).boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(b.height).toBeGreaterThanOrEqual(30);

      const p = await panel(page).boundingBox();
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + p.width).toBeLessThanOrEqual(viewport.width + 0.5);
      const clipped = await panel(page).evaluate((host) =>
        [host, ...host.querySelectorAll("p, a")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.className || el.tagName),
      );
      expect(clipped).toEqual([]);
      await expect(panel(page).locator(".map-clouds-meta a")).toBeVisible();
    });
  }
});
