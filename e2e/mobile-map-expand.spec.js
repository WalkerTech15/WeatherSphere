/* Expanded map mode at mobile widths. Runs only in the "mobile" Playwright
 * project (Pixel 5, 393px — under both the 900px drawer breakpoint and the
 * 820px sheet breakpoint).
 *
 * The thing worth guarding here is that the mode does not fight the two
 * behaviours this width already has: the sidebar is a drawer rather than a
 * visible landmark, and the detail panel is a draggable bottom sheet. Neither
 * may be broken by, or lost to, expanding the map. */
import { test, expect } from "./mocks.js";

const expandBtn = (app) => app.locator("#mapExpandBtn");
const exitBtn = (app) => app.locator("#mapExitExpandBtn");
const isExpanded = (app) => app.evaluate(() => document.body.classList.contains("map-expanded"));

async function openMap(app) {
  await app.locator("#burgerBtn").click();
  await app.locator('.side-item[data-view="map"]').click();
  await expect(app.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
}

test.describe("expanded map mode on mobile", () => {
  test("expands without overflowing the viewport horizontally", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const overflowX = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test("the exit control stays on screen and reachable", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const exit = exitBtn(app);
    await expect(exit).toBeVisible();
    const box = await exit.boundingBox();
    const viewport = app.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    /* the same 44px bar the other key mobile controls meet — this is the
       only way out of the mode on touch */
    expect(box.height).toBeGreaterThanOrEqual(44);

    await exit.click();
    await expect.poll(() => isExpanded(app)).toBe(false);
  });

  test("the draggable bottom sheet survives the mode and still snaps", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const sheet = app.locator("#mapWeatherPanel");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-sheet-state", "half");

    /* the handle still cycles it, so the sheet controller is intact and the
       expanded layout has not covered or detached it */
    await app.locator("#mapPanelHandle").click();
    await expect(sheet).toHaveAttribute("data-sheet-state", "expanded");
  });

  test("Escape collapses the sheet first, and only then leaves the mode", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);
    await expect(app.locator("#mapWeatherPanel")).toHaveAttribute("data-sheet-state", "half");

    /* first Escape belongs to the nearer thing — the open sheet */
    await app.keyboard.press("Escape");
    await expect(app.locator("#mapWeatherPanel")).toHaveAttribute("data-sheet-state", "collapsed");
    expect(await isExpanded(app)).toBe(true);

    /* with nothing nearer left open, the next one leaves the mode */
    await app.keyboard.press("Escape");
    await expect.poll(() => isExpanded(app)).toBe(false);
  });

  test("the layer switcher is still usable while expanded", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    const switcher = app.locator(".map-layer-switcher");
    await expect(switcher).toBeVisible();
    const box = await switcher.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
  });

  test("the exit control does not cover the layer switcher", async ({ app }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    /* At this width the switcher spans the full width of the map, so the
       top-right corner the exit control takes on desktop is already spoken
       for — putting it there hid Température/Pluie/Vent behind it. */
    const exit = await exitBtn(app).boundingBox();
    const switcher = await app.locator(".map-layer-switcher").boundingBox();
    const overlaps =
      exit.x < switcher.x + switcher.width &&
      exit.x + exit.width > switcher.x &&
      exit.y < switcher.y + switcher.height &&
      exit.y + exit.height > switcher.y;
    expect(overlaps).toBe(false);

    /* and every layer button is genuinely hittable, not just unobscured on
       paper — Playwright refuses a click that lands on another element */
    for (const layer of ["temperature", "rain", "wind"]) {
      await app.locator(`.map-layer[data-map-layer="${layer}"]`).scrollIntoViewIfNeeded();
      await app.locator(`.map-layer[data-map-layer="${layer}"]`).click({ trial: true });
    }
  });

  test("the sidebar and its burger step out while expanded, and come back after", async ({
    app,
  }) => {
    await openMap(app);
    await expandBtn(app).scrollIntoViewIfNeeded();
    await expandBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(true);

    /* The mode is immersive: the burger only ever opened the sidebar, so
       both are gone — not covered, gone, so neither is a hidden tab stop. */
    await expect(app.locator("#burgerBtn")).toBeHidden();
    await expect(app.locator("#sidebar")).toBeHidden();
    /* the logo and search stay in the compact header */
    await expect(app.locator("#logoLink")).toBeVisible();
    await expect(app.locator("#mobileSearchBtn")).toBeVisible();

    /* leaving restores both, and the drawer still works */
    await exitBtn(app).click();
    await expect.poll(() => isExpanded(app)).toBe(false);
    await app.locator("#burgerBtn").click();
    await expect(app.locator("#sidebar")).toHaveClass(/is-open/);
    await app.locator('.side-item[data-view="favorites"]').click();
    await expect(app.locator("#view-favorites")).toBeVisible();
  });
});

