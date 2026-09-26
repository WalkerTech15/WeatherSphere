/* The Favorites page and its comparison table, in every state their weather
 * can be in: on its way, arrived, failed, missing for one place, or dated by a
 * clock that cannot be trusted. Plus the credit lines that name the providers.
 *
 * The three states must never look alike: an ellipsis and "Loading…" while a
 * request is out, a dash and an explanation when it failed, real numbers when
 * it did not — and never "Updated 29840290 min ago". */
import { test, expect, installMocks } from "./mocks.js";
import { LOCATIONS } from "../src/js/data/locations.js";

const PLACES = LOCATIONS.filter((loc) => loc.kind === "city").slice(0, 3);
const IDS = PLACES.map((loc) => loc.id);

/* what Open-Meteo answers for one place, in the shape both batched queries read */
const entry = (temp, extra = {}) => ({
  timezone: "Europe/Paris",
  current: {
    time: "2026-09-26T12:00",
    temperature_2m: temp,
    apparent_temperature: temp - 1,
    relative_humidity_2m: 55,
    wind_speed_10m: 12,
    weather_code: 1,
    is_day: 1,
  },
  daily: {
    time: ["2026-09-26"],
    temperature_2m_max: [temp + 4],
    temperature_2m_min: [temp - 4],
    precipitation_probability_max: [30],
    uv_index_max: [4],
  },
  ...extra,
});
const json = (body) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/* Answers Open-Meteo's two batched queries (favorites, comparison) with
 * `handlers`, and leaves every other request to the shared mocks. */
async function routeBatches(page, handlers) {
  const seen = { favorites: 0, comparison: 0 };
  await page.route("**://api.open-meteo.com/**", async (route, request) => {
    const url = new URL(request.url());
    const places = (url.searchParams.get("latitude") || "").split(",").length;
    const current = url.searchParams.get("current") || "";
    let kind = null;
    if (places > 1 || handlers.single) {
      if (current.includes("apparent_temperature") && !current.includes("precipitation")) {
        kind = "comparison";
      } else if (
        current === "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day"
      ) {
        kind = "favorites";
      }
    }
    if (!kind || !handlers[kind]) return route.fallback();
    seen[kind] += 1;
    return handlers[kind](route, { places, call: seen[kind] });
  });
  return seen;
}

const answer = (temps) => (route) => route.fulfill(json(temps.map((t) => entry(t))));
const fail =
  (status = 500) =>
  (route) =>
    route.fulfill({ status, contentType: "text/plain", body: "mocked failure" });
const later = (ms, then) => async (route, info) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return then(route, info);
};

async function open(page, { favorites = PLACES, compare = [], lang = "fr" } = {}) {
  await page.addInitScript(
    ([favs, ids, language]) => {
      localStorage.setItem("ws_lang", language);
      if (favs.length) localStorage.setItem("ws_favs", JSON.stringify(favs));
      if (ids.length) localStorage.setItem("ws_compare", JSON.stringify(ids));
    },
    [favorites, compare, lang],
  );
  await page.goto("/#/favorites");
}

const cards = (page) => page.locator("#favGrid .favx-card");
const card = (page, i = 0) => cards(page).nth(i);
const compareStatus = (page) => page.locator("#compareBlock .compare-status");

test.beforeEach(async ({ page }) => {
  await installMocks(page);
});

