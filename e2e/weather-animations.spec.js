/* The hero's optional weather effects: snow, lightning and ocean waves.
 *
 * What matters here is as much when they do NOT appear as when they do: every
 * effect is gated on real data, so each is proved present for the condition
 * that earns it and absent for every neighbouring condition that must not.
 * Also covered: the animation setting and the device's reduced-motion
 * preference, stale effects when the location changes quickly, a hidden tab,
 * and the absence of any tornado overlay while no official alert source
 * exists. */
import { test, expect, installMocks, CLICK_OCEAN, GEOCODE_LABEL, AUSTIN_LABEL } from "./mocks.js";

const fx = (page) => page.locator("#heroFx");
const flakes = (page) => page.locator("#heroFx .fx-flake");

async function openHome(page, overrides = {}, { reducedMotion = false } = {}) {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await installMocks(page, overrides);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

/* No effect at all: the layer is hidden and empty. */
async function expectNoEffects(page) {
  await expect(fx(page)).toBeHidden();
  await expect(page.locator("#heroFx > *")).toHaveCount(0);
}

test.describe("snow — only for a real snow condition", () => {
  test("falls, gently and within budget, when the data says snow", async ({ page }) => {
    await openHome(page, { weatherKind: "snow" });
    await expect(fx(page)).toBeVisible();
    await expect(fx(page)).toHaveAttribute("data-fx", /snow/);
    await expect(fx(page)).toHaveAttribute("data-motion", "animated");

    const count = await flakes(page).count();
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThanOrEqual(28);
    /* transform-only motion: the flake's animation is the snow keyframes, and
       it is slow (seconds, not a blur) */
    const first = flakes(page).first();
    await expect(first).toHaveCSS("animation-name", "fxSnow");
    const seconds = await first.evaluate((el) =>
      parseFloat(getComputedStyle(el).animationDuration),
    );
    expect(seconds).toBeGreaterThanOrEqual(8);
  });

  /* Each of these is a neighbouring condition that must NOT snow. */
  for (const [kind, why] of [
    ["calm", "clear weather"],
    ["rain", "rain"],
    ["storm", "a thunderstorm"],
    ["gale", "heavy rain and a gale"],
    ["snowUnmeasured", "a snow code with no precipitation reading"],
    ["snowWarm", "a snow code on a 9 °C day"],
  ]) {
    test(`does not fall in ${why}`, async ({ page }) => {
      await openHome(page, { weatherKind: kind });
      await expect(page.locator('#heroFx[data-fx~="snow"]')).toHaveCount(0);
      await expect(flakes(page)).toHaveCount(0);
    });
  }

  test("sits behind the text and never intercepts a click on it", async ({ page }) => {
    await openHome(page, { weatherKind: "snow" });
    await expect(fx(page)).toBeVisible();
    await expect(fx(page)).toHaveCSS("pointer-events", "none");
    await expect(fx(page)).toHaveAttribute("aria-hidden", "true");
    /* the city name and the favourite button are what a visitor clicks */
    for (const selector of ["#heroCityName", "#heroFavBtn"]) {
      const onTop = await page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el === hit || el.contains(hit);
      });
      expect(onTop, `${selector} is what is under the pointer`).toBe(true);
    }
  });

  test("uses only compositor-friendly properties", async ({ page }) => {
    await openHome(page, { weatherKind: "snow" });
    const props = await flakes(page)
      .first()
      .evaluate((el) => {
        const anim = el.getAnimations()[0];
        const frames = anim.effect.getKeyframes();
        return [...new Set(frames.flatMap((f) => Object.keys(f)))].filter(
          (k) => !["offset", "easing", "composite", "computedOffset"].includes(k),
        );
      });
    expect(props).toEqual(["transform"]);
  });
});

