import { test, expect, installMocks, json } from "./mocks.js";

const button = (page) => page.locator('.map-layer[data-map-layer="lightning"]');
const panel = (page) => page.locator("#mapWeatherControls");

/* `lightning` is either a JSON body (200) or a route handler, so a test can
   answer with any status, an HTML page, or a delayed reply. */
async function openMap(page, lightning) {
  await installMocks(page);
  await page.route("**/api/xweather-lightning**", (route) =>
    typeof lightning === "function" ? lightning(route) : route.fulfill(json(lightning)),
  );
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  /* below the sidebar breakpoint, the map link sits in the off-canvas drawer
     (present, "visible", but translated off screen) behind the burger menu */
  const burger = page.locator("#burgerBtn");
  if (await burger.isVisible()) await burger.click();
  await page.locator('.side-item[data-view="map"]').click();
  await expect(page.locator("#mapWeatherPanel .map-panel-head")).toBeVisible();
}

const STRIKES = {
  provider: "Xweather",
  source: "https://www.xweather.com/docs/weather-api/endpoints/lightning",
  radiusKm: 40,
  strikes: [
    { lat: 48.8566, lon: 2.3522, type: "cg", amperage: -12000 },
    { lat: 48.86, lon: 2.36, type: "ic", amperage: 4200 },
  ],
};

test.describe("Xweather lightning layer", () => {
  test("shows verified strikes, attribution, and an accessible map control", async ({ page }) => {
    await openMap(page, STRIKES);

    await expect(button(page)).toHaveAttribute("role", "radio");
    await button(page).click();
    await expect(button(page)).toHaveAttribute("aria-checked", "true", { timeout: 15000 });
    await expect(panel(page)).toContainText("Xweather");
    await expect(panel(page)).toContainText("2 observation(s) récente(s)");
    await expect(page.locator("#mapLayerStatus")).toContainText("observation(s) récente(s)");
    /* Xweather's pulse types, named rather than shown as raw codes */
    await expect(panel(page)).toContainText("Nuage-sol");
    await expect(panel(page)).toContainText("Intra-nuage");
  });

  test("distinguishes valid empty data from an API failure, and still credits Xweather", async ({
    page,
  }) => {
    await openMap(page, { provider: "Xweather", strikes: [] });
    await button(page).click();
    await expect(panel(page)).toContainText("Aucune foudre récente", { timeout: 15000 });
    await expect(panel(page)).toContainText("Données de foudre fournies par Xweather");
    await expect(panel(page)).not.toContainText("unavailable");
    await expect(panel(page).locator('[data-state="error"]')).toHaveCount(0);
  });
});

test.describe("every failure is explained, never shown as 'no lightning'", () => {
  const cases = [
    [
      "an HTML page (the old local fallback)",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><body>app</body></html>",
        }),
      "Les données de foudre ont été reçues dans un format inattendu.",
    ],
    [
      "unavailable credentials (503)",
      (route) => route.fulfill({ ...json({ error: "unavailable" }), status: 503 }),
      "Les données de foudre sont indisponibles pour ce lieu.",
    ],
    [
      "a rate limit (429)",
      (route) => route.fulfill({ ...json({ error: "rate_limited" }), status: 429 }),
      "Trop de requêtes de foudre — réessayez dans une minute.",
    ],
    [
      "an upstream timeout (504)",
      (route) => route.fulfill({ ...json({ error: "timeout" }), status: 504 }),
      "Délai dépassé pour la foudre — réessayez dans un instant.",
    ],
    [
      "an upstream error (502)",
      (route) => route.fulfill({ ...json({ error: "upstream_error" }), status: 502 }),
      "Les données de foudre n'ont pas pu être chargées.",
    ],
  ];
  for (const [label, handler, message] of cases) {
    test(label, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await openMap(page, handler);
      await button(page).click();
      await expect(panel(page).locator('[data-state="error"]')).toHaveText(message, {
        timeout: 15000,
      });
      await expect(page.locator("#mapLayerStatus")).toHaveText(message);
      await expect(panel(page)).not.toContainText("Aucune foudre récente");
      expect(errors).toEqual([]);
    });
  }

  test("speaks English after a language switch", async ({ page }) => {
    await openMap(page, (route) =>
      route.fulfill({ ...json({ error: "rate_limited" }), status: 429 }),
    );
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await button(page).click();
    await expect(panel(page)).toContainText(
      "Too many lightning requests — try again in a minute.",
      {
        timeout: 15000,
      },
    );
  });
});

test.describe("keyboard, screen reader and reduced motion", () => {
  test("is reachable and activatable from the keyboard, with a named radio", async ({ page }) => {
    await openMap(page, STRIKES);
    await button(page).focus();
    await expect(button(page)).toBeFocused();
    await expect(button(page)).toHaveAccessibleName(/Foudre/);
    await page.keyboard.press("Enter");
    await expect(button(page)).toHaveAttribute("aria-checked", "true", { timeout: 15000 });
    await expect(panel(page)).toHaveAttribute("role", "group");
    await expect(page.locator("#mapLayerStatus")).toHaveAttribute("aria-live", "polite");
  });

  test("announces loading, and stops the spinner under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await openMap(page, async (route) => {
      await held;
      await route.fulfill(json(STRIKES));
    });
    await button(page).click();
    const loading = panel(page).locator("[data-loading]");
    await expect(loading).toHaveText("Chargement des données récentes de foudre…", {
      timeout: 15000,
    });
    await expect(page.locator("#mapLayerStatus")).toHaveText(
      "Chargement des données récentes de foudre…",
    );
    const animation = await loading.evaluate((el) => getComputedStyle(el, "::after").animationName);
    expect(animation).toBe("none");
    release();
    await expect(panel(page)).toContainText("2 observation(s) récente(s)", { timeout: 15000 });
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
    test(`${viewport.width}px: controls and messages stay on screen and readable`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openMap(page, STRIKES);
      await button(page).scrollIntoViewIfNeeded();
      await button(page).click();
      await expect(panel(page)).toContainText("2 observation(s) récente(s)", { timeout: 15000 });

      /* no page-level horizontal scroll */
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      /* the button is fully inside the viewport once scrolled to */
      const b = await button(page).boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 0.5);

      /* the panel, its credit and every row fit their width — nothing clipped */
      const p = await panel(page).boundingBox();
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + p.width).toBeLessThanOrEqual(viewport.width + 0.5);
      const clipped = await panel(page).evaluate((host) =>
        [host, ...host.querySelectorAll("p, li, span, strong")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.className || el.tagName),
      );
      expect(clipped).toEqual([]);
      await expect(panel(page).locator(".map-lightning-meta")).toBeVisible();
      await expect(panel(page).locator(".map-lightning-meta")).toContainText("Xweather");
    });
  }
});