test.describe("timestamps", () => {
  test("never show a huge number of minutes — not while loading, not once loaded", async ({
    page,
  }) => {
    await routeBatches(page, { favorites: later(1200, answer([18, 14, 19])) });
    await open(page);
    await expect(card(page)).toBeVisible();
    const seen = [];
    const collect = async () =>
      seen.push(
        await page
          .locator("#favGrid, #favTable")
          .evaluateAll((els) => els.map((e) => e.innerText).join(" ")),
      );
    await collect(); /* while the request is still out */
    await expect(card(page).locator(".favx-temp")).toContainText("18", { timeout: 15000 });
    await collect(); /* once it has landed */
    for (const text of seen) expect(text).not.toMatch(/\d{4,}\s*min/);
    for (const text of seen) expect(text).not.toMatch(/il y a \d{3,}/);
  });

  test("a fresh reading says 'just now', then a real number of minutes", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]) });
    await open(page);
    await expect(card(page).locator(".favx-foot")).toContainText("Mis à jour à l'instant", {
      timeout: 15000,
    });
    await page.clock.setFixedTime(new Date(Date.now() + 10 * 60_000));
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="fr"]').click();
    await expect(card(page).locator(".favx-foot")).toContainText(/Mis à jour il y a (9|10|11) min/);
  });

  for (const [label, offsetMs] of [
    ["a clock a month ahead (stale)", 30 * 86_400_000],
    ["a clock hours behind (a timestamp from the future)", -3 * 3_600_000],
  ]) {
    test(`shows 'Données non actualisées', never a number, for ${label}`, async ({ page }) => {
      await routeBatches(page, { favorites: answer([18, 14, 19]) });
      await open(page);
      await expect(card(page).locator(".favx-temp")).toContainText("18", { timeout: 15000 });
      await page.clock.setFixedTime(new Date(Date.now() + offsetMs));
      await page.locator("#langBtn").click();
      await page.locator('#langMenu button[data-lang="fr"]').click();
      await expect(card(page).locator(".favx-foot")).toContainText("Données non actualisées");
      await expect(page.locator("#favTable .ft-ago").first()).toHaveText("Données non actualisées");
      await expect(card(page)).not.toContainText(/\d+\s*min/);
      /* the real weather stays on screen — only the date is withheld */
      await expect(card(page).locator(".favx-temp")).toContainText("18");
    });
  }

  test("the fallback is translated", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]) });
    await open(page, { lang: "en" });
    await expect(card(page).locator(".favx-temp")).toContainText("18", { timeout: 15000 });
    await page.clock.setFixedTime(new Date(Date.now() + 30 * 86_400_000));
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(card(page).locator(".favx-foot")).toContainText("Not updated");
  });
});

