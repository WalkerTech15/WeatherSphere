/* The five photo labels, as a visitor meets them on representative places.
 *
 * Exact place photo / Nearby photo / Regional photo / Country photo /
 * Generic image — each on the image itself, each with the provider beside it,
 * each in both languages, and none of them able to pass for another. The
 * unit tests decide WHICH label a photo earns; this proves the label reaches
 * the page, fits every width, and keeps the provider's attribution readable. */
import {
  test,
  expect,
  installMocks,
  json,
  googlePlacesPayload,
  GOOGLE_PHOTO_URL,
  GOOGLE_CONTRIBUTOR,
  GEOCODE_LABEL,
  PEXELS_PHOTOGRAPHER,
} from "./mocks.js";

const credit = (page) => page.locator("#heroInner .loc-credit");
const slot = (page) => page.locator("#heroLandmark .loc-photo");

async function chooseFromSearch(page, text, { lang = "fr" } = {}) {
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  if (lang === "en") {
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
  }
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").fill(text);
  await expect(page.locator("#searchResults [role=option]").first()).toBeVisible();
  await page.keyboard.press("Enter");
}

/* A Google answer for the searched place, with a chosen contributor name. */
function placesProxy({ contributor = GOOGLE_CONTRIBUTOR, landmark = false } = {}) {
  return (route) => {
    const url = route.request().url();
    if (new URL(url).searchParams.get("photo")) {
      return route.fulfill(json({ photo: { src: GOOGLE_PHOTO_URL, width: 1280 } }));
    }
    const payload = googlePlacesPayload(url);
    payload.places[0].photo.attributions = [
      { name: contributor, uri: "https://maps.google.com/c/1" },
    ];
    if (landmark) {
      payload.places[0].name = "Hallgrímskirkja";
      payload.places[0].types = ["church", "tourist_attraction", "place_of_worship"];
    }
    return route.fulfill(json(payload));
  };
}

test.describe("Exact place photo", () => {
  test("a curated city's reviewed photo, with Pexels beside it — French then English", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/");
    await chooseFromSearch(page, "Tokyo");
    await expect(page.locator("#heroCityName")).toHaveText("Tokyo");
    await expect(slot(page)).toHaveAttribute("data-photo-confidence", "exact");
    await expect(credit(page)).toHaveText("Photo exacte du lieu · Pexels ↗");
    await expect(credit(page)).toHaveAttribute("data-provenance", "exact");
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(credit(page)).toHaveText("Exact place photo · Pexels ↗");
    await expect(credit(page)).toHaveAttribute(
      "aria-label",
      `Exact place photo — Photo by ${PEXELS_PHOTOGRAPHER} on Pexels`,
    );
  });

  test("Google's photo of the place names its contributor beside the label", async ({ page }) => {
    await installMocks(page, { placesProxy: placesProxy() });
    await page.goto("/");
    await chooseFromSearch(page, GEOCODE_LABEL, { lang: "en" });
    await expect(credit(page)).toHaveText(`Exact place photo · ${GOOGLE_CONTRIBUTOR} · Google ↗`);
    await expect(credit(page)).toHaveAttribute("data-provider", "google");
    await expect(slot(page)).toHaveAttribute("data-photo-confidence", "exact");
  });
});

test.describe("Nearby photo", () => {
  test("a landmark standing in the place says so, in both languages", async ({ page }) => {
    await installMocks(page, {
      placesProxy: placesProxy({ landmark: true }),
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
    });
    await page.goto("/");
    await chooseFromSearch(page, GEOCODE_LABEL);
    await expect(slot(page)).toHaveAttribute("data-photo-confidence", "nearby");
    await expect(credit(page)).toContainText("Photo à proximité ·");
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(credit(page)).toContainText("Nearby photo ·");
  });
});

test.describe("Regional photo", () => {
  test("a curated state shows its landmark as the region's photo, never as the state itself", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/");
    await chooseFromSearch(page, "Texas");
    await expect(page.locator("#heroCityName")).toHaveText("Texas");
    await expect(slot(page)).toHaveAttribute("data-photo-confidence", "regional");
    await expect(credit(page)).toHaveText("Photo régionale · Pexels ↗");
    await expect(credit(page)).toHaveAttribute("data-provenance", "regional");
    /* the full sentence says WHICH landmark, and that it is not the place itself */
    await expect(credit(page)).toHaveAttribute(
      "aria-label",
      `Photo de Fort Alamo, et non du lieu lui-même — Photo de ${PEXELS_PHOTOGRAPHER} sur Pexels`,
    );
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(credit(page)).toHaveText("Regional photo · Pexels ↗");
    await expect(credit(page)).toHaveAttribute(
      "aria-label",
      `Photo of The Alamo, not of this place itself — Photo by ${PEXELS_PHOTOGRAPHER} on Pexels`,
    );
  });

  test("a curated city is not downgraded: it stays an exact photo", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await chooseFromSearch(page, "Sydney");
    await expect(slot(page)).toHaveAttribute("data-photo-confidence", "exact");
  });
});

test.describe("Country photo and Generic image", () => {
  test("a country with only a stock photo is labelled generic, never exact", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await chooseFromSearch(page, "France");
    await expect(page.locator("#heroCityName")).toContainText("France");
    await expect(slot(page)).toHaveAttribute("data-photo-confidence", "generic");
    await expect(credit(page)).toHaveText("Image générique · Pexels ↗");
    await expect(credit(page)).not.toContainText("exacte");
  });
});

test.describe("the longer label fits every layout", () => {
  const LONG_NAME = "Alexandria Montgomery-Featherstonehaugh Johnson";
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`${viewport.width}px: a long contributor name wraps inside the photo, in full`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await installMocks(page, { placesProxy: placesProxy({ contributor: LONG_NAME }) });
      await page.goto("/");
      await chooseFromSearch(page, GEOCODE_LABEL);
      await expect(credit(page)).toBeVisible();
      /* Google requires the contributor to be visible, not truncated */
      await expect(credit(page)).toContainText(LONG_NAME);
      await expect(credit(page)).toContainText("Photo exacte du lieu");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const hero = await page.locator("#heroCard").boundingBox();
      const box = await credit(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(hero.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(hero.x + hero.width + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(hero.y + hero.height + 0.5);
      /* nothing inside is clipped: it wraps instead */
      const clipped = await credit(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped).toBe(false);
    });
  }
});
