/* The phone widths the Pixel 5 project does not cover.
 *
 * playwright.config.js runs the mobile project at Pixel 5 (393 px). Real
 * phones sit both sides of it — 390 px (iPhone 12/13/14/15), 375 px (iPhone
 * SE, and every iPhone up to the 8), 360 px (most Android phones) and 320 px
 * (the smallest still in use) — and a layout that fits 393 can still overflow
 * or collide below it. Horizontal overflow on a phone is not a cosmetic
 * defect: it makes the page pan sideways under a thumb and pushes controls
 * off-screen, so it is checked on every view rather than only Home.
 *
 * Deliberately narrow in what it asserts: no horizontal overflow, the header
 * controls staying apart and tappable, and the Explore carousel still showing
 * that it scrolls. This is a guard against regressions at these widths, not a
 * second copy of the per-view specs.
 */
import { test, expect, installMocks } from "./mocks.js";

const VIEWS = ["home", "map", "forecast", "favorites", "settings", "about"];
const WIDTHS = [320, 360, 375, 390];

for (const width of WIDTHS) {
  test.describe(`layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } });

    test(`no view scrolls sideways at ${width}px`, async ({ page }) => {
      await installMocks(page);
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();

      for (const view of VIEWS) {
        /* Below the 900px breakpoint the sidebar is an off-canvas drawer, so
           each view is reached through the burger, exactly as a visitor does. */
        await page.locator("#burgerBtn").click();
        await page.locator(`.side-item[data-view="${view}"]`).click();
        /* Let any view-entry transition settle before measuring. */
        await page.waitForTimeout(250);

        const overflow = await page.evaluate((w) => {
          const doc = document.documentElement;
          /* The widest offender, so a failure names something actionable
             rather than just reporting the document is too wide. */
          let worst = { sel: "", right: 0 };
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            /* An element scrolled inside its own overflow container is fine —
               only what pushes the DOCUMENT wide counts. */
            if (r.right > worst.right) {
              worst = {
                sel:
                  el.tagName.toLowerCase() +
                  (el.className ? "." + String(el.className).split(" ")[0] : ""),
                right: Math.round(r.right),
              };
            }
          }
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, viewport: w, worst };
        }, width);

        expect(
          overflow.scrollWidth,
          `${view} at ${width}px overflows; widest element ${overflow.worst.sel} reaches ${overflow.worst.right}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    });

    /* The header is one row of 44px targets. At 320px it used to be padded
       twice (the bar's own gutter plus the inner row's), which left ~256px
       for ~287px of controls, so the mobile search button sat under the theme
       button: the page did not overflow, but part of the search icon could
       not be tapped. Page-level overflow cannot see that. */
    test(`the header controls do not overlap or leave the screen at ${width}px`, async ({
      page,
    }) => {
      await installMocks(page);
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();

      const boxes = await page.evaluate(() =>
        ["#burgerBtn", "#mobileSearchBtn", "#themeBtn", "#langBtn"].map((sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return { sel, left: r.left, right: r.right, width: r.width };
        }),
      );
      for (const b of boxes) {
        expect(b.width, `${b.sel} is visible`).toBeGreaterThan(0);
        expect(b.left, `${b.sel} inside the left edge`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${b.sel} inside the right edge`).toBeLessThanOrEqual(width);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          expect(overlap, `${a.sel} overlaps ${b.sel}`).toBeLessThanOrEqual(0);
        }
      }

      /* and the search button really receives the tap (Playwright's trial
         click fails when another element would intercept it) */
      await page.locator("#mobileSearchBtn").click({ trial: true });
    });

    /* The Explore row is a deliberate horizontal carousel. Nothing on screen
       says "swipe" except the next card being cut off at the edge, so that cut
       has to stay visible at every width, and the row has to stay a keyboard
       reachable scroll region. */
    test(`the Explore carousel shows that there is more at ${width}px`, async ({ page }) => {
      await installMocks(page);
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      const carousel = page.locator("#exploreCarousel");
      await carousel.scrollIntoViewIfNeeded();
      await expect(carousel.locator(".explore-card").nth(1)).toBeVisible();

      const geometry = await carousel.evaluate((el) => {
        const view = el.getBoundingClientRect();
        const second = el.querySelectorAll(".explore-card")[1].getBoundingClientRect();
        return {
          peek: Math.min(second.right, view.right) - second.left,
          secondWidth: second.width,
          scrolls: el.scrollWidth > el.clientWidth,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      /* a real sliver of the next card, but not the whole of it */
      expect(geometry.scrolls).toBe(true);
      expect(geometry.peek).toBeGreaterThanOrEqual(40);
      expect(geometry.peek).toBeLessThan(geometry.secondWidth);
      expect(geometry.docOverflow).toBeLessThanOrEqual(1);

      /* keyboard: the region takes focus and arrow keys scroll it */
      await carousel.focus();
      await expect(carousel).toBeFocused();
      const before = await carousel.evaluate((el) => el.scrollLeft);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => carousel.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    });
  });
}