test.describe("favorite cards: loading, failure, retry", () => {
  test("say 'loading' while the request is out, keeping the name and controls usable", async ({
    page,
  }) => {
    await routeBatches(page, { favorites: later(2500, answer([18, 14, 19])) });
    await open(page);
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".favx-desc")).toHaveText("Chargement de la météo…");
    await expect(card(page)).toHaveAttribute("aria-busy", "true");
    await expect(card(page).locator(".favx-temp")).toHaveAttribute("aria-hidden", "true");
    await expect(card(page).locator(".favx-names b")).toHaveText(PLACES[0].name.fr);
    await expect(card(page).locator(".favx-open")).toBeEnabled();
    await expect(card(page).locator(".favx-star")).toBeEnabled();
    await expect(card(page).locator(".favx-retry")).toHaveCount(0); /* nothing has failed yet */
    /* the table row says the same, in words */
    await expect(page.locator("#favTable tbody tr").first()).toContainText("Chargement");
    await expect(card(page).locator(".favx-temp")).toContainText("18", { timeout: 15000 });
    await expect(card(page)).not.toHaveAttribute("aria-busy", /.*/);
  });

  test("say 'unavailable' when the request fails — no numbers, no invented demo weather", async ({
    page,
  }) => {
    await routeBatches(page, { favorites: fail(500) });
    await open(page);
    for (let i = 0; i < PLACES.length; i++) {
      await expect(card(page, i).locator(".favx-desc")).toHaveText("Météo indisponible");
      await expect(card(page, i).locator(".favx-temp")).toHaveText("—");
      await expect(card(page, i)).not.toContainText("°C");
      await expect(card(page, i).locator(".favx-foot")).toContainText("Données non actualisées");
      /* the place and its controls survive the failure */
      await expect(card(page, i).locator(".favx-names b")).toHaveText(PLACES[i].name.fr);
      await expect(card(page, i).locator(".favx-open")).toBeEnabled();
      await expect(card(page, i).locator(".favx-star")).toBeEnabled();
    }
    await expect(page.locator("#favTable tbody tr").first()).toContainText("Météo indisponible");
  });

  test("is reported in English too", async ({ page }) => {
    await routeBatches(page, { favorites: fail(500) });
    await open(page, { lang: "en" });
    await expect(card(page).locator(".favx-desc")).toHaveText("Weather unavailable");
    await expect(card(page).locator(".favx-retry")).toHaveText("Try again");
    await expect(card(page).locator(".favx-foot")).toContainText("Not updated");
  });

  test("retry asks again, shows loading, and fills the cards in when it works", async ({
    page,
  }) => {
    let healthy = false;
    const seen = await routeBatches(page, {
      favorites: (route, info) => (healthy ? answer([18, 14, 19])(route, info) : fail(500)(route)),
    });
    await open(page);
    const retry = card(page).locator(".favx-retry");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAccessibleName("Réessayer de charger la météo");
    const before = seen.favorites;
    healthy = true;
    await retry.click();
    await expect(card(page).locator(".favx-temp")).toContainText("18", { timeout: 15000 });
    expect(seen.favorites).toBeGreaterThan(before);
    /* trying again did not open the place */
    await expect(page.locator("#view-favorites")).toBeVisible();
    await expect(cards(page).first()).toBeVisible();
  });

  test("retry is reachable and works from the keyboard", async ({ page }) => {
    let healthy = false;
    await routeBatches(page, {
      favorites: (route, info) => (healthy ? answer([18, 14, 19])(route, info) : fail(500)(route)),
    });
    await open(page);
    const retry = card(page).locator(".favx-retry");
    await retry.focus();
    await expect(retry).toBeFocused();
    healthy = true;
    await page.keyboard.press("Enter");
    await expect(card(page).locator(".favx-temp")).toContainText("18", { timeout: 15000 });
  });

  test("a failure with an error does not turn into fake data on the next visit", async ({
    page,
  }) => {
    await routeBatches(page, { favorites: fail(503) });
    await open(page);
    await expect(card(page).locator(".favx-desc")).toHaveText("Météo indisponible");
    await page.locator('.side-item[data-view="home"]').click();
    await page.locator('.side-item[data-view="favorites"]').click();
    await expect(card(page).locator(".favx-desc")).toHaveText("Météo indisponible");
    await expect(card(page)).not.toContainText("°C");
  });

  test("one favorite with no weather does not blank the others", async ({ page }) => {
    await routeBatches(page, {
      favorites: (route) => route.fulfill(json([entry(18), {}, entry(19)])),
    });
    await open(page);
    await expect(card(page, 0).locator(".favx-temp")).toContainText("18");
    await expect(card(page, 2).locator(".favx-temp")).toContainText("19");
    await expect(card(page, 1).locator(".favx-desc")).toHaveText("Météo indisponible");
    await expect(card(page, 1).locator(".favx-retry")).toBeVisible();
  });

  test("an older, slower answer never replaces the newer one", async ({ page }) => {
    const seen = await routeBatches(page, {
      favorites: async (route, { places }) => {
        if (places === 2) {
          /* the first request: slow, and superseded by the time it arrives */
          await new Promise((resolve) => setTimeout(resolve, 2500));
          return route.fulfill(json([entry(1), entry(1)]));
        }
        return route.fulfill(json([entry(30), entry(30), entry(30)]));
      },
    });
    await open(page, { favorites: PLACES.slice(0, 2) });
    await expect(card(page)).toBeVisible();
    /* star the current place while the first request is still out: a newer,
       three-place request */
    await page.locator('.side-item[data-view="home"]').click();
    await page.locator("#heroFavBtn").click();
    await expect(page.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");
    await page.locator('.side-item[data-view="favorites"]').click();
    await expect(cards(page)).toHaveCount(3);
    await expect(card(page).locator(".favx-temp")).toContainText("30", { timeout: 15000 });
    await page.waitForTimeout(3200); /* let the stale answer arrive */
    await expect(card(page).locator(".favx-temp")).toContainText("30");
    await expect(card(page, 2).locator(".favx-temp")).toContainText("30");
    expect(seen.favorites).toBeGreaterThanOrEqual(2);
  });

  test("the empty state is untouched", async ({ page }) => {
    await open(page, { favorites: [] });
    await expect(page.locator("#favGrid .empty-state")).toBeVisible();
    await expect(page.locator("#favGrid .favx-card")).toHaveCount(0);
  });
});