/* ── The immersive layout at phone and tablet sizes ─────────────────────────
 *
 * On a phone the bottom edge belongs to the weather sheet, so the timeline
 * and the attribution strip ride on top of whatever the sheet is showing.
 * These measure every floating control against every other at each
 * required size, and follow the sheet through its states. */

const SIZES = [
  [768, 1024],
  [430, 932],
  [390, 844],
  [375, 812],
  [320, 667],
];

/* A place selected (so the sheet is up) and Rain on (so the timeline is up). */
async function openExpandedWithEverything(app) {
  await app.goto("/#/map?c=43.2333,0.0782&z=9");
  await expect(app.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
  await expect(app.locator("#mapWeatherPanel .map-panel-location h2")).toBeVisible({
    timeout: 20000,
  });
  await app.locator('.map-layer[data-map-layer="rain"]').click();
  await expect(app.locator("#mapWeatherControls")).toBeVisible({ timeout: 20000 });
  /* The layer button only reports the new layer once it has finished
     loading; choosing a forecast hour before then supersedes that request and
     leaves the button stale (a pre-existing race in setMapTime, independent
     of this mode). Wait for the real readiness signal first. */
  await expect(app.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
    "aria-checked",
    "true",
    {
      timeout: 20000,
    },
  );
  await expandBtn(app).scrollIntoViewIfNeeded();
  await expandBtn(app).click();
  await expect.poll(() => isExpanded(app)).toBe(true);
  /* the exit control fades in with a 4px slide — measure once it has */
  await exitBtn(app).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

function boxes(app) {
  return app.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || !b.width || !b.height) return null;
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    };
    return {
      header: box(".topnav"),
      exit: box("#mapExitExpandBtn"),
      layers: box(".map-layer-switcher"),
      zoom: box("#worldMap .maplibregl-ctrl-top-left"),
      locate: box("#worldMap .maplibregl-ctrl-geolocate"),
      timeline: box("#mapWeatherControls"),
      sheet: box("#mapWeatherPanel"),
      showPanel: box("#mapShowPanel"),
      attribution: box("#worldMap .maplibregl-ctrl-attrib"),
    };
  });
}

function overlapsOf(b) {
  const found = [];
  const keys = Object.keys(b).filter((k) => b[k]);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const x = Math.min(b[keys[i]].r, b[keys[j]].r) - Math.max(b[keys[i]].l, b[keys[j]].l);
      const y = Math.min(b[keys[i]].b, b[keys[j]].b) - Math.max(b[keys[i]].t, b[keys[j]].t);
      if (x > 1 && y > 1) found.push(`${keys[i]} × ${keys[j]}`);
    }
  }
  return found;
}

