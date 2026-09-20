/* Visual-consistency guarantees: the About page's colors come from the design
 * tokens (and so follow the theme), decorative motion honours the reduced-
 * motion preference, and Home's section headings share one scale.
 *
 * Colors are measured, not pattern-matched: a computed color can serialise as
 * rgb(), color(srgb …) or color-mix(), so each is resolved to real pixels by
 * painting it on a canvas. That is also what the user sees, which is the point
 * of a contrast check. */
import { test, expect, installMocks } from "./mocks.js";

/* Resolve any CSS color (optionally over an opaque backdrop) to [r, g, b]. */
const RESOLVE = () => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  return (color, over) => {
    ctx.clearRect(0, 0, 1, 1);
    if (over) {
      ctx.fillStyle = over;
      ctx.fillRect(0, 0, 1, 1);
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
};

const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

async function openAbout(page, theme) {
  await installMocks(page);
  await page.addInitScript((t) => localStorage.setItem("ws_theme", t), theme);
  await page.goto("/#/about");
  await expect(page.locator("#view-about .tech-logo").first()).toBeVisible();
}

/* [ink, tile background over the card] for every tile of one selector */
const measure = (page, selector) =>
  page.evaluate(
    ([sel, resolveSrc]) => {
      const resolve = new Function(`return (${resolveSrc})()`)();
      return [...document.querySelectorAll(sel)].map((el) => {
        const cs = getComputedStyle(el);
        const card = getComputedStyle(el.closest(".card")).backgroundColor;
        return {
          label: el.textContent.trim(),
          ink: resolve(cs.color),
          bg: resolve(cs.backgroundColor, card),
        };
      });
    },
    [selector, RESOLVE.toString()],
  );

test.describe("About page colors follow the design tokens", () => {
  test("no hard-coded inline colors remain on the technology or source logos", async ({ page }) => {
    await openAbout(page, "light");
    /* scoped to the colored logos: the feature cards legitimately carry a
       script-set animation-delay, which is dynamic and stays inline */
    await expect(
      page.locator("#view-about .tech-logo[style], #view-about .src-logo[style]"),
    ).toHaveCount(0);
    await expect(page.locator("#view-about .block-head[style]")).toHaveCount(0);
    /* every logo carries exactly one palette tone */
    await expect(page.locator("#view-about .tech-logo:not([class*='tone-'])")).toHaveCount(0);
    await expect(page.locator("#view-about .src-logo:not([class*='tone-'])")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"]) {
    test(`technology tiles are legible in the ${theme} theme`, async ({ page }) => {
      await openAbout(page, theme);
      const tiles = await measure(page, "#view-about .tech-logo");
      expect(tiles.length).toBeGreaterThanOrEqual(14);
      for (const t of tiles) {
        /* the label is 19px/800, i.e. "large text" (3:1); hold it to the
           stricter 4.5:1 so a pale yellow can't quietly slip through */
        expect(contrast(t.ink, t.bg), `${t.label} on ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("dark tiles are dark: no light pastel surface is left on a dark card", async ({ page }) => {
    await openAbout(page, "dark");
    for (const t of await measure(page, "#view-about .tech-logo")) {
      expect(lum(t.bg), `${t.label} tile background`).toBeLessThan(0.15);
    }
  });

  test("source links keep their contrast in the dark theme", async ({ page }) => {
    await openAbout(page, "dark");
    const chips = await measure(page, "#view-about .link-chip");
    expect(chips.length).toBeGreaterThanOrEqual(5);
    for (const c of chips) expect(contrast(c.ink, c.bg), c.label).toBeGreaterThanOrEqual(4.5);
  });

  test("the color coding survives: the tiles are not all one tone", async ({ page }) => {
    await openAbout(page, "light");
    const tones = await page
      .locator("#view-about .tech-logo")
      .evaluateAll((els) => new Set(els.map((el) => el.className.match(/tone-\w+/)[0])).size);
    expect(tones).toBeGreaterThanOrEqual(5);
  });
});

test.describe("decorative motion", () => {
  test("the About art animates normally, but quietly", async ({ page }) => {
    await openAbout(page, "light");
    const ring = page.locator("#view-about .art-ring").first();
    await expect(ring).toHaveCSS("animation-name", "ringSpin");
    /* slow: a full turn takes tens of seconds, never a spin */
    const seconds = await ring.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(seconds).toBeGreaterThanOrEqual(40);
  });

  test("prefers-reduced-motion switches the art off outright", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAbout(page, "light");
    for (const sel of [".art-ring", ".art-wicon"]) {
      const names = await page
        .locator(`#view-about ${sel}`)
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
      expect(names.length).toBeGreaterThan(0);
      /* "none", not merely a 0.01ms infinite loop */
      for (const name of names) expect(name).toBe("none");
    }
  });
});

test.describe("Home section headings", () => {
  test("share one scale, so the lower-priority sections do not out-shout the hourly forecast", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const size = (id) =>
      page.locator(`#${id}`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const hourly = await size("homeHourlyTitle");
    expect(await size("forecastTitle")).toBe(hourly);
    expect(await size("exploreTitle")).toBe(hourly);
  });
});

/* Small secondary text: labels, timestamps, status chips and attributions.
 *
 * These are the lines most likely to be set in a pale accent at 10–11px, and
 * the ones a glance at a design tool cannot judge, because their backdrop is a
 * translucent tint or a card. Each is measured against what is really behind
 * it: every ancestor background composited from the page down, as the eye
 * sees it. Text over a photograph is not measured this way — the credit chip
 * carries its own scrim, checked below. */
async function textContrast(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const rgba = (color) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] > 250) break;
      }
      let bg = [255, 255, 255];
      for (const c of layers.reverse()) {
        const a = c[3] / 255;
        bg = bg.map((v, i) => c[i] * a + v * (1 - a));
      }
      const fgRaw = rgba(getComputedStyle(el).color);
      const fa = fgRaw[3] / 255;
      const fg = bg.map((v, i) => fgRaw[i] * fa + v * (1 - fa));
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return {
        ratio: (hi + 0.05) / (lo + 0.05),
        size: parseFloat(getComputedStyle(el).fontSize),
        text: el.textContent.trim().slice(0, 30),
      };
    });
}