test.describe("comparison table", () => {
  const compare = IDS.slice(0, 2);

  test("shows 'loading' cells and a status line, not unexplained dashes, while it loads", async ({
    page,
  }) => {
    await routeBatches(page, {
      favorites: answer([18, 14, 19]),
      comparison: later(2500, answer([18, 14])),
    });
    await open(page, { compare });
    await expect(compareStatus(page)).toHaveText("Chargement de la météo des lieux sélectionnés…");
    await expect(page.locator(".compare-table")).toHaveAttribute("aria-busy", "true");
    const cells = await page.locator(".compare-table tbody td").allInnerTexts();
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.trim()).toBe("…");
    /* then the values, with the note gone */
    await expect(
      page.locator(".compare-table tbody tr").first().locator("td").first(),
    ).toContainText("18", { timeout: 15000 });
    await expect(compareStatus(page)).toHaveCount(0);
    await expect(page.locator(".compare-table")).toHaveAttribute("aria-busy", "false");
  });

  test("fills real values in for every selected place", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]), comparison: answer([18, 14]) });
    await open(page, { compare });
    const temperature = page.locator(".compare-table tbody tr").first();
    await expect(temperature.locator("td").nth(0)).toContainText("18");
    await expect(temperature.locator("td").nth(1)).toContainText("14");
    await expect(compareStatus(page).filter({ hasText: /chargement/i })).toHaveCount(0);
  });

  test("says the weather could not be loaded when the request fails, and can try again", async ({
    page,
  }) => {
    let healthy = false;
    const seen = await routeBatches(page, {
      favorites: answer([18, 14, 19]),
      comparison: (route, info) => (healthy ? answer([18, 14])(route, info) : fail(500)(route)),
    });
    await open(page, { compare });
    await expect(compareStatus(page)).toContainText(
      "La météo de ces lieux n’a pas pu être chargée.",
    );
    await expect(compareStatus(page)).toHaveAttribute("data-state", "error");
    /* every value is a dash — and now the page says why */
    for (const cell of await page.locator(".compare-table tbody td").allInnerTexts()) {
      expect(cell.trim()).toBe("—");
    }
    /* the columns and their controls survive */
    await expect(page.locator(".compare-table thead th")).toHaveCount(3);
    await expect(page.locator("[data-compare-remove]")).toHaveCount(2);
    const before = seen.comparison;
    healthy = true;
    await compareStatus(page).locator("[data-compare-retry]").click();
    await expect(
      page.locator(".compare-table tbody tr").first().locator("td").first(),
    ).toContainText("18", { timeout: 15000 });
    expect(seen.comparison).toBeGreaterThan(before);
  });

  test("a failure is not remembered as fresh: reopening the page asks again", async ({ page }) => {
    let healthy = false;
    const seen = await routeBatches(page, {
      favorites: answer([18, 14, 19]),
      comparison: (route, info) => (healthy ? answer([18, 14])(route, info) : fail(500)(route)),
    });
    await open(page, { compare });
    await expect(compareStatus(page)).toHaveAttribute("data-state", "error");
    healthy = true;
    const before = seen.comparison;
    await page.locator('.side-item[data-view="home"]').click();
    await page.locator('.side-item[data-view="favorites"]').click();
    await expect(
      page.locator(".compare-table tbody tr").first().locator("td").first(),
    ).toContainText("18", { timeout: 15000 });
    expect(seen.comparison).toBeGreaterThan(before);
  });

  test("names a place the provider had nothing for, without inventing its values", async ({
    page,
  }) => {
    await routeBatches(page, {
      favorites: answer([18, 14, 19]),
      comparison: (route) => route.fulfill(json([entry(18), {}])),
    });
    await open(page, { compare });
    await expect(compareStatus(page)).toContainText(
      `Aucune météo n’est disponible pour ${PLACES[1].name.fr}.`,
    );
    await expect(compareStatus(page)).toHaveAttribute("data-state", "partial");
    const temperature = page.locator(".compare-table tbody tr").first();
    await expect(temperature.locator("td").nth(0)).toContainText("18");
    await expect(temperature.locator("td").nth(1)).toHaveText("—");
  });

  test("says so when only air quality could not be loaded", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]), comparison: answer([18, 14]) });
    await page.route("**://air-quality-api.open-meteo.com/**", (route, request) => {
      const places = (new URL(request.url()).searchParams.get("latitude") || "").split(",").length;
      return places > 1 ? route.fulfill({ status: 500, body: "down" }) : route.fallback();
    });
    await open(page, { compare });
    await expect(compareStatus(page)).toContainText("La qualité de l’air n’a pas pu être chargée.");
    const aqiRow = page.locator(".compare-table tbody tr").nth(6);
    await expect(aqiRow.locator("td").first()).toHaveText("—");
    await expect(
      page.locator(".compare-table tbody tr").first().locator("td").first(),
    ).toContainText("18");
  });

  test("is reported in English", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]), comparison: fail(500) });
    await open(page, { compare, lang: "en" });
    await expect(compareStatus(page)).toContainText(
      "The weather for these places could not be loaded.",
    );
    await expect(compareStatus(page).locator("[data-compare-retry]")).toHaveText("Try again");
  });

  test("keeps its table semantics and accessible names in every state", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]), comparison: fail(500) });
    await open(page, { compare });
    await expect(compareStatus(page)).toBeVisible();
    await expect(page.locator(".compare-table caption")).toHaveCount(1);
    await expect(page.locator('.compare-table thead th[scope="col"]')).toHaveCount(3);
    await expect(page.locator('.compare-table tbody th[scope="row"]')).toHaveCount(8);
    await expect(page.locator("[data-compare-remove]").first()).toHaveAccessibleName(
      /Retirer .* de la comparaison/,
    );
    await expect(compareStatus(page)).toHaveAttribute("role", "status");
  });

  test("the retry button is reachable by keyboard and keeps focus while the failure stands", async ({
    page,
  }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]), comparison: fail(500) });
    await open(page, { compare });
    const retry = compareStatus(page).locator("[data-compare-retry]");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(compareStatus(page)).toHaveAttribute("data-state", "error", { timeout: 15000 });
    await expect(compareStatus(page).locator("[data-compare-retry]")).toBeFocused();
  });

  test("credits Open-Meteo under the table, with a working link", async ({ page }) => {
    await routeBatches(page, { favorites: answer([18, 14, 19]), comparison: answer([18, 14]) });
    await open(page, { compare });
    const source = page.locator("#compareBlock .compare-source");
    await expect(source).toContainText("Météo et qualité de l’air : Open-Meteo.");
    const link = source.locator("a");
    await expect(link).toHaveAttribute("href", "https://open-meteo.com");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("target", "_blank");
  });
});

