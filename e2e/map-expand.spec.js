/* Expanded map mode: the map becomes an immersive, viewport-filling layer —
 * the sidebar steps out and the top navigation shrinks into a compact
 * floating bar over the map.
 *
 * What these guard is the contract around the mode: the map keeps its
 * camera/layer/selection, the page cannot overflow, no floating control ever
 * sits on another, and every route out of the mode (the control, Escape,
 * navigating away) actually restores the normal layout. */
import { test, expect, installMocks, json, CLICK_CITY, CLICK_OCEAN } from "./mocks.js";

/* Same reasoning as map-recents.spec.js: these drive a real MapLibre context,
   so they run one at a time within this file rather than fanning out. */
test.describe.configure({ mode: "default", timeout: 90_000 });

const MAP_TIMEOUT = 20000;

const expandBtn = (page) => page.locator("#mapExpandBtn");
const exitBtn = (page) => page.locator("#mapExitExpandBtn");
const isExpanded = (page) => page.evaluate(() => document.body.classList.contains("map-expanded"));

async function openMap(page) {
  await installMocks(page);
  await page.goto("/#/map");
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
}

test.describe("entering and leaving expanded map mode", () => {
  test("the control is labelled, reports its state, and the mode is immersive", async ({
    page,
  }) => {
    await openMap(page);
    await expect(expandBtn(page)).toBeVisible();
    await expect(expandBtn(page)).toHaveAttribute("aria-pressed", "false");

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    /* The map covers the whole viewport, not a card inside the dashboard. */
    const viewport = page.viewportSize();
    const card = await page.locator("#mapCard").boundingBox();
    expect(card).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });

    /* The sidebar leaves — out of the tab order too, not merely covered. */
    await expect(page.locator("#sidebar")).toBeHidden();

    /* The header stays, as a compact floating bar rather than a full-width
       strip: logo and search still there, sitting inset from the edges. */
    const header = page.locator(".topnav");
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS("position", "fixed");
    const bar = await header.boundingBox();
    expect(bar.x).toBeGreaterThan(0);
    expect(bar.y).toBeGreaterThan(0);
    expect(bar.height).toBeLessThanOrEqual(56);
    expect(bar.width).toBeLessThan(viewport.width * 0.75);
    await expect(page.locator("#logoLink")).toBeVisible();
    await expect(page.locator("#searchInput")).toBeVisible();

    /* the exit control takes over, and carries the state the chip had */
    await expect(exitBtn(page)).toBeVisible();
    await expect(exitBtn(page)).toHaveAttribute("aria-pressed", "true");
    await expect(expandBtn(page)).toBeHidden();

    /* and leaving puts the dashboard frame back exactly as it was */
    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(header).toHaveCSS("position", "sticky");
    expect((await header.boundingBox()).width).toBe(viewport.width);
  });

  test("the map grows into the freed space and shrinks back", async ({ page }) => {
    await openMap(page);
    const map = page.locator("#worldMap");
    const before = (await map.boundingBox()).height;

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);
    await expect.poll(async () => (await map.boundingBox()).height).toBeGreaterThan(before);

    /* and the canvas itself re-measured, not just its container — a MapLibre
       canvas left at the old size is the classic bug here */
    const box = await map.boundingBox();
    const canvas = await page.locator("#worldMap canvas").boundingBox();
    expect(Math.abs(canvas.height - box.height)).toBeLessThan(12);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    /* rounded, not exact: a bounding box is a float, and the restored height
       comes back as 600.0000305175781 against a measured 600 often enough to
       make an Object.is comparison here a coin toss. */
    await expect
      .poll(async () => Math.round((await map.boundingBox()).height))
      .toBe(Math.round(before));
  });

  test("Escape leaves the mode and returns focus to the control that opened it", async ({
    page,
  }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(expandBtn(page)).toBeFocused();
  });

  test("the control is operable from the keyboard alone", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(true);
    /* focus followed the control that replaced it, rather than dropping to
       <body> when the chip's row was hidden */
    await expect(exitBtn(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(expandBtn(page)).toBeFocused();
  });

  test("the page cannot scroll or overflow while expanded, and can again after", async ({
    page,
  }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return {
        vertical: el.scrollHeight - el.clientHeight,
        horizontal: el.scrollWidth - el.clientWidth,
      };
    });
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(1);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    /* the page scrolls normally again — the recents/popular cards are back */
    await expect(page.locator("#mapRecents")).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  });
});

