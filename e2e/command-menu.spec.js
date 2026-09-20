/* The search field as a lightweight command menu: something to pick before
 * anything is typed, keyboard access from anywhere, and honest loading /
 * failure / no-result states.
 *
 * Network behaviour is steered per test by layering a route over installMocks:
 * `route.fallback()` hands the request on to the mock underneath, so a test can
 * delay or fail geocoding without re-implementing its fixtures. */
import { test, expect, installMocks, GEOCODE_LABEL } from "./mocks.js";

const input = (page) => page.locator("#searchInput");
const panel = (page) => page.locator("#searchPanel");
const status = (page) => page.locator("#searchStatus");
const options = (page) => page.locator("#searchResults [role=option]");
const groupLabels = (page) => page.locator("#searchResults .search-group-label");

async function openHome(page, { lang } = {}) {
  await installMocks(page);
  if (lang) await page.addInitScript((l) => localStorage.setItem("ws_lang", l), lang);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

/* Geocoding endpoints that can fail independently: MapTiler first, Open-Meteo
   as the keyless fallback the app tries next. */
const GEOCODERS = ["**://api.maptiler.com/geocoding/**", "**://geocoding-api.open-meteo.com/**"];
async function steerGeocoding(page, behaviour) {
  for (const pattern of GEOCODERS) {
    await page.route(pattern, async (route) => {
      const action = behaviour.current;
      if (action === "fail") return route.abort();
      if (action === "slow") await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fallback();
    });
  }
}

test.describe("the menu before you type", () => {
  test("focusing the empty field offers popular places, grouped and labelled", async ({ page }) => {
    await openHome(page);
    await input(page).focus();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator("#searchCombo")).toHaveAttribute("aria-expanded", "true");
    await expect(groupLabels(page).first()).toHaveText("Lieux populaires");
    expect(await options(page).count()).toBeGreaterThan(2);

    /* options live in a labelled group inside the listbox, so a screen reader
       announces the section before its rows */
    const group = page.locator('#searchResults [role="group"]').first();
    const labelId = await group.getAttribute("aria-labelledby");
    await expect(page.locator(`#${labelId}`)).toHaveText("Lieux populaires");
    await expect(page.locator("#searchResults")).toHaveAttribute("role", "listbox");
  });

  test("the headings follow the interface language", async ({ page }) => {
    await openHome(page, { lang: "en" });
    await input(page).focus();
    await expect(groupLabels(page).first()).toHaveText("Popular places");
  });

  test("favorites are offered, and a place is never listed twice", async ({ page }) => {
    await openHome(page);
    await page.locator("#heroFavBtn").click();
    await expect(page.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    await input(page).focus();
    await expect(groupLabels(page).first()).toHaveText("Favoris");
    const favourite = await page
      .locator("#searchResults .search-item .si-name")
      .first()
      .innerText();
    /* Paris is both pinned AND in the popular list — it must read once */
    const names = await page.locator("#searchResults .si-name").allInnerTexts();
    expect(names.filter((n) => n.trim() === favourite.trim())).toHaveLength(1);
  });

  test("recent searches appear first, but only once the visitor has opted in", async ({ page }) => {
    await openHome(page);
    /* opted out (the default): no Recent section, and nothing was stored */
    await input(page).focus();
    await expect(groupLabels(page).filter({ hasText: "Récents" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator(".switch[data-recents]").click();
    await expect(page.locator(".switch[data-recents]")).toHaveAttribute("aria-checked", "true");
    await page.locator('.side-item[data-view="home"]').click();

    await input(page).fill(GEOCODE_LABEL);
    await options(page).first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await input(page).fill("");
    await input(page).focus();
    await expect(groupLabels(page).first()).toHaveText("Récents");
    await expect(page.locator("#searchResults .si-name").first()).toContainText(GEOCODE_LABEL);
  });

  test("emptying the field returns to the menu instead of shutting the panel", async ({ page }) => {
    await openHome(page);
    await input(page).fill("Paris");
    await expect(options(page).first()).toBeVisible();
    await input(page).fill("");
    await expect(panel(page)).toBeVisible();
    await expect(groupLabels(page).first()).toBeVisible();
  });

  test("typing replaces the menu at once — no stale suggestion sits under a new query", async ({
    page,
  }) => {
    await openHome(page);
    const geocoding = { current: "slow" };
    await steerGeocoding(page, geocoding);
    await input(page).focus();
    await expect(groupLabels(page).first()).toBeVisible();

    await input(page).fill("zzzzunknown");
    /* the popular rows describe an earlier state and must be gone right away,
       even though the lookup is still in flight */
    await expect(groupLabels(page)).toHaveCount(0);
    await expect(options(page)).toHaveCount(0);
  });
});

test.describe("keyboard access", () => {
  test("Ctrl+K opens the menu from anywhere", async ({ page }) => {
    await openHome(page);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("Control+K");
    await expect(input(page)).toBeFocused();
    await expect(panel(page)).toBeVisible();
  });

  test("Cmd+K does the same", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("Meta+K");
    await expect(input(page)).toBeFocused();
    await expect(panel(page)).toBeVisible();
  });

  test("Ctrl+K inside the field selects what is there, so typing replaces it", async ({ page }) => {
    await openHome(page);
    await input(page).fill("Lyon");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("Nice");
    await expect(input(page)).toHaveValue("Nice");
  });

  test("the existing / shortcut still works, and types normally inside the field", async ({
    page,
  }) => {
    await openHome(page);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(input(page)).toBeFocused();
    /* a slash typed while already in the field is just a character */
    await page.keyboard.type("a/b");
    await expect(input(page)).toHaveValue("a/b");
  });

  test("the field advertises its shortcuts to assistive technology", async ({ page }) => {
    await openHome(page);
    const keys = await input(page).getAttribute("aria-keyshortcuts");
    expect(keys).toContain("Control+K");
    expect(keys).toContain("Meta+K");
  });

  test("Enter on an untouched menu selects nothing; arrow + Enter selects the row", async ({
    page,
  }) => {
    await openHome(page);
    const before = await page.locator("#heroCityName").innerText();
    await input(page).focus();
    await page.keyboard.press("Enter");
    /* an accidental Enter must not jump to the first recent/favorite/popular */
    await expect(panel(page)).toBeVisible();
    await expect(page.locator("#heroCityName")).toHaveText(before);

    await page.keyboard.press("ArrowDown");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    const activeId = await input(page).getAttribute("aria-activedescendant");
    expect(activeId).toBe("sr-0");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeHidden();
  });

  test("Tab leaves the field for the next control, not for the scrolling list", async ({
    page,
  }) => {
    await openHome(page);
    await input(page).focus();
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("Tab");
    /* Regression: with the menu open the list is tall enough to scroll, and
       Chromium makes a scrollable region a tab stop of its own — an invisible
       extra stop between the search field and the mode toggle. */
    await expect(page.locator("#searchResults")).not.toBeFocused();
    await expect(page.locator('#modeToggle button[data-mode="simple"]')).toBeFocused();
  });

  test("Escape closes the menu and releases focus", async ({ page }) => {
    await openHome(page);
    await input(page).focus();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(page.locator("#searchCombo")).toHaveAttribute("aria-expanded", "false");
    await expect(input(page)).not.toBeFocused();
  });

  test("the focused row has a visible focus indicator", async ({ page }) => {
    await openHome(page);
    await input(page).focus();
    await page.keyboard.press("ArrowDown");
    const row = options(page).first().locator(".search-item");
    /* Regression: aria-selected is on the <li>, so the old rule (keyed on the
       button) never matched and the arrowed-to row showed nothing at all —
       announced to a screen reader, invisible to everyone else. The outline is
       the immediate, colour-independent signal... */
    await expect(row).toHaveCSS("outline-style", "solid");
    await expect(row).toHaveCSS("outline-width", "2px");
    /* ...and the row is also tinted once its short transition has run */
    await expect
      .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");
    /* moving on removes it from the row left behind */
    await page.keyboard.press("ArrowDown");
    await expect(row).toHaveCSS("outline-style", "none");
  });

  test("a screen-reader-only live region reports how many suggestions there are", async ({
    page,
  }) => {
    await openHome(page, { lang: "en" });
    await input(page).focus();
    await expect(page.locator("#searchAnnounce")).toHaveText(/\d+ suggestions available/);
    await expect(page.locator("#searchAnnounce")).toHaveAttribute("aria-live", "polite");
  });
});

test.describe("loading, no result and failure", () => {
  test("says it is searching while the lookup is in flight, then shows results", async ({
    page,
  }) => {
    await openHome(page);
    const geocoding = { current: "slow" };
    await steerGeocoding(page, geocoding);
    await input(page).fill(GEOCODE_LABEL);
    await expect(status(page)).toContainText("Recherche en cours");
    await expect(status(page)).toHaveAttribute("role", "status");
    await expect(options(page).first()).toBeVisible({ timeout: 8000 });
    await expect(status(page)).toBeEmpty();
  });

  test("no result is a plain explanation, not an instruction that does nothing", async ({
    page,
  }) => {
    await openHome(page, { lang: "en" });
    await input(page).fill("zzzznonexistentplace9999");
    const empty = page.locator("#searchPanel .search-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No place matches");
    /* the old copy told people to "press Enter to search the world" — Enter
       never did that */
    await expect(empty).not.toContainText("press Enter");
    await expect(page.locator("#searchAnnounce")).toContainText("No place matches");
  });

  test("when search itself is down it says so — and offers a retry that works", async ({
    page,
  }) => {
    await openHome(page, { lang: "en" });
    const geocoding = { current: "fail" };
    await steerGeocoding(page, geocoding);

    await input(page).fill(GEOCODE_LABEL);
    await expect(status(page)).toContainText("Search is unavailable right now");
    /* "unavailable" is not "no match": the no-result message must not appear */
    await expect(page.locator("#searchPanel .search-empty")).toHaveCount(0);
    await expect(options(page)).toHaveCount(0);
    await expect(status(page).locator("button")).toHaveText("Try again");

    geocoding.current = "ok";
    await status(page).locator("button").click();
    await expect(options(page).first()).toBeVisible({ timeout: 8000 });
    await expect(status(page)).toBeEmpty();
  });

  test("when only online search is down, built-in places stay and the gap is explained", async ({
    page,
  }) => {
    await openHome(page, { lang: "en" });
    const geocoding = { current: "fail" };
    await steerGeocoding(page, geocoding);
    await input(page).fill("Paris");
    await expect(options(page).first()).toBeVisible();
    await expect(status(page)).toContainText("Online search is unavailable");
    /* still usable: the built-in match can be chosen */
    await options(page).first().locator(".search-item").click();
    await expect(page.locator("#heroCityName")).toContainText("Paris");
  });

  test("the failure message follows the interface language", async ({ page }) => {
    await openHome(page, { lang: "fr" });
    const geocoding = { current: "fail" };
    await steerGeocoding(page, geocoding);
    await input(page).fill(GEOCODE_LABEL);
    await expect(status(page)).toContainText("La recherche est indisponible");
    await expect(status(page).locator("button")).toHaveText("Réessayer");
  });
});