async function openThemed(page, path, theme, ready) {
  await installMocks(page);
  await page.addInitScript((t) => localStorage.setItem("ws_theme", t), theme);
  await page.goto(path);
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 20000 });
}

for (const theme of ["light", "dark"]) {
  test.describe(`small secondary text is readable in the ${theme} theme`, () => {
    test.describe.configure({ timeout: 60_000 });

    test("Home: the 'updated' status beside the metrics", async ({ page }) => {
      await openThemed(page, "/", theme, "#view-home .metrics-heading span");
      const m = await textContrast(page, "#view-home .metrics-heading span");
      expect(m.ratio, m.text).toBeGreaterThanOrEqual(4.5);
    });

    test("Forecast: the hourly rain and wind lines, including the 'now' cell", async ({ page }) => {
      await openThemed(page, "/#/forecast", theme, "#hourlyStrip .hour-cell");
      for (const sel of ["#hourlyStrip .h-rain", "#hourlyStrip .hour-cell.is-now .h-wind"]) {
        await expect(page.locator(sel).first()).toBeVisible();
        const m = await textContrast(page, sel);
        expect(m.ratio, `${sel} "${m.text}"`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test("Settings: the 'Current' provider badge", async ({ page }) => {
      await openThemed(page, "/#/settings", theme, ".set-provider-badge.is-live");
      const m = await textContrast(page, ".set-provider-badge.is-live");
      expect(m.ratio, m.text).toBeGreaterThanOrEqual(4.5);
    });

    test("Map panel: the stat labels and the hourly time labels", async ({ page }) => {
      await openThemed(page, "/#/map", theme, "#mapWeatherPanel .map-panel-stats dt");
      for (const sel of [
        "#mapWeatherPanel .map-panel-stats dt",
        "#mapWeatherPanel .map-hour > span",
      ]) {
        const m = await textContrast(page, sel);
        expect(m.ratio, `${sel} "${m.text}"`).toBeGreaterThanOrEqual(4.5);
        /* and not below the 11px floor the rest of the secondary text keeps */
        expect(m.size, sel).toBeGreaterThanOrEqual(11);
      }
    });
  });
}

test.describe("photo attribution chips", () => {
  /* Built in the page rather than found in it: which credit shows depends on
     which provider answered, but the rule is about the chip's own styling. */
  async function chipStyle(page, hostClass, chipClass) {
    return page.evaluate(
      ([host, chip]) => {
        const box = document.createElement("div");
        box.className = host;
        const a = document.createElement("a");
        a.className = chip;
        a.textContent = "Pexels ↗";
        box.appendChild(a);
        document.body.appendChild(box);
        const cs = getComputedStyle(a);
        const out = {
          size: parseFloat(cs.fontSize),
          scrim: Number((cs.backgroundColor.match(/[\d.]+/g) || [])[3] ?? 1),
        };
        box.remove();
        return out;
      },
      [hostClass, chipClass],
    );
  }

  test("are set at a readable size, on a scrim strong enough for any photo", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    /* the hero/map-panel chip, and the Explore card's variant of it */
    for (const [host, chip] of [
      ["loc-photo", "loc-credit"],
      ["explore-card", "loc-credit explore-credit"],
    ]) {
      const s = await chipStyle(page, host, chip);
      expect(s.size, chip).toBeGreaterThanOrEqual(11);
      /* white text over a bright sky needs the dark scrim; 0.38 left it at
         about 2.5:1, 0.72 holds 8:1 over pure white */
      expect(s.scrim, chip).toBeGreaterThanOrEqual(0.7);
    }
  });
});