test.describe("expanded mode leaves the map itself alone", () => {
  test("camera, active layer and URL all survive a round trip", async ({ page }) => {
    await installMocks(page);
    await page.goto(`/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=9`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });

    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const urlBefore = page.url();

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);
    /* entering the mode is a layout change and nothing else — it must not
       write to the hash the share link is built from */
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the layer switcher and detail panel stay reachable and unclipped", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await expect(page.locator(".map-layer-switcher")).toBeVisible();
    const panel = page.locator("#mapWeatherPanel");
    await expect(panel).toBeVisible();

    /* the panel shares the top-right corner with the exit control, so in
       this mode it starts below it instead of underneath it */
    const exit = await exitBtn(page).boundingBox();
    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(exit.y + exit.height - 1);

    /* and it still fits inside the card rather than spilling past its edge */
    const card = await page.locator("#mapCard").boundingBox();
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(card.y + card.height + 1);
  });
});

test.describe("the mode never outlives the Map view", () => {
  test("navigating away restores the normal layout", async ({ page }) => {
    await openMap(page);
    /* scrolled, so a stale restore of the Map page's offset would show */
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
    await expandBtn(page).evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(true);

    /* The sidebar is gone in this mode, so the way out to another view is the
       logo in the compact header — the route a visitor actually has. */
    await page.locator("#logoLink").click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    /* the footer and page scrolling belong to every other view too */
    await expect(page.locator(".footer")).toBeVisible();
    /* The Map page's scroll offset means nothing on the view just opened, so
       it is deliberately not restored here (only a plain exit restores it). */
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    /* and coming back does not silently resume it */
    await page.locator('.side-item[data-view="map"]').click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(expandBtn(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("a resize while expanded keeps the mode coherent, not stuck", async ({ page }) => {
    await openMap(page);
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    await page.setViewportSize({ width: 900, height: 700 });
    await expect.poll(() => isExpanded(page)).toBe(true);
    await expect(exitBtn(page)).toBeVisible();

    /* still no overflow at the new size, and the map re-measured to it */
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX).toBeLessThanOrEqual(1);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(page.locator("#mapRecents")).toBeVisible();
  });
});

/* ── The immersive layout ───────────────────────────────────────────────────
 *
 * Every floating control is measured against every other at each required
 * desktop size. The overlays live in different containers (the map card, and
 * MapLibre's own control corners), so nothing in the layout engine stops two
 * of them landing on each other — only these measurements do. */

const panelName = (page) => page.locator("#mapWeatherPanel .map-panel-location h2");

/* Opens the map with a place selected (so the drawer is up) and the Rain
   layer on (so the timeline is up), then enters the mode. */
async function openExpandedWithEverything(page, { overrides = {} } = {}) {
  await installMocks(page, overrides);
  await page.goto(`/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=9`);
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
  await expect(panelName(page)).toBeVisible({ timeout: MAP_TIMEOUT });
  await page.locator('.map-layer[data-map-layer="rain"]').click();
  await expect(page.locator("#mapWeatherControls")).toBeVisible({ timeout: MAP_TIMEOUT });
  /* The layer button only reports the new layer once it has finished
     loading; choosing a forecast hour before then supersedes that request and
     leaves the button stale (a pre-existing race in setMapTime, independent
     of this mode). Wait for the real readiness signal first. */
  await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
    "aria-checked",
    "true",
    {
      timeout: MAP_TIMEOUT,
    },
  );
  await expandBtn(page).click();
  await expect.poll(() => isExpanded(page)).toBe(true);
  await settled(page);
}

/* The exit control fades in over 0.2s with a 4px slide, so a box measured
   mid-animation is off by up to 4px. Waiting on the animations themselves
   is a completion signal, not a guess at a duration. */
async function settled(page) {
  await exitBtn(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/* Border boxes of every floating control that is currently rendered. */
function floatingBoxes(page) {
  return page.evaluate(() => {
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
      drawer: box("#mapWeatherPanel"),
      showPanel: box("#mapShowPanel"),
      attribution: box("#worldMap .maplibregl-ctrl-attrib"),
    };
  });
}

function overlapsOf(boxes) {
  const found = [];
  const keys = Object.keys(boxes).filter((k) => boxes[k]);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = boxes[keys[i]];
      const b = boxes[keys[j]];
      const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (x > 1 && y > 1) found.push(`${keys[i]} × ${keys[j]}`);
    }
  }
  return found;
}

/* The real provider style carries an attribution string; the default mock
   style does not, which makes MapLibre hide its control entirely. A later
   route wins in Playwright, so this layers an attributed style on top of
   installMocks' blank one. */
async function withAttributedStyle(page) {
  await page.route("**://api.maptiler.com/maps/**", (route) =>
    route.fulfill(
      json({
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
    ),
  );
}

test.describe("the immersive layout at desktop sizes", () => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
  ]) {
    test(`${width}×${height}: nothing overlaps, overflows or leaves the screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openExpandedWithEverything(page);

      const boxes = await floatingBoxes(page);
      for (const key of ["header", "exit", "layers", "zoom", "locate", "timeline", "drawer"]) {
        expect(boxes[key], `${key} is rendered`).not.toBeNull();
      }
      expect(overlapsOf(boxes)).toEqual([]);

      for (const [key, b] of Object.entries(boxes)) {
        if (!b) continue;
        expect(b.l, `${key} left edge`).toBeGreaterThanOrEqual(-1);
        expect(b.t, `${key} top edge`).toBeGreaterThanOrEqual(-1);
        expect(b.r, `${key} right edge`).toBeLessThanOrEqual(width + 1);
        expect(b.b, `${key} bottom edge`).toBeLessThanOrEqual(height + 1);
      }
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowX).toBeLessThanOrEqual(1);
    });
  }

  test("the controls form one column under the layer pill, the exit on the header's row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExpandedWithEverything(page);
    const b = await floatingBoxes(page);

    /* left edges line up: pill, zoom stack, locate */
    expect(Math.abs(b.zoom.l - b.layers.l)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.locate.l - b.layers.l)).toBeLessThanOrEqual(1);
    /* and stack top to bottom in that order */
    expect(b.zoom.t).toBeGreaterThanOrEqual(b.layers.b);
    expect(b.locate.t).toBeGreaterThanOrEqual(b.zoom.b);
    /* the exit control is centred on the header's row, at the top-right */
    const mid = (x) => (x.t + x.b) / 2;
    expect(Math.abs(mid(b.exit) - mid(b.header))).toBeLessThanOrEqual(1);
    expect(b.exit.r).toBeGreaterThan(1440 - 40);
    /* the drawer starts below the exit control, not underneath it */
    expect(b.drawer.t).toBeGreaterThanOrEqual(b.exit.b);
  });

  test("every map control is a 44px target", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openExpandedWithEverything(page);
    for (const sel of [
      "#mapExitExpandBtn",
      "#worldMap .maplibregl-ctrl-zoom-in",
      "#worldMap .maplibregl-ctrl-zoom-out",
      "#worldMap .map-reset-btn",
      "#worldMap .maplibregl-ctrl-geolocate",
    ]) {
      const b = await page.locator(sel).boundingBox();
      expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(44);
      expect(b.width, `${sel} width`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the map attribution stays visible and nothing covers it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMocks(page);
    await withAttributedStyle(page);
    await page.goto(`/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=9`);
    await expect(panelName(page)).toBeVisible({ timeout: MAP_TIMEOUT });
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);

    const attribution = page.locator("#worldMap .maplibregl-ctrl-attrib");
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText("OpenStreetMap");
    expect(overlapsOf(await floatingBoxes(page))).toEqual([]);

    /* not merely unoverlapped on paper: the topmost element at its centre
       really is the attribution */
    const covered = await attribution.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !el.contains(hit);
    });
    expect(covered).toBe(false);
  });
});

test.describe("state across the round trip", () => {
  test("the page comes back to where it was scrolled", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openMap(page);
    await page.evaluate(() => window.scrollTo({ top: 140, behavior: "instant" }));
    /* focus without scrolling, so the test itself does not move the page */
    await expandBtn(page).evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(true);

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(140);

    /* the Escape route restores it too */
    await expandBtn(page).evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.press("Enter");
    await expect.poll(() => isExpanded(page)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(140);
  });

  test("the chosen forecast hour survives entering and leaving", async ({ page }) => {
    await openExpandedWithEverything(page);
    const plus3 = page.locator('#mapWeatherControls .map-time[data-map-time="3"]');
    await plus3.click();
    await expect(plus3).toHaveAttribute("aria-checked", "true");

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(plus3).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("rapid selections in the mode always end on the last one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    /* the first selection's lookup is deliberately the slow one */
    await installMocks(page, { reverseDelayMs: (lon) => (lon < -20 ? 900 : 0) });
    await page.goto(`/#/map?c=${CLICK_OCEAN.lat},${CLICK_OCEAN.lon}&z=4`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);
    await expect
      .poll(() => page.url(), { timeout: MAP_TIMEOUT })
      .toContain(`c=${CLICK_OCEAN.lat}%2C`);

    /* the centre of the viewport is open map at this size */
    await page.mouse.click(720, 450); // ocean — slow
    await page.evaluate((p) => {
      location.hash = `#/map?c=${p.lat},${p.lon}&z=10`;
    }, CLICK_CITY);
    await expect
      .poll(() => page.url(), { timeout: MAP_TIMEOUT })
      .toContain(`c=${CLICK_CITY.lat}%2C`);
    await page.mouse.click(720, 450); // Tarbes — fast

    await expect(panelName(page)).toHaveText("Tarbes");
    /* give the superseded ocean lookup time to land, and confirm it does not */
    await page.waitForTimeout(1200);
    await expect(panelName(page)).toHaveText("Tarbes");
    /* and none of that knocked the map out of the mode */
    expect(await isExpanded(page)).toBe(true);
  });
});

