/* What an ocean or sea shows, and what it says about it.
 *
 * Open water has no "exact" photo: whatever Commons returns for it is an
 * astronaut's frame, a locator map or a stretch of coast — a general view of
 * that water. Two guarantees follow, both measured here:
 *   - a coordinate lookup near a shore must not surface an unrelated subject
 *     (a beach, a ship) as if it were the sea;
 *   - a photo that IS shown is labelled as an overview, in both languages,
 *     with the photographer and licence still attached, and the label does
 *     not follow the visitor to the next city.
 *
 * Reached the way a visitor reaches an unnamed ocean: by tapping the map, as
 * photo-provenance.spec.js does. That runs a real MapLibre context, so these
 * run one at a time within this file.
 */
import {
  test,
  expect,
  installMocks,
  json,
  wikimediaPhotoPage,
  GEOCODE_LABEL,
  CLICK_OCEAN,
} from "./mocks.js";

test.describe.configure({ mode: "default", timeout: 90_000 });

const panelPhoto = (page) => page.locator("#mapWeatherPanel .loc-photo");
const panelCredit = (page) => page.locator("#mapWeatherPanel .loc-credit");

/* Commons answers a coordinate lookup with whatever sits within 10 km. These
   are real titles returned for points off Sydney and Nice. */
const COASTAL = [
  { title: "Bondi Beach Aerial - panoramio", alt: "Bondi Beach Aerial" },
  { title: "Carguero rumbo a Melbourne - panoramio", alt: "Carguero rumbo a Melbourne" },
];
const ORBITAL = {
  title: "ISS053-E-398529 - View of Earth",
  alt: "View of Earth taken during ISS Expedition 53.",
  photographer: "NASA Johnson Space Center",
  license: "Public domain",
};

function geosearchOnly(candidates) {
  return (route) => {
    const generator = new URL(route.request().url()).searchParams.get("generator");
    if (generator !== "geosearch") return route.fulfill(json({ query: { pages: [] } }));
    const pages = candidates.flatMap((c) => wikimediaPhotoPage(c).query.pages);
    return route.fulfill(json({ query: { pages } }));
  };
}

const noGoogle = (route) => route.fulfill(json({ places: [] }));
const noMapillary = (route) => route.fulfill(json({ images: [] }));
const noPexels = (route) => route.fulfill(json({ photo: null, photos: [] }));

/* Tap the map at the centre of an ocean and wait for its panel. */
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
}

test.describe("an ocean never shows an unrelated landmark", () => {
  test("a beach and a ship from a coastal geosearch are not passed off as the sea", async ({
    page,
  }) => {
    await installMocks(page, {
      placesProxy: noGoogle,
      mapillaryProxy: noMapillary,
      photoProxy: noPexels,
      wikimediaProxy: geosearchOnly(COASTAL),
    });
    await tapOcean(page);

    /* the lookup has finished (the loading skeleton is cleared)… */
    await expect(panelPhoto(page)).not.toHaveClass(/loading/, { timeout: 20000 });
    /* …and it ended on the gradient fallback, not on Bondi Beach */
    await expect(panelPhoto(page)).not.toHaveClass(/has-photo/);
    await expect(panelCredit(page)).toHaveCount(0);
  });
});

test.describe("an ocean photo says it is an overview", () => {
  test("labels it, in French, without dropping the photographer or the licence", async ({
    page,
  }) => {
    await installMocks(page, {
      placesProxy: noGoogle,
      mapillaryProxy: noMapillary,
      photoProxy: noPexels,
      wikimediaProxy: geosearchOnly([...COASTAL, ORBITAL]),
    });
    await tapOcean(page);

    /* the unrelated candidates were skipped and the orbital view chosen */
    await expect(panelPhoto(page)).toHaveClass(/has-photo/, { timeout: 20000 });
    const credit = panelCredit(page);
    await expect(credit).toHaveAttribute("data-provenance", "overview");
    await expect(credit).toContainText("Vue d'ensemble");
    const label = await credit.getAttribute("aria-label");
    expect(label).toContain("Vue d'ensemble : Océan Atlantique");
    expect(label).toContain("pas cet endroit précis");
    /* attribution and licensing are intact */
    expect(label).toContain(ORBITAL.photographer);
    expect(label).toContain(ORBITAL.license);
    expect(label).toContain("Wikimedia Commons");
    await expect(credit).toHaveAttribute("href", /^https:\/\/commons\.wikimedia\.org\//);
    await expect(credit).toContainText("Wikimedia Commons");
  });

  test("and in English", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ws_lang", "en"));
    await installMocks(page, {
      placesProxy: noGoogle,
      mapillaryProxy: noMapillary,
      photoProxy: noPexels,
      wikimediaProxy: geosearchOnly([ORBITAL]),
    });
    await tapOcean(page);

    await expect(panelPhoto(page)).toHaveClass(/has-photo/, { timeout: 20000 });
    const credit = panelCredit(page);
    await expect(credit).toHaveAttribute("data-provenance", "overview");
    await expect(credit).toContainText("Overview");
    const label = await credit.getAttribute("aria-label");
    expect(label).toContain("Overview of Atlantic Ocean");
    expect(label).toContain("not this exact spot");
    expect(label).toContain(ORBITAL.photographer);
  });

  test("the label does not follow the visitor to the next city", async ({ page }) => {
    await installMocks(page, {
      placesProxy: noGoogle,
      mapillaryProxy: noMapillary,
      wikimediaProxy: geosearchOnly([ORBITAL]),
    });
    await tapOcean(page);
    await expect(panelCredit(page)).toHaveAttribute("data-provenance", "overview", {
      timeout: 20000,
    });

    /* move on to an ordinary city, straight away */
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroCard")).not.toContainText("Vue d'ensemble");
    await expect(page.locator('#heroCard [data-provenance="overview"]')).toHaveCount(0);
  });
});