test.describe("the immersive layout at phone and tablet sizes", () => {
  for (const [width, height] of SIZES) {
    test(`${width}×${height}: nothing overlaps, clips or overflows`, async ({ app }) => {
      await app.setViewportSize({ width, height });
      await openExpandedWithEverything(app);

      const b = await boxes(app);
      for (const key of ["header", "exit", "layers", "zoom", "locate", "timeline", "sheet"]) {
        expect(b[key], `${key} is rendered`).not.toBeNull();
      }
      expect(overlapsOf(b)).toEqual([]);

      /* the sheet deliberately extends below the screen (it is translated
         down to its snap point); everything else stays fully on it */
      for (const [key, x] of Object.entries(b)) {
        if (!x || key === "sheet") continue;
        expect(x.l, `${key} left`).toBeGreaterThanOrEqual(-1);
        expect(x.t, `${key} top`).toBeGreaterThanOrEqual(-1);
        expect(x.r, `${key} right`).toBeLessThanOrEqual(width + 1);
        expect(x.b, `${key} bottom`).toBeLessThanOrEqual(height + 1);
      }

      /* nothing in the compact header spills outside it (at 320px the
         search button used to overhang the bar toward the exit control) */
      const clipped = await app.evaluate(() => {
        const h = document.querySelector(".topnav").getBoundingClientRect();
        return [...document.querySelectorAll(".topnav button, .topnav a, .topnav input")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width && getComputedStyle(e).display !== "none"
              ? r.left < h.left - 0.5 || r.right > h.right + 0.5
              : false;
          })
          .map((e) => e.id || e.className);
      });
      expect(clipped).toEqual([]);

      const overflowX = await app.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowX).toBeLessThanOrEqual(1);
    });
  }

  test("the timeline rides on top of the sheet through every state", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await openExpandedWithEverything(app);
    const sheet = app.locator("#mapWeatherPanel");
    const timeline = app.locator("#mapWeatherControls");

    /* above the sheet's visible top edge, with the attribution strip between */
    const clearOfSheet = async () => {
      const b = await boxes(app);
      return b.timeline && b.sheet && b.timeline.b <= b.sheet.t - 30;
    };

    await expect(sheet).toHaveAttribute("data-sheet-state", "half");
    await expect.poll(clearOfSheet).toBe(true);

    /* a fully expanded sheet covers the map, so the timeline steps aside
       rather than being pushed up over the layer pill */
    await app.locator("#mapPanelHandle").click();
    await expect(sheet).toHaveAttribute("data-sheet-state", "expanded");
    await expect(timeline).toBeHidden();

    /* and comes back, above the sheet, when it collapses */
    await app.keyboard.press("Escape");
    await expect(sheet).not.toHaveAttribute("data-sheet-state", "expanded");
    await expect(timeline).toBeVisible();
    await expect.poll(clearOfSheet).toBe(true);
    expect(await isExpanded(app)).toBe(true);
  });

  test("the attribution sits above the sheet and nothing covers it", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    /* the default mock style has no attribution, so MapLibre hides its
       control; this later route wins and gives it the real provider text */
    await app.route("**://api.maptiler.com/maps/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 8,
          name: "e2e-attributed",
          sources: {
            labels: {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
              attribution: "© MapTiler © OpenStreetMap contributors",
            },
          },
          layers: [
            { id: "bg", type: "background", paint: { "background-color": "#dbeafe" } },
            { id: "place-labels", type: "symbol", source: "labels" },
          ],
        }),
      }),
    );
    await openExpandedWithEverything(app);

    const attribution = app.locator("#worldMap .maplibregl-ctrl-attrib");
    await expect(attribution).toBeVisible();
    /* the strip follows the sheet's snap, so wait for it to arrive */
    await expect
      .poll(async () => {
        const b = await boxes(app);
        return b.attribution.b <= b.sheet.t + 1 && overlapsOf(b).length === 0;
      })
      .toBe(true);
    const covered = await attribution.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(covered).toBe(false);
  });

  test("every control in the mode is a 44px touch target", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await openExpandedWithEverything(app);
    for (const sel of [
      "#mapExitExpandBtn",
      "#logoLink",
      "#mobileSearchBtn",
      "#worldMap .maplibregl-ctrl-zoom-in",
      "#worldMap .maplibregl-ctrl-zoom-out",
      "#worldMap .map-reset-btn",
      "#worldMap .maplibregl-ctrl-geolocate",
    ]) {
      const b = await app.locator(sel).boundingBox();
      expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(44);
      expect(b.width, `${sel} width`).toBeGreaterThanOrEqual(44);
    }
  });

  test("search still opens from the compact header, on top of the map", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await openExpandedWithEverything(app);

    await app.locator("#mobileSearchBtn").click();
    const input = app.locator("#searchInput");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    const onTop = await input.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop).toBe(true);
  });
});