test.describe("names, languages and the drawer's close control", () => {
  test("the exit control says what it does, in both languages", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    await expandBtn(page).click();
    await expect(exitBtn(page)).toHaveAccessibleName("Quitter la carte agrandie");

    /* the language menu opens above the map, from the compact header */
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(exitBtn(page)).toHaveAccessibleName("Exit expanded map");
    expect(await isExpanded(page)).toBe(true);
  });

  test("the locate control is named in the interface language", async ({ page }) => {
    await openMap(page);
    /* the SDK's own default was "Find my location" in English, whatever the
       interface language */
    const locate = page.locator("#worldMap .maplibregl-ctrl-geolocate");
    await expect(locate).toHaveAccessibleName("Utiliser ma position actuelle");
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(locate).toHaveAccessibleName("Use my current location");
  });

  test("the drawer keeps its content, and its close control is centred and labelled", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExpandedWithEverything(page);
    const panel = page.locator("#mapWeatherPanel");
    /* country (with its flag), then region */
    await expect(panel.locator(".geo-chip")).toHaveCount(2);
    await expect(panel.locator(".geo-chip").first().locator(".geo-chip-flag")).toBeVisible();

    const close = page.locator("#mapPanelClose");
    await expect(close).toHaveAccessibleName("Masquer les détails météo");

    /* Centred by its rendered ink, not its box: decode a screenshot of the
       button and find the white cross inside its rounded red face. */
    const png = (await close.screenshot({ animations: "disabled" })).toString("base64");
    const off = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      /* the button is rounded, so the drawer shows through its corners —
         only pixels well inside the rounded face count */
      const R = 11;
      const inside = (x, y) => {
        const cx = Math.min(Math.max(x, R), c.width - 1 - R);
        const cy = Math.min(Math.max(y, R), c.height - 1 - R);
        return (x - cx) ** 2 + (y - cy) ** 2 <= (R - 2) ** 2;
      };
      let l = Infinity;
      let t = Infinity;
      let r = -1;
      let b = -1;
      for (let y = 2; y < c.height - 2; y++) {
        for (let x = 2; x < c.width - 2; x++) {
          if (!inside(x, y)) continue;
          const i = (y * c.width + x) * 4;
          if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) {
            l = Math.min(l, x);
            r = Math.max(r, x);
            t = Math.min(t, y);
            b = Math.max(b, y);
          }
        }
      }
      return { dx: (l + r + 1) / 2 - c.width / 2, dy: (t + b + 1) / 2 - c.height / 2 };
    }, png);
    expect(Math.abs(off.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(off.dy)).toBeLessThanOrEqual(1);

    /* Dismissible. Hiding asks for confirmation first, and that dialog has
       to be genuinely on top of a map that now covers the whole viewport —
       the topmost element at its confirm button must BE its confirm button. */
    await close.click();
    const confirm = page.locator("#confirmDialogConfirm");
    await expect(page.locator("#confirmDialog")).toBeVisible();
    const onTop = await confirm.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop).toBe(true);
    await confirm.click();
    await expect(panel).toBeHidden();
    await expect(page.locator("#mapShowPanel")).toBeVisible();
    expect(overlapsOf(await floatingBoxes(page))).toEqual([]);
    await page.locator("#mapShowPanel").click();
    await expect(panel).toBeVisible();
  });
});