test.describe("lightning — only when the data says thunderstorm", () => {
  test("a rare, gentle flash appears for a thunderstorm code", async ({ page }) => {
    await openHome(page, { weatherKind: "storm" });
    await expect(fx(page)).toHaveAttribute("data-fx", /lightning/);
    const flash = page.locator("#heroFx .fx-flash");
    await expect(flash).toHaveCount(1);
    /* infrequent: one flash per ~19 s */
    const seconds = await flash.evaluate((el) =>
      parseFloat(getComputedStyle(el).animationDuration),
    );
    expect(seconds).toBeGreaterThanOrEqual(15);
    /* subtle: at no keyframe brighter than a quarter opacity */
    const peak = await flash.evaluate((el) =>
      Math.max(
        ...el
          .getAnimations()[0]
          .effect.getKeyframes()
          .map((f) => Number(f.opacity ?? 0)),
      ),
    );
    expect(peak).toBeLessThanOrEqual(0.25);
  });

  for (const [kind, why] of [
    ["rain", "rain"],
    ["gale", "heavy rain with 130 km/h gusts and a pressure crash"],
    ["snow", "snow"],
    ["calm", "clear weather"],
  ]) {
    test(`never appears for ${why}`, async ({ page }) => {
      await openHome(page, { weatherKind: kind });
      await expect(page.locator("#heroFx .fx-flash")).toHaveCount(0);
      await expect(page.locator('#heroFx[data-fx~="lightning"]')).toHaveCount(0);
    });
  }
});

test.describe("ocean — only for an ocean or sea", () => {
  async function tapOcean(page) {
    await page.goto(`/#/map?c=${CLICK_OCEAN.lat},${CLICK_OCEAN.lon}&z=5`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.url(), { timeout: 20000 }).toContain(`c=${CLICK_OCEAN.lat}%2C`);
    const map = page.locator("#worldMap");
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toContainText(
      /Atlantique|Atlantic/,
      { timeout: 20000 },
    );
    await page.locator('.side-item[data-view="home"]').click();
    await expect(page.locator("#heroCityName")).toContainText(/Atlantique|Atlantic/);
  }

  test("waves drift under an ocean's hero, leaving its photo credit untouched", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await installMocks(page);
    await tapOcean(page);

    await expect(fx(page)).toHaveAttribute("data-fx", /ocean/);
    await expect(page.locator("#heroFx .fx-wave")).toHaveCount(2);
    await expect(page.locator("#heroFx .fx-wave").first()).toHaveCSS("animation-name", "fxWave");

    /* imagery and attribution are exactly what the photo pipeline set: the
       overview label and a working link, and nothing is on top of them */
    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toHaveAttribute("data-provenance", "overview");
    await expect(credit).toHaveAttribute("href", /^https:\/\//);
    const onTop = await credit.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === hit || el.contains(hit);
    });
    expect(onTop).toBe(true);
  });

  test("an inland city never gets waves, whatever the weather", async ({ page }) => {
    for (const kind of ["calm", "storm", "snow", "rain", "gale"]) {
      await openHome(page, { weatherKind: kind });
      await expect(page.locator('#heroFx[data-fx~="ocean"]')).toHaveCount(0);
      await expect(page.locator("#heroFx .fx-wave")).toHaveCount(0);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("waves hold still under reduced motion", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installMocks(page);
    await tapOcean(page);
    await expect(fx(page)).toHaveAttribute("data-motion", "static");
    await expect(page.locator("#heroFx .fx-wave").first()).toHaveCSS("animation-name", "none");
  });
});