test.describe("layout in every state", () => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    for (const scenario of ["loading", "failed", "loaded"]) {
      test(`${viewport.width}px, ${scenario}: nothing overflows, and the table still scrolls sideways`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const favorites =
          scenario === "loading"
            ? later(1800, answer([18, 14, 19]))
            : scenario === "failed"
              ? fail(500)
              : answer([18, 14, 19]);
        const comparison =
          scenario === "loading"
            ? later(1800, answer([18, 14]))
            : scenario === "failed"
              ? fail(500)
              : answer([18, 14]);
        await routeBatches(page, { favorites, comparison });
        await open(page, { compare: IDS.slice(0, 2) });
        if (scenario === "failed") await expect(card(page).locator(".favx-retry")).toBeVisible();
        if (scenario === "loaded")
          await expect(card(page).locator(".favx-temp")).toContainText("18");
        await expect(page.locator(".compare-table")).toBeVisible();
        if (scenario === "failed") await expect(compareStatus(page)).toBeVisible();

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await expect(page.locator("#compareBlock .table-scroll")).toHaveCSS("overflow-x", "auto");
        /* the card's text is never clipped by its own box */
        const clipped = await card(page).evaluate((el) =>
          [...el.querySelectorAll(".favx-desc, .favx-foot, .favx-retry, .favx-names b")]
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => node.className),
        );
        expect(clipped).toEqual([]);
        if (scenario === "failed") {
          const box = await card(page).locator(".favx-retry").boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(43.9); /* 44px, less sub-pixel rounding */
          const cardBox = await card(page).boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
        }
      });
    }
  }

  test("reduced motion: the loading state adds no animation of its own", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await routeBatches(page, { favorites: later(1500, answer([18, 14, 19])) });
    await open(page);
    await expect(card(page).locator(".favx-desc")).toHaveText("Chargement de la météo…");
    const animated = await card(page)
      .locator(".favx-desc, .favx-temp")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    expect(animated.every((name) => name === "none")).toBe(true);
  });
});

