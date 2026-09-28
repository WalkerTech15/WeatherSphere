/* The favorites notification center (phase 1): official severe-weather
 * alerts across every saved place, surfaced as a topnav bell + dropdown
 * panel, plus a badge on the favorite card itself. Everything here reuses
 * the same verified NWS seam the map's Alerts layer already uses (see
 * mobile-map-alerts.spec.js) — New York (cc US) is covered, Paris (cc FR)
 * is not, which is exactly the mix needed to test "some favorites have no
 * official coverage" without inventing a second provider. */
import { test, expect, installMocks, nwsAlertFeature, nwsAlertsPayload } from "./mocks.js";
import { LOCATIONS } from "../src/js/data/locations.js";

const NEW_YORK = LOCATIONS.find((loc) => loc.id === "newyork");
const PARIS = LOCATIONS.find((loc) => loc.id === "paris");

async function seed(page, { favorites, lang = "en", offline = false } = {}) {
  await page.addInitScript(
    ([favs, language, isOffline]) => {
      localStorage.setItem("ws_lang", language);
      if (favs.length) localStorage.setItem("ws_favs", JSON.stringify(favs));
      if (isOffline) {
        Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      }
    },
    [favorites, lang, offline],
  );
}

const bell = (page) => page.locator("#notifBtn");
const badge = (page) => page.locator("#notifBadge");
const panel = (page) => page.locator("#notifPanel");
const panelBody = (page) => page.locator("#notifPanelBody");

async function openPanel(page) {
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
}

test.describe("Favorites notifications: bell + panel", () => {
  test("no favorites: the bell shows no badge and the panel says so", async ({ page }) => {
    await seed(page, { favorites: [] });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(badge(page)).toBeHidden();
    await openPanel(page);
    await expect(panelBody(page)).toContainText("Add a favorite");
  });

  test("a covered favorite with an active alert: badge, panel item, and card badge all agree", async ({
    page,
  }) => {
    await seed(page, { favorites: [NEW_YORK] });
    await installMocks(page, {
      nwsBody: nwsAlertsPayload([
        nwsAlertFeature({ event: "Tornado Warning", severity: "Extreme" }),
      ]),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(badge(page)).toBeVisible({ timeout: 15000 });
    await expect(badge(page)).toHaveText("1");

    await openPanel(page);
    const item = panelBody(page).locator(".notif-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Tornado Warning");
    await expect(item.locator(".notif-dot")).toHaveAttribute("data-tone", "severe");

    await page.locator('.side-item[data-view="favorites"]').click();
    const card = page.locator('.favx-card[data-fav-id="newyork"]');
    await expect(card.locator(".fav-alert-badge")).toContainText("Tornado Warning");
    await expect(card.locator(".fav-alert-badge")).toHaveAttribute("data-tone", "severe");
  });

  test("no favorite has official coverage: says so, never 'no alerts'", async ({ page }) => {
    await seed(page, { favorites: [PARIS] });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(badge(page)).toBeHidden();
    await openPanel(page);
    await expect(panelBody(page)).toContainText("No official alert coverage");
    await expect(panelBody(page)).not.toContainText("No active official alerts");
  });

  test("a mix of covered and uncovered favorites: only the covered one can notify", async ({
    page,
  }) => {
    await seed(page, { favorites: [PARIS, NEW_YORK] });
    await installMocks(page, {
      nwsBody: nwsAlertsPayload([nwsAlertFeature({ event: "Flash Flood Warning" })]),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(badge(page)).toHaveText("1", { timeout: 15000 });
    await openPanel(page);
    await expect(panelBody(page).locator(".notif-item")).toHaveCount(1);
    await expect(panelBody(page)).toContainText("Flash Flood Warning");
  });

  test("a covered favorite with no active alert: a real 'clear' answer, not silence", async ({
    page,
  }) => {
    await seed(page, { favorites: [NEW_YORK] });
    await installMocks(page); /* default nwsBody: an empty FeatureCollection */
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(badge(page)).toBeHidden();
    await openPanel(page);
    await expect(panelBody(page)).toContainText("No active official alerts");
  });

  test("offline: the panel says so instead of silently showing nothing", async ({ page }) => {
    await seed(page, { favorites: [NEW_YORK], offline: true });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await openPanel(page);
    await expect(panelBody(page)).toContainText("offline", { ignoreCase: true });
  });

  test("clicking a notification marks it read, opens the place, and lowers the badge", async ({
    page,
  }) => {
    await seed(page, { favorites: [PARIS, NEW_YORK] });
    await installMocks(page, {
      nwsBody: nwsAlertsPayload([nwsAlertFeature({ event: "Tornado Warning" })]),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(badge(page)).toHaveText("1", { timeout: 15000 });

    await openPanel(page);
    await panelBody(page).locator("[data-notif-open]").click();

    await expect(panel(page)).toBeHidden();
    await expect(page.locator("#heroCityName")).toContainText("New York");
    await expect(badge(page)).toBeHidden();
  });

  test("clear all empties the list after confirmation", async ({ page }) => {
    await seed(page, { favorites: [NEW_YORK] });
    await installMocks(page, {
      nwsBody: nwsAlertsPayload([nwsAlertFeature({ event: "Tornado Warning" })]),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(badge(page)).toBeVisible({ timeout: 15000 });

    await openPanel(page);
    await page.locator("#notifClearAll").click();
    await page.locator("#confirmDialogConfirm").click();

    await expect(badge(page)).toBeHidden();
    await expect(panelBody(page)).toContainText("No active official alerts");
  });

  test("keyboard: the bell is reachable and Escape closes the open panel", async ({ page }) => {
    await seed(page, { favorites: [NEW_YORK] });
    await installMocks(page, {
      nwsBody: nwsAlertsPayload([nwsAlertFeature({ event: "Tornado Warning" })]),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(badge(page)).toBeVisible({ timeout: 15000 });

    await bell(page).focus();
    await bell(page).press("Enter");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });

  test("outside click closes the panel", async ({ page }) => {
    await seed(page, { favorites: [NEW_YORK] });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await openPanel(page);
    await page.locator("#heroCityName").click();
    await expect(panel(page)).toBeHidden();
  });

  test("notifications survive a reload (persisted, not re-fetched as new)", async ({ page }) => {
    await seed(page, { favorites: [NEW_YORK] });
    await installMocks(page, {
      nwsBody: nwsAlertsPayload([nwsAlertFeature({ event: "Tornado Warning" })]),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(badge(page)).toBeVisible({ timeout: 15000 });

    await openPanel(page);
    await panelBody(page).locator("[data-notif-open]").click();
    await expect(badge(page)).toBeHidden();

    await page.reload();
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    /* still read after reload — reappearing unread would be a duplicate
       notification for the same, unchanged alert instance */
    await expect(badge(page)).toBeHidden();
  });

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    test(`${width}px: the bell and panel fit without page overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await seed(page, { favorites: [NEW_YORK] });
      await installMocks(page, {
        nwsBody: nwsAlertsPayload([nwsAlertFeature({ event: "Tornado Warning" })]),
      });
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      await expect(badge(page)).toBeVisible({ timeout: 15000 });

      await openPanel(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await panel(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    });
  }
});
