/* Accessibility regressions found by auditing every route, in both themes,
 * both languages, Simple and Detailed mode, at desktop and phone widths,
 * with axe-core plus rendered-pixel contrast measurement:
 *   - small text below 4.5:1 across the app, worst in the dark theme (the
 *     active sidebar item was 2.3:1), and the hero title 2.5:1 on a
 *     photo-less clear sky;
 *   - the map-layer radio group had no arrow keys and seven Tab stops;
 *   - Air Quality / Humidity / official-alert results were never announced;
 *   - the map marker was a focusable, Enter-operable button with no role;
 *   - day details used <dt>/<dd> outside any <dl>;
 *   - headings skipped levels (h1 → h3, and an h4 in the alerts panel);
 *   - the Home forecast row scrolled on phones but could not take focus.
 * Everything here asserts the fixed behaviour, so each would fail again if
 * the defect came back. */
import { test, expect, installMocks, nwsAlertFeature, nwsAlertsPayload } from "./mocks.js";

async function boot(
  page,
  { lang = "fr", theme = "light", mode = "simple", width = 1440, mocks } = {},
) {
  await installMocks(page, mocks);
  await page.addInitScript(
    ([l, t, m]) => {
      localStorage.setItem("ws_lang", l);
      localStorage.setItem("ws_theme", t);
      localStorage.setItem("ws_mode", m);
    },
    [lang, theme, mode],
  );
  await page.setViewportSize({ width, height: width < 700 ? 812 : 900 });
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

async function go(page, route) {
  await page.evaluate((r) => (location.hash = `#/${r}`), route);
  await expect(page.locator(`#view-${route}`)).toBeVisible();
}

/* New York (cc US) — inside NWS coverage. The carousel returns to Home. */
async function selectNewYork(page) {
  await go(page, "home");
  await page
    .locator("#exploreCarousel .explore-open")
    .nth(1)
    .evaluate((b) => b.click());
  await expect(page.locator("#heroCityName")).toContainText("New York");
}

const layer = (page, name) => page.locator(`.map-layer[data-map-layer="${name}"]`);
const status = (page) => page.locator("#mapLayerStatus");

test.describe("map layers behave as one radio group", () => {
  /* a disabled <button> still reports tabIndex 0 but can never take focus */
  const tabStops = (page) =>
    page.$$eval(".map-layer:not([disabled])", (els) =>
      els.filter((e) => e.tabIndex === 0).map((e) => e.dataset.mapLayer),
    );

  test("the group is a single Tab stop, on the checked layer", async ({ page }) => {
    await boot(page);
    await go(page, "map");
    expect(await tabStops(page)).toEqual(["satellite"]);
  });

  test("arrow keys move and select, skip the disabled layer, and wrap", async ({ page }) => {
    await boot(page);
    await go(page, "map");
    await layer(page, "satellite").focus();

    await page.keyboard.press("ArrowRight");
    await expect(layer(page, "temperature")).toBeFocused();
    await expect(layer(page, "temperature")).toHaveAttribute("aria-checked", "true", {
      timeout: 20000,
    });

    /* wind → (Clouds is disabled) → pressure */
    await layer(page, "wind").focus();
    await page.keyboard.press("ArrowDown");
    await expect(layer(page, "pressure")).toBeFocused();

    await page.keyboard.press("End");
    await expect(layer(page, "lightning")).toBeFocused(); /* the last layer */
    await page.keyboard.press("ArrowRight");
    await expect(layer(page, "satellite")).toBeFocused(); /* wraps */
    await page.keyboard.press("ArrowLeft");
    await expect(layer(page, "lightning")).toBeFocused(); /* and back */
    await page.keyboard.press("Home");
    await expect(layer(page, "satellite")).toBeFocused();
  });

  test("the single Tab stop follows the selection", async ({ page }) => {
    await boot(page);
    await go(page, "map");
    await layer(page, "humidity").click();
    await expect(layer(page, "humidity")).toHaveAttribute("aria-checked", "true", {
      timeout: 20000,
    });
    expect(await tabStops(page)).toEqual(["humidity"]);
  });

  test("on a phone, the arrows reach every layer in both scrolling rows", async ({ page }) => {
    /* axe flags the row without the checked layer as a scroll region with
       no Tab stop — the expected shape of a roving-tabindex radio group.
       This proves both rows are nonetheless fully keyboard-operable. */
    await boot(page, { width: 375 });
    await go(page, "map");
    const enabled = await page.$$eval(".map-layer:not([disabled])", (els) =>
      els.map((e) => e.dataset.mapLayer),
    );
    await layer(page, enabled[0]).focus();
    for (const name of enabled.slice(1)) {
      await page.keyboard.press("ArrowRight");
      await expect(layer(page, name)).toBeFocused();
      await expect(layer(page, name)).toBeInViewport();
    }
  });
});

test.describe("point-reading layers announce their result", () => {
  test("Air Quality announces the index and its category", async ({ page }) => {
    await boot(page);
    await go(page, "map");
    await expect(status(page)).toHaveAttribute("role", "status");
    await expect(status(page)).toHaveAttribute("aria-live", "polite");
    await layer(page, "airQuality").click();
    await expect(status(page)).toHaveText("Indice de qualité de l'air européen, 34, Bonne", {
      timeout: 20000,
    });
  });

  test("Humidity announces the reading in English", async ({ page }) => {
    await boot(page, { lang: "en", mocks: { weatherKind: "humid" } });
    await go(page, "map");
    await layer(page, "humidity").click();
    await expect(status(page)).toHaveText("Humidity, 92%, Humid", { timeout: 20000 });
  });

  test("an official tornado warning is announced by name", async ({ page }) => {
    await boot(page, { mocks: { nwsBody: nwsAlertsPayload([nwsAlertFeature()]) } });
    await selectNewYork(page);
    await go(page, "map");
    await layer(page, "alerts").click();
    await expect(status(page)).toHaveText("Alerte officielle NWS, Tornado Warning", {
      timeout: 20000,
    });
  });

  test("outside coverage it announces exactly that — never an all-clear", async ({ page }) => {
    await boot(page); /* Paris */
    await go(page, "map");
    await layer(page, "alerts").click();
    await expect(status(page)).toHaveText("Aucune couverture d'alertes officielles pour ce lieu", {
      timeout: 20000,
    });
  });

  test("a failure is announced as a failure", async ({ page }) => {
    await boot(page, { mocks: { nwsStatus: 500 } });
    await selectNewYork(page);
    await go(page, "map");
    await layer(page, "alerts").click();
    await expect(status(page)).toHaveText("Les alertes officielles n'ont pas pu être chargées.", {
      timeout: 20000,
    });
  });

  test("leaving the reading layers clears the region, and returning announces again", async ({
    page,
  }) => {
    await boot(page);
    await go(page, "map");
    await layer(page, "airQuality").click();
    await expect(status(page)).not.toBeEmpty({ timeout: 20000 });
    await layer(page, "satellite").click();
    await expect(status(page)).toBeEmpty();
    await layer(page, "airQuality").click();
    await expect(status(page)).toContainText("34", { timeout: 20000 });
  });
});

test.describe("names, roles and structure", () => {
  test("the map marker is a named button that opens its popup from the keyboard", async ({
    page,
  }) => {
    await boot(page);
    await go(page, "map");
    const marker = page.locator("#worldMap .maplibregl-marker");
    await expect(marker).toHaveAttribute("role", "button", { timeout: 20000 });
    await expect(marker).toHaveAttribute("aria-label", "Repère sur la carte");
    await marker.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".maplibregl-popup")).toBeVisible();
  });

  test("every day-details term and value sits in a description list", async ({ page }) => {
    await boot(page);
    await go(page, "forecast");
    await expect(page.locator(".dd-item dt").first()).toBeVisible();
    const orphans = await page.$$eval(
      ".dd-item dt, .dd-item dd",
      (els) => els.filter((e) => e.parentElement.tagName !== "DL").length,
    );
    expect(orphans).toBe(0);
    /* the rating reads as part of its value: "UV index, 4, High" */
    await expect(page.locator(".dd-item dd .dd-badge").first()).toBeVisible();
  });

  const headingLevels = (page, root) =>
    page.$$eval(`${root} h1, ${root} h2, ${root} h3, ${root} h4, ${root} h5, ${root} h6`, (els) =>
      els.filter((e) => e.getClientRects().length).map((e) => Number(e.tagName[1])),
    );
  const skips = (levels) => levels.filter((l, i) => i > 0 && l > levels[i - 1] + 1);

  test("About never skips a heading level", async ({ page }) => {
    await boot(page);
    await go(page, "about");
    expect(skips(await headingLevels(page, "#view-about"))).toEqual([]);
  });

  test("the empty Favorites page never skips a heading level", async ({ page }) => {
    await boot(page);
    await go(page, "favorites");
    await expect(page.locator("#favGrid .empty-state")).toBeVisible();
    expect(skips(await headingLevels(page, "#view-favorites"))).toEqual([]);
  });

  test("an official alert's title never skips a heading level", async ({ page }) => {
    await boot(page, { mocks: { nwsBody: nwsAlertsPayload([nwsAlertFeature()]) } });
    await selectNewYork(page);
    await go(page, "map");
    await layer(page, "alerts").click();
    await expect(page.locator(".map-alert-event")).toBeVisible({ timeout: 20000 });
    expect(skips(await headingLevels(page, "#view-map"))).toEqual([]);
  });

  test("the Home forecast row can take keyboard focus where it scrolls", async ({ page }) => {
    await boot(page, { width: 375 });
    const row = page.locator("#forecastRow");
    const scrolls = await row.evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(scrolls).toBe(true);
    await expect(row).toHaveAttribute("tabindex", "0");
    await row.focus();
    await expect(row).toBeFocused();
  });
});

