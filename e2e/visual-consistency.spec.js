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