test.describe("reduced motion and the animation setting", () => {
  test("under prefers-reduced-motion snow is a still, not an animation", async ({ page }) => {
    await openHome(page, { weatherKind: "snow" }, { reducedMotion: true });
    await expect(fx(page)).toHaveAttribute("data-motion", "static");
    await expect(flakes(page).first()).toHaveCSS("animation-name", "none");
    await expect(flakes(page).first()).toHaveCSS("transform", "none");
  });

  test("under prefers-reduced-motion there is no lightning at all", async ({ page }) => {
    await openHome(page, { weatherKind: "storm" }, { reducedMotion: true });
    await expect(page.locator("#heroFx .fx-flash")).toHaveCount(0);
    await expectNoEffects(page);
  });

  test("a device preference that changes while the page is open takes effect at once", async ({
    page,
  }) => {
    await openHome(page, { weatherKind: "snow" });
    await expect(fx(page)).toHaveAttribute("data-motion", "animated");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(fx(page)).toHaveAttribute("data-motion", "static");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(fx(page)).toHaveAttribute("data-motion", "animated");
  });
});

test.describe("a hidden tab or a scrolled-away hero pauses the effects", () => {
  test("the effects freeze while the tab is hidden and resume when it is shown", async ({
    page,
  }) => {
    await openHome(page, { weatherKind: "snow" });
    await expect(fx(page)).toHaveAttribute("data-paused", "false");

    const setHidden = (hidden) =>
      page.evaluate((h) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    await setHidden(true);
    await expect(fx(page)).toHaveAttribute("data-paused", "true");
    await expect(flakes(page).first()).toHaveCSS("animation-play-state", "paused");
    await setHidden(false);
    await expect(fx(page)).toHaveAttribute("data-paused", "false");
    await expect(flakes(page).first()).toHaveCSS("animation-play-state", "running");
  });

  test("leaving the Home view pauses them (the hero is no longer on screen)", async ({ page }) => {
    await openHome(page, { weatherKind: "snow" });
    await page.locator('.side-item[data-view="forecast"]').click();
    await expect(fx(page)).toHaveAttribute("data-paused", "true");
  });
});

test.describe("stale effects and rapid location changes", () => {
  /* Reykjavik (the mocked geocode hit, 64°N) gets snow; everywhere else,
     including the curated cities the search offers, is calm. */
  const snowNorthOnly = (url) =>
    Number(new URL(url).searchParams.get("latitude")) > 60 ? "snow" : "calm";

  async function selectByName(page, query, expected) {
    await page.locator("#searchInput").fill(query);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(expected);
  }

  test("the previous place's snow is gone the moment the next place starts loading", async ({
    page,
  }) => {
    await openHome(page, { weatherKind: snowNorthOnly });
    await selectByName(page, GEOCODE_LABEL, GEOCODE_LABEL);
    await expect(fx(page)).toHaveAttribute("data-fx", /snow/);

    /* the next place's weather is slow, so there is a window in which the
       old sky could hang over the new name */
    await page.route("**://api.open-meteo.com/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.fallback();
    });
    await page.locator("#searchInput").fill(AUSTIN_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    /* strictly INSIDE the 4 s the weather is held for: an assertion that kept
       retrying past it would pass once Austin's own weather cleared the sky,
       proving nothing about the window in between */
    await expect(fx(page)).toBeHidden({ timeout: 1500 });
    await expect(flakes(page)).toHaveCount(0, { timeout: 1500 });

    /* and once Austin's own (calm) weather arrives, it stays clear */
    await expect(page.locator("#heroCityName")).toContainText(AUSTIN_LABEL, { timeout: 15000 });
    await expect(flakes(page)).toHaveCount(0);
  });

  test("a slow snowy answer that lands after a faster calm one never paints snow", async ({
    page,
  }) => {
    await openHome(page, { weatherKind: snowNorthOnly });
    /* only the snowy place is slow */
    await page.route("**://api.open-meteo.com/**", async (route) => {
      const lat = Number(new URL(route.request().url()).searchParams.get("latitude"));
      if (lat > 60) await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fallback();
    });
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click(); /* slow, snowy */
    await page.locator("#searchInput").fill(AUSTIN_LABEL);
    await page.locator("#searchResults .search-item").first().click(); /* fast, calm */
    await expect(page.locator("#heroCityName")).toContainText(AUSTIN_LABEL);

    /* wait past the slow response, then check nothing snowy was painted */
    await page.waitForTimeout(3500);
    await expect(page.locator("#heroCityName")).toContainText(AUSTIN_LABEL);
    await expect(flakes(page)).toHaveCount(0);
    await expect(page.locator('#heroFx[data-fx~="snow"]')).toHaveCount(0);
  });

  test("effects follow the selected place through several quick changes", async ({ page }) => {
    await openHome(page, { weatherKind: snowNorthOnly });
    for (let i = 0; i < 3; i++) {
      await selectByName(page, GEOCODE_LABEL, GEOCODE_LABEL);
      await selectByName(page, AUSTIN_LABEL, AUSTIN_LABEL);
    }
    await expect(flakes(page)).toHaveCount(0);
    await selectByName(page, GEOCODE_LABEL, GEOCODE_LABEL);
    await expect(fx(page)).toHaveAttribute("data-fx", /snow/);
  });
});

test.describe("missing or failed data draws nothing", () => {
  test("a weather provider failure (demo data) shows no snow or lightning", async ({ page }) => {
    await openHome(page, { weatherStatus: 500 });
    await expect(page.locator(".wx-notice").first()).not.toBeEmpty();
    await expectNoEffects(page);
  });

  test("an unreachable provider never leaves an effect from a previous session's data", async ({
    page,
  }) => {
    await installMocks(page, { weatherKind: "snow" });
    await page.goto("/");
    await expect(fx(page)).toBeVisible();
    /* the same page, now offline for every later request */
    await page.route("**://api.open-meteo.com/**", (route) => route.abort());
    await page.locator("#searchInput").fill(AUSTIN_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(AUSTIN_LABEL);
    await expectNoEffects(page);
  });
});

test.describe("no tornado is ever shown without an official alert source", () => {
  const TORNADO = /tornad/i;

  for (const kind of ["gale", "storm", "severe", "rain"]) {
    test(`${kind}: no tornado layer, warning or animation on Home, Map or Forecast`, async ({
      page,
    }) => {
      await openHome(page, { weatherKind: kind });
      for (const path of ["/", "/#/map", "/#/forecast"]) {
        await page.goto(path);
        await expect(page.locator("body")).toBeVisible();
        await page.waitForTimeout(400);
        await expect(page.locator('[data-alert-type="tornado"], [data-fx~="tornado"]')).toHaveCount(
          0,
        );
        await expect(page.locator('[class*="tornado" i], [id*="tornado" i]')).toHaveCount(0);
        const visibleText = await page.locator("body").innerText();
        expect(visibleText, `${path} under ${kind}`).not.toMatch(TORNADO);
      }
    });
  }

  test("nothing is requested from any alert source", async ({ page }) => {
    const alertRequests = [];
    page.on("request", (request) => {
      if (/alerts?\.|\/alerts|cap\b|weather\.gov|meteoalarm|warnings/i.test(request.url()))
        alertRequests.push(request.url());
    });
    await openHome(page, { weatherKind: "gale" });
    await page.goto("/#/map");
    await page.waitForTimeout(800);
    expect(alertRequests).toEqual([]);
  });
});

test.describe("layout at every width", () => {
  for (const width of [768, 1024, 1440]) {
    test(`snow stays inside the hero and never overflows the page at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page, { weatherKind: "snow" });
      await expect(fx(page)).toBeVisible();
      const box = await page.evaluate(() => {
        const hero = document.querySelector("#heroCard").getBoundingClientRect();
        const layer = document.querySelector("#heroFx").getBoundingClientRect();
        return {
          insideHero:
            layer.left >= hero.left - 1 &&
            layer.right <= hero.right + 1 &&
            layer.top >= hero.top - 1 &&
            layer.bottom <= hero.bottom + 1,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(box.insideHero).toBe(true);
      expect(box.overflow).toBeLessThanOrEqual(1);
    });
  }
});