test.describe("keyboard focus stays visible", () => {
  for (const theme of ["light", "dark"]) {
    test(`every Tab stop on Home shows a focus indicator (${theme})`, async ({ page }) => {
      await boot(page, { theme });
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      const invisible = [];
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        /* the search pill's ring animates in (transition: box-shadow 0.3s) */
        if ((await page.evaluate(() => document.activeElement?.id)) === "searchInput") {
          await page.waitForTimeout(400);
        }
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const shows = (node) => {
            const cs = getComputedStyle(node);
            return (
              (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
              (cs.boxShadow && cs.boxShadow !== "none")
            );
          };
          /* the search box draws its ring on the whole pill (.search-bar
             :focus-within — a 4px ring) rather than on the bare input */
          const ok =
            el.id === "searchInput"
              ? getComputedStyle(el.closest(".search-bar")).boxShadow.includes("0px 0px 0px 4px")
              : shows(el);
          return { ok, what: el.id || el.className.toString().split(" ")[0] || el.tagName };
        });
        if (info && !info.ok) invisible.push(info.what);
      }
      expect(invisible).toEqual([]);
    });
  }
});

/* Text contrast, measured from the colours actually rendered. */
async function contrastOf(locator) {
  return locator.first().evaluate((el) => {
    /* rgb()/rgba() give 0–255 channels; color-mix() results come back as
       color(srgb r g b) with 0–1 channels */
    const parse = (c) => {
      const n = (c.match(/[\d.]+/g) || []).map(Number);
      return c.startsWith("color(srgb") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3]] : n;
    };
    const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    /* the first opaque background behind the element */
    let bg = null;
    for (let n = el; n && !bg; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.95)) bg = c;
    }
    bg ||= [255, 255, 255];
    const fg = parse(getComputedStyle(el).color);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