test.describe("animation inside the mode", () => {
  const animate = (page) => page.locator("#mapWeatherControls .map-anim");

  test("rain keeps its opt-in toggle, and a replay survives leaving the mode", async ({ page }) => {
    await openExpandedWithEverything(page);
    await expect(animate(page)).toHaveAttribute("data-map-anim", "rain");
    await expect(animate(page)).toHaveAttribute("aria-pressed", "false");
    await animate(page).click();
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");

    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("wind still moves by default in the mode", async ({ page }) => {
    await openExpandedWithEverything(page);
    await page.locator('.map-layer[data-map-layer="wind"]').click();
    await expect(animate(page)).toHaveAttribute("data-map-anim", "wind", {
      timeout: MAP_TIMEOUT,
    });
    await expect(animate(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("under reduced motion nothing animates, including the mode's own control", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openExpandedWithEverything(page);
    await expect(animate(page)).toHaveCount(0);
    await page.locator('.map-layer[data-map-layer="wind"]').click();
    await expect(page.locator('.map-layer[data-map-layer="wind"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(animate(page)).toHaveCount(0);
    await expect(exitBtn(page)).toHaveCSS("animation-name", "none");
  });
});

test.describe("the normal Map page is left exactly as it was", () => {
  test("a round trip through the mode restores every box to the pixel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMocks(page);
    await page.goto(`/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=9`);
    await expect(panelName(page)).toBeVisible({ timeout: MAP_TIMEOUT });
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator("#mapWeatherControls")).toBeVisible();
    /* the overlay is ready once its status line stops loading — the same
       signal map-animation.spec.js waits on */
    await expect(page.locator("#mapWeatherControls .map-time-status")).not.toHaveAttribute(
      "data-loading",
      "1",
      { timeout: MAP_TIMEOUT },
    );
    /* Playwright scrolls an off-screen button into view before clicking it.
       Establish the baseline after that browser-required scroll so the
       round-trip comparison measures layout, not two different scroll
       positions. */
    await expandBtn(page).scrollIntoViewIfNeeded();

    const measure = () =>
      page.evaluate(() =>
        Object.fromEntries(
          [
            ".topnav",
            "#sidebar",
            "#mapCard",
            "#worldMap",
            ".map-layer-switcher",
            "#worldMap .maplibregl-ctrl-top-left",
            "#worldMap .maplibregl-ctrl-top-right",
            "#mapWeatherControls",
            "#mapWeatherPanel",
            "#mapExpandBtn",
          ].map((sel) => {
            const b = document.querySelector(sel).getBoundingClientRect();
            return [sel, [b.left, b.top, b.width, b.height].map((n) => Math.round(n))];
          }),
        ),
      );
    /* The drawer's photo, the timeline's status and the notice line all
       settle asynchronously, so "before" is only taken once two readings
       300ms apart agree — otherwise the comparison measures loading, not
       the mode. */
    const stable = async () => {
      let last = "";
      await expect
        .poll(
          async () => {
            const now = JSON.stringify(await measure());
            const same = now === last;
            last = now;
            return same;
          },
          { timeout: MAP_TIMEOUT, intervals: [300] },
        )
        .toBe(true);
      return JSON.parse(last);
    };
    const before = await stable();

    await expandBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(true);
    await exitBtn(page).click();
    await expect.poll(() => isExpanded(page)).toBe(false);

    expect(await stable()).toEqual(before);
    /* and on the normal page the locate control sits at the foot of the
       zoom stack (left column) rather than the SDK's top-right corner,
       where the details panel covered it */
    const card = before["#mapCard"];
    const locate = before["#worldMap .maplibregl-ctrl-top-right"];
    const zoom = before["#worldMap .maplibregl-ctrl-top-left"];
    expect(locate[0]).toBeLessThan(card[0] + card[2] / 2);
    expect(locate[1]).toBeGreaterThanOrEqual(zoom[1] + zoom[3]);
  });
});