test.describe("attribution", () => {
  test("the footer credits the providers behind every page, in both languages", async ({
    page,
  }) => {
    await open(page, { favorites: [], lang: "fr" });
    const footer = page.locator('[data-i18n="footerData"]');
    await expect(footer).toHaveText("Données : Open-Meteo · OpenStreetMap · MapTiler");
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(footer).toHaveText("Data: Open-Meteo · OpenStreetMap · MapTiler");
  });

  test("the footer does not claim providers that belong to one optional feature", async ({
    page,
  }) => {
    await open(page, { favorites: [] });
    const text = await page.locator('[data-i18n="footerData"]').innerText();
    for (const name of ["OpenWeatherMap", "Xweather", "Pexels", "Google", "Mapillary"]) {
      expect(text).not.toContain(name);
    }
  });

  test("the About page lists every provider, each with a safe, named link", async ({ page }) => {
    await page.goto("/#/about");
    const rows = page.locator("#srcList .src-row");
    await expect(rows).toHaveCount(11);
    for (const name of [
      "Open-Meteo",
      "OpenStreetMap",
      "MapTiler",
      "Pexels",
      "BigDataCloud",
      "Wikimedia Commons",
      "OpenWeatherMap",
      "Xweather",
      "National Weather Service",
      "Google Places",
      "Mapillary",
    ]) {
      await expect(
        rows.filter({ has: page.locator("b", { hasText: new RegExp(`^${name}$`) }) }),
      ).toHaveCount(1);
    }
    /* every description is translated, none left as an empty span or a raw key */
    const blurbs = await page.locator("#srcList .src-body span").allInnerTexts();
    for (const blurb of blurbs) {
      expect(blurb.trim().length).toBeGreaterThan(10);
      expect(blurb).not.toMatch(/^src[A-Z]/);
    }
    const links = await page
      .locator("#srcList .link-chip")
      .evaluateAll((els) => els.map((el) => ({ href: el.href, rel: el.rel, target: el.target })));
    for (const link of links) {
      expect(link.href).toMatch(/^https:\/\//);
      expect(link.rel).toContain("noopener");
      expect(link.target).toBe("_blank");
    }
  });

  test("the About list follows the language", async ({ page }) => {
    await page.goto("/#/about");
    await expect(page.locator('#srcList [data-i18n="srcOpenWeather"]')).toHaveText(
      "Couverture nuageuse de la couche Nuages de la carte.",
    );
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(page.locator('#srcList [data-i18n="srcOpenWeather"]')).toHaveText(
      "Cloud cover for the map's Clouds layer.",
    );
  });

  for (const width of [320, 390]) {
    test(`the longer provider list does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/#/about");
      await expect(page.locator("#srcList .src-row")).toHaveCount(11);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