test.describe("small text reaches 4.5:1", () => {
  const CASES = [
    ["home", ".footer-note"],
    ["home", '#modeToggle button[data-mode="detailed"]'],
    ["home", "#forecastRow .fc-rain"],
    ["forecast", ".dd-badge"],
    ["forecast", ".sum-row b"],
    ["forecast", ".hour-cell.is-now .h-time"],
    ["settings", '[data-i18n="providerOpenMeteoSub"]'],
    ["about", ".tech-group-title"],
    ["home", ".side-item.is-active"],
    ["home", ".logo-text em"],
  ];
  for (const theme of ["light", "dark"]) {
    test(`previously failing text, ${theme} theme`, async ({ page }) => {
      await boot(page, { theme, width: 1440 });
      for (const [route, selector] of CASES) {
        await go(page, route);
        const el = page.locator(selector);
        if (!(await el.first().isVisible())) continue;
        expect(await contrastOf(el), `${theme} ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("the selected map layer's label stays white on blue in the dark theme", async ({ page }) => {
    await boot(page, { theme: "dark" });
    await go(page, "map");
    expect(await contrastOf(layer(page, "satellite"))).toBeGreaterThanOrEqual(4.5);
  });

  test("the reading and alert badges pass on their own panels", async ({ page }) => {
    await boot(page, { mocks: { nwsBody: nwsAlertsPayload([nwsAlertFeature()]) } });
    await go(page, "map");
    await layer(page, "airQuality").click();
    await expect(page.locator(".map-aqi-badge")).toBeVisible({ timeout: 20000 });
    expect(await contrastOf(page.locator(".map-aqi-badge"))).toBeGreaterThanOrEqual(4.5);

    await selectNewYork(page);
    await go(page, "map");
    await layer(page, "alerts").click();
    await expect(page.locator(".map-alert-badge")).toBeVisible({ timeout: 20000 });
    for (const selector of [".map-alert-badge", ".map-alert-fact dt"]) {
      expect(await contrastOf(page.locator(selector)), selector).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("the hero title stays readable on a photo-less light sky", () => {
  /* The hero draws its sky as a gradient, which contrast tools cannot read,
     so this samples the pixels actually rendered behind the title. */
  for (const sky of ["clear-day", "fog", "snow"]) {
    test(`${sky}: every pixel behind the title clears 3:1 (large text)`, async ({ page }) => {
      await boot(page, { width: 375 });
      await page.route("**/api/pexels**", (r) => r.abort());
      await page.reload();
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      await page.evaluate(
        ([s]) => {
          document.querySelector("#heroBg").dataset.sky = s;
          /* a long name, so the title reaches toward the lighter right side */
          document.querySelector("#heroCityName").firstChild.textContent = "Saint-Jean-de-Luz";
        },
        [sky],
      );
      const box = await page.evaluate(() => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector("#heroCityName"));
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      });
      await page.addStyleTag({
        content: ".hero-inner * { color: transparent !important; text-shadow: none !important; }",
      });
      const png = (await page.screenshot({ clip: box })).toString("base64");
      const worst = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        let max = 0;
        for (let i = 0; i < d.length; i += 4)
          max = Math.max(max, 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
        return 1.05 / (max + 0.05);
      }, png);
      expect(worst).toBeGreaterThanOrEqual(3);
    });
  }
});
