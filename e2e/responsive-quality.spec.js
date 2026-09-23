/* Responsive quality across the widths WeatherSphere is used at.
 *
 * Each assertion here guards a real defect found by auditing every route at
 * 320 / 375 / 390 / 768 / 820 / 1024 / 1440 px in both languages:
 *   - the language menu ran 28–44px off the right edge of every phone;
 *   - the map's locate button sat underneath the details panel (desktop) and
 *     the layer switcher (phone) — invisible, but still reachable by Tab;
 *   - metric titles ("Humidité", "Précipitations") ran past their card's
 *     border below 375px, in Simple and Detailed mode alike;
 *   - a dozen controls were drawn below the 44px touch target.
 * The page-wide checks (no sideways scroll, no console errors) are the net
 * that catches anything new. */
import { test, expect, installMocks } from "./mocks.js";

const WIDTHS = [320, 375, 390, 768, 820, 1024, 1440];
const ROUTES = ["home", "map", "forecast", "favorites", "settings", "about"];
const heightFor = (w) => (w < 700 ? 812 : w < 1100 ? 1024 : 900);

async function boot(page, { lang = "fr", mode, width = 1440 } = {}) {
  await installMocks(page);
  await page.addInitScript(
    ([l, m]) => {
      localStorage.setItem("ws_lang", l);
      if (m) localStorage.setItem("ws_mode", m);
    },
    [lang, mode],
  );
  await page.setViewportSize({ width, height: heightFor(width) });
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

async function go(page, route) {
  await page.evaluate((r) => (location.hash = `#/${r}`), route);
  await expect(page.locator(`#view-${route}`)).toBeVisible();
}

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* The effective tap target: the element's own box, or the transparent
   ::before / ::after hit area the codebase gives deliberately small
   controls (see utilities/accessibility.css), whichever is larger. */
function tapTarget(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let w = r.width;
    let h = r.height;
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === "none" || ps.position !== "absolute") continue;
      w = Math.max(w, parseFloat(ps.width) || 0);
      h = Math.max(h, parseFloat(ps.height) || 0);
    }
    return { w: Math.round(w), h: Math.round(h) };
  });
}

/* Is the control itself what a tap at its centre would hit? */
const isOnTop = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  });

for (const lang of ["fr", "en"]) {
  test(`no route scrolls sideways or logs an error at any width (${lang})`, async ({ page }) => {
    test.setTimeout(240000);
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await boot(page, { lang });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: heightFor(width) });
      for (const route of ROUTES) {
        await go(page, route);
        expect(await sideways(page), `${width}px #/${route}`).toBeLessThanOrEqual(0);
      }
    }
    expect(errors).toEqual([]);
  });
}

test("turning a phone or tablet sideways never breaks the layout", async ({ page }) => {
  await boot(page, { width: 390 });
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1180, 820],
  ]) {
    await page.setViewportSize({ width, height });
    for (const route of ["home", "map", "forecast"]) {
      await go(page, route);
      expect(await sideways(page), `${width}x${height} #/${route}`).toBeLessThanOrEqual(0);
    }
  }
});

