/* The image model's confidence, as the visitor meets it.
 *
 * Every hydrated photo slot records what its picture can be trusted to show
 * (data-photo-confidence: exact / nearby / regional / generic / none), and a
 * stock photo matched on words alone — Pexels — is labelled illustrative,
 * never shown as the place itself. Covered here: the label in both
 * languages and to a screen reader, the attribute for each outcome, the local
 * fallback when nothing is trustworthy, and that the longer label fits on a
 * phone without overflow or layout shift.
 */
import {
  test,
  expect,
  installMocks,
  json,
  googlePlacesPayload,
  GEOCODE_LABEL,
  GOOGLE_PHOTO_URL,
} from "./mocks.js";

const credit = (page) => page.locator("#heroInner .loc-credit");
const heroSlot = (page) => page.locator("#heroLandmark .loc-photo");

/* An instantly decodable image, like location-photos.spec.js uses: a fake
   images.pexels.com URL would be aborted by installMocks()'s catch-all. */
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PEXELS_PAGE = "https://www.pexels.com/photo/aerial-view-7/";

/* Pexels answers with a stock photo whose caption names the searched place. */
const illustrativePexels = (route) => {
  const query = new URL(route.request().url()).searchParams.get("query") || "";
  const photo = query.includes("Iceland")
    ? {
        src: { medium: PIXEL, large: PIXEL },
        photographer: "Stock Shooter",
        link: PEXELS_PAGE,
        alt: `Aerial view of ${GEOCODE_LABEL}, Iceland at sunset`,
      }
    : null;
  return route.fulfill(json({ photo, photos: photo ? [photo] : [] }));
};
const silentPexels = (route) => route.fulfill(json({ photo: null, photos: [] }));

function placesProxy({ landmark = false } = {}) {
  return (route) => {
    const url = route.request().url();
    if (new URL(url).searchParams.get("photo")) {
      return route.fulfill(json({ photo: { src: GOOGLE_PHOTO_URL, width: 1280 } }));
    }
    const payload = googlePlacesPayload(url);
    if (landmark) {
      payload.places[0].name = "Hallgrímskirkja";
      payload.places[0].types = ["church", "tourist_attraction", "place_of_worship"];
    }
    return route.fulfill(json(payload));
  };
}

async function openAndSearch(page, overrides, { lang = "fr" } = {}) {
  await installMocks(page, overrides);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  if (lang === "en") {
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
  }
  /* below 520px the field sits behind the mobile search button */
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").fill(GEOCODE_LABEL);
  await page.locator("#searchResults .search-item").first().click();
  await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);
}

test.describe("an illustrative stock photo is never passed off as the place", () => {
  test("is labelled on the image and to a screen reader, in French", async ({ page }) => {
    await openAndSearch(page, { photoProxy: illustrativePexels });
    await expect(heroSlot(page)).toHaveAttribute("data-photo-confidence", "generic");
    await expect(credit(page)).toHaveText("Image générique · Pexels ↗");
    await expect(credit(page)).toHaveAttribute(
      "aria-label",
      /^Image générique — lieu exact non vérifié — Photo de Stock Shooter sur Pexels$/,
    );
    /* attribution still links to the photo's own Pexels page */
    await expect(credit(page)).toHaveAttribute("href", PEXELS_PAGE);
    await expect(credit(page)).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("and in English", async ({ page }) => {
    await openAndSearch(page, { photoProxy: illustrativePexels }, { lang: "en" });
    await expect(heroSlot(page)).toHaveAttribute("data-photo-confidence", "generic");
    await expect(credit(page)).toHaveText("Generic image · Pexels ↗");
    await expect(credit(page)).toHaveAttribute(
      "aria-label",
      /^Generic image — not verified as this exact place — Photo by Stock Shooter on Pexels$/,
    );
  });

  test("the label follows a language switch after the photo is shown", async ({ page }) => {
    await openAndSearch(page, { photoProxy: illustrativePexels });
    await expect(credit(page)).toHaveText("Image générique · Pexels ↗");
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(credit(page)).toHaveText("Generic image · Pexels ↗");
  });
});

test.describe("every photo slot records what its picture can be trusted to show", () => {
  test("exact — the place's own Google photo", async ({ page }) => {
    await openAndSearch(page, { placesProxy: placesProxy() });
    await expect(heroSlot(page)).toHaveAttribute("data-photo-confidence", "exact");
    await expect(credit(page)).toHaveAttribute("data-provenance", "exact");
  });

  test("nearby — a landmark standing inside the place", async ({ page }) => {
    await openAndSearch(page, {
      placesProxy: placesProxy({ landmark: true }),
      photoProxy: silentPexels,
    });
    await expect(heroSlot(page)).toHaveAttribute("data-photo-confidence", "nearby");
  });

  test("none — nothing trustworthy, so the local visual stays", async ({ page }) => {
    await openAndSearch(page, { photoProxy: silentPexels });
    await expect(heroSlot(page)).toHaveAttribute("data-photo-confidence", "none");
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .loc-photo-fallback")).toBeVisible();
    await expect(credit(page)).toHaveCount(0);
  });

  test("a provider failure (429) also ends at 'none', never a broken page", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openAndSearch(page, {
      photoProxy: (route) => route.fulfill({ status: 429, body: "{}" }),
      placesProxy: (route) => route.fulfill({ status: 503, body: "{}" }),
    });
    await expect(heroSlot(page)).toHaveAttribute("data-photo-confidence", "none");
    await expect(page.locator(".hero-temp")).toHaveText(/\d/);
    expect(errors).toEqual([]);
  });
});

test.describe("the longer label fits every layout", () => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    test(`${viewport.width}px: no overflow, the credit stays on the photo, no shift`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!entry.hadRecentInput) window.__cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      await openAndSearch(page, { photoProxy: illustrativePexels });
      await expect(credit(page)).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const hero = await page.locator("#heroCard").boundingBox();
      const box = await credit(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(hero.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(hero.x + hero.width + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(hero.y + hero.height + 0.5);
      /* one line: the badge is a few words, never a wrapped sentence */
      expect(box.height).toBeLessThan(24);

      /* the photo swapped into a box that was already reserved */
      expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.02);
    });
  }
});