test.describe("menus and dialogs stay inside the screen", () => {
  for (const width of [320, 375, 390]) {
    test(`the language menu fits at ${width}px`, async ({ page }) => {
      await boot(page, { width });
      await page.locator("#langBtn").click();
      const menu = page.locator("#langMenu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      /* and both choices can actually be read and picked */
      await expect(menu.locator('button[data-lang="en"]')).toBeInViewport({ ratio: 1 });
      await expect(menu.locator('button[data-lang="fr"]')).toBeInViewport({ ratio: 1 });
    });
  }

  test("the theme menu fits at 320px", async ({ page }) => {
    await boot(page, { width: 320 });
    await page.locator("#themeBtn").click();
    const menu = page.locator("#themeMenu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });

  test("the reset confirmation dialog fits at 320px", async ({ page }) => {
    await boot(page, { width: 320 });
    await go(page, "settings");
    await page.locator('.priv-tile[data-priv="cache"]').click();
    const dialog = page.locator("#confirmDialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y + box.height).toBeLessThanOrEqual(heightFor(320));
    /* both actions are fully on screen and reachable */
    await expect(page.locator("#confirmDialogConfirm")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#confirmDialogCancel")).toBeInViewport({ ratio: 1 });
    await page.locator("#confirmDialogCancel").click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("map controls", () => {
  const CONTROLS = [
    ["zoom in", "#worldMap .maplibregl-ctrl-zoom-in"],
    ["zoom out", "#worldMap .maplibregl-ctrl-zoom-out"],
    ["reset view", "#worldMap .map-reset-btn"],
    ["locate", "#worldMap .maplibregl-ctrl-geolocate"],
  ];

  for (const width of [1024, 1440]) {
    test(`all four are 44px and none is hidden behind the details panel at ${width}px`, async ({
      page,
    }) => {
      await boot(page, { width });
      await go(page, "map");
      for (const [name, selector] of CONTROLS) {
        const control = page.locator(selector);
        await expect(control, name).toBeVisible({ timeout: 20000 });
        const box = await control.boundingBox();
        expect(Math.round(box.width), `${name} width`).toBe(44);
        expect(Math.round(box.height), `${name} height`).toBe(44);
        /* the locate button used to sit under the panel: visible to the
           DOM, focusable by Tab, but covered on screen. Polled, because the
           controls exist a moment before the map card finishes laying out. */
        await expect.poll(() => isOnTop(control), { message: `${name} is not covered` }).toBe(true);
      }
    });
  }

  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [768, 1024],
    [844, 390],
  ]) {
    test(`all four are reachable on a ${width}x${height} screen once the map is in view`, async ({
      page,
    }) => {
      await boot(page, { width });
      await page.setViewportSize({ width, height });
      await go(page, "map");
      await expect(page.locator(CONTROLS[3][1])).toBeAttached({ timeout: 20000 });
      /* scroll the map's top edge to the top of the screen, as a visitor would */
      await page.evaluate(() => {
        const map = document.querySelector("#worldMap");
        window.scrollBy(0, map.getBoundingClientRect().top - 8);
      });
      for (const [name, selector] of CONTROLS) {
        await expect.poll(() => isOnTop(page.locator(selector)), { message: name }).toBe(true);
      }
    });
  }

  test("the locate button keeps its translated name after moving", async ({ page }) => {
    await boot(page, { width: 1440 });
    await go(page, "map");
    await expect(page.locator(CONTROLS[3][1])).toHaveAttribute(
      "aria-label",
      "Utiliser ma position actuelle",
      { timeout: 20000 },
    );
  });
});

/* The defect was a title running PAST its card's border (up to 22px at
   320px). A title that merely reaches a few px into the card's padding is
   tight but neither clipped nor overlapping, so the border is the line. */
test.describe("metric titles never cross their card's border on narrow phones", () => {
  for (const mode of ["simple", "detailed"]) {
    for (const lang of ["fr", "en"]) {
      test(`${mode} mode, ${lang}`, async ({ page }) => {
        await boot(page, { lang, mode, width: 320 });
        for (const width of [320, 340, 360, 375]) {
          await page.setViewportSize({ width, height: 812 });
          const crossing = await page.evaluate(() => {
            const out = [];
            for (const title of document.querySelectorAll(".metric-label, .mg-title")) {
              const card = title.closest(".metric-card, .metric-group");
              if (!card || !card.getBoundingClientRect().width) continue;
              const range = document.createRange();
              range.selectNodeContents(title);
              const textRight = range.getBoundingClientRect().right;
              const cs = getComputedStyle(card);
              const border = card.getBoundingClientRect().right - parseFloat(cs.borderRightWidth);
              if (textRight > border + 0.5)
                out.push(`${title.textContent.trim()} +${(textRight - border).toFixed(1)}px`);
            }
            return out;
          });
          expect(crossing, `${width}px`).toEqual([]);
        }
      });
    }
  }

  test("at 375px and wider the icon stays beside the title", async ({ page }) => {
    await boot(page, { width: 375 });
    const head = page.locator(".metric-head").first();
    await expect(head).toHaveCSS("flex-direction", "row");
    await page.setViewportSize({ width: 360, height: 812 });
    await expect(head).toHaveCSS("flex-direction", "column");
  });
});

test.describe("touch targets on phone and tablet layouts", () => {
  /* control → the route it lives on */
  const TARGETS = [
    [".footer-col button", "home"],
    ["#favAddBtn", "favorites"],
    ["#favGrid .empty-action", "favorites"],
    ["#compareBlock .compare-chip", "favorites"],
    ["#view-favorites .seg-icons button", "favorites"],
    ["#chipTemp button", "settings"],
    ["#fcTabs button", "forecast"],
    ["#mapFavoriteBtn", "map"],
    ["#mapPanelShare", "map"],
    ["#mapPanelClose", "map"],
    ["#mapRecentsSettings", "map"],
  ];

  for (const width of [320, 390, 820]) {
    test(`every audited control is at least 44x44 at ${width}px`, async ({ page }) => {
      await boot(page, { width });
      for (const [selector, route] of TARGETS) {
        await go(page, route);
        const all = page.locator(selector);
        await expect(all.first(), selector).toBeAttached({ timeout: 20000 });
        const count = await all.count();
        for (let i = 0; i < count; i++) {
          const el = all.nth(i);
          if (!(await el.isVisible())) continue;
          const t = await tapTarget(el);
          expect(t.w, `${selector}[${i}] width`).toBeGreaterThanOrEqual(44);
          expect(t.h, `${selector}[${i}] height`).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }

  test("the map panel's three buttons have 44px targets that never overlap", async ({ page }) => {
    await boot(page, { width: 375 });
    await go(page, "map");
    await expect(page.locator("#mapPanelClose")).toBeVisible({ timeout: 20000 });
    const areas = await page.evaluate(() =>
      ["#mapFavoriteBtn", "#mapPanelShare", "#mapPanelClose"].map((s) => {
        const el = document.querySelector(s);
        const r = el.getBoundingClientRect();
        const w = Math.max(r.width, parseFloat(getComputedStyle(el, "::before").width) || 0);
        const cx = r.left + r.width / 2;
        return { left: cx - w / 2, right: cx + w / 2 };
      }),
    );
    expect(areas[0].right).toBeLessThanOrEqual(areas[1].left + 0.5);
    expect(areas[1].right).toBeLessThanOrEqual(areas[2].left + 0.5);
  });

  test("the whole search bar focuses the search box, not just its text line", async ({ page }) => {
    await boot(page, { width: 1024 });
    const bar = page.locator(".search-bar");
    const box = await bar.boundingBox();
    const input = await page.locator("#searchInput").boundingBox();
    /* the input now spans the bar's full inner height (44px bar, 1px border) */
    expect(input.height).toBeGreaterThanOrEqual(box.height - 2);
    /* a tap near the bar's top edge, above the text line, lands in the box */
    await page.mouse.click(input.x + 40, box.y + 4);
    await expect(page.locator("#searchInput")).toBeFocused();
  });
});

test("a real touch tablet in landscape gets the same 44px targets", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
    baseURL: test.info().project.use.baseURL,
  });
  const page = await context.newPage();
  await installMocks(page);
  await page.goto("/#/favorites");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  for (const selector of ["#favAddBtn", "#compareBlock .compare-chip"]) {
    const t = await tapTarget(page.locator(selector).first());
    expect(t.h, selector).toBeGreaterThanOrEqual(44);
  }
  await context.close();
});
