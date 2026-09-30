/* Selecting "Tiếng Việt" translates the whole visible interface.
 *
 * Every view is read the way a visitor (and a screen reader) meets it — visible
 * text plus aria-label, title, placeholder, data-tip and alt — and anything that
 * still reads as English is reported: an exact English dictionary value, a
 * weather description or place name left in English, or a sentence built from
 * English function words. Vietnamese is compared with what English, French and
 * Spanish do, so none of those three moves.
 */
import { test, expect, installMocks, json } from "./mocks.js";
import { I18N } from "../src/js/data/translations.js";
import { WMO } from "../src/js/data/weather-codes.js";
import { PLACE_TEXT_VI } from "../src/js/data/place-text-vi.js";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/* ── what "still English" means ─────────────────────────────────────────── */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* English dictionary values that differ from their Vietnamese ones. A template
   ("Open {name}") becomes a pattern so the filled-in sentence is still caught. */
const ENGLISH_VALUES = Object.entries(I18N.en)
  .filter(([key, value]) => typeof value === "string" && value !== I18N.vi[key])
  .map(([, value]) => value.trim())
  .filter((value) => value.length >= 5);
const ENGLISH_EXACT = new Set(ENGLISH_VALUES.filter((value) => !value.includes("{")));
const ENGLISH_TEMPLATES = ENGLISH_VALUES.filter((value) => value.includes("{")).map(
  (value) =>
    new RegExp(
      `^${value
        .split(/\{[A-Za-z0-9]+\}/)
        .map(escapeRegExp)
        .join(".+?")}$`,
    ),
);
/* WMO descriptions and place names, in English, that Vietnamese spells differently */
const ENGLISH_WEATHER = new Set(
  Object.values(WMO)
    .filter((entry) => entry.en !== entry.vi)
    .map((entry) => entry.en),
);
const ENGLISH_PLACES = new Set(Object.keys(PLACE_TEXT_VI).filter((en) => en !== PLACE_TEXT_VI[en]));
const ENGLISH_DAYS = new Set([...I18N.en.days, ...I18N.en.daysShort.filter((d) => d.length > 3)]);
/* words that only English uses; a sentence containing one is not Vietnamese */
const ENGLISH_WORDS =
  /\b(the|and|your|with|for|from|this|that|are|you|not|has|have|will|can|could|please|try|again|loading|unavailable|available|failed|error|click|open|close|search|settings|favorites|forecast|weather|today|tomorrow|hourly|wind|rain|clouds|humidity|pressure|temperature|alerts|lightning|photo|nearby|country|city|region|update|updated|offline|online|source|sources|data|map|home|about|help|privacy|show|hide|clear|reset|save|saved|cancel|remove|add|added|removed|now|min|ago)\b/;
/* official provider names, in full — "National Weather Service" holds an English
   word but is a name, and stays as the provider writes it */
const PROVIDER_NAMES =
  /Saint-Pierre Weather|National Weather Service|MapTiler Weather|MapTiler SDK|OpenWeatherMap|Open-Meteo|open-meteo\.com|weather\.gov|Xweather|OpenStreetMap|Wikimedia Commons|BigDataCloud|Google Places/gi;
/* the Saint-Pierre Weather logo is set in two spans */
const LOGO_PARTS = /^(weather|sphere)$/i;
/* Answers the mocked providers give in English only (a real MapTiler answer
   carries text_vi): provider data, not interface text. */
const MOCK_PROVIDER_TEXT = new Set(["Capital Region"]);
/* brand, provider and technology names, and abbreviations, that are never translated */
const PROPER =
  /^(weathersphere|open-meteo|maptiler|maplibre|openstreetmap|openweathermap|xweather|nws|esri|pexels|unsplash|wikimedia|google|mapillary|bigdatacloud|vite|vitest|playwright|eslint|stylelint|prettier|html5|css3|javascript|php|svg|blog|pm2\.5|pm10|uv|hpa|km\/h|mph|mm|°c|°f|en|fr|es|vi)$/i;

function isEnglish(text) {
  const value = text.replace(/\s+/g, " ").trim().replace(PROVIDER_NAMES, "").trim();
  if (value.length < 2 || LOGO_PARTS.test(value) || MOCK_PROVIDER_TEXT.has(value)) return false;
  if (ENGLISH_EXACT.has(value) || ENGLISH_WEATHER.has(value) || ENGLISH_PLACES.has(value))
    return true;
  if (ENGLISH_DAYS.has(value)) return true;
  if (ENGLISH_TEMPLATES.some((pattern) => pattern.test(value))) return true;
  /* a sentence or label made of English function/UI words */
  const words = value.split(/[\s·—–,.:;|/()+↗→←↑↓!?"“”'’¿¡-]+/).filter(Boolean);
  if (words.every((word) => PROPER.test(word) || /^[\d%°.,+−-]+$/.test(word))) return false;
  return ENGLISH_WORDS.test(value.toLowerCase());
}

/* Visible strings of a subtree, plus the accessible names and hints around them. */
async function readText(page, rootSelector) {
  const found = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return { error: `no ${selector}` };
    const shown = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (node.hidden) return false;
      }
      return el.getClientRects().length > 0;
    };
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      const text = node.textContent.trim();
      if (text && shown(parent))
        out.push({ kind: "text", text, where: parent.className || parent.tagName });
    }
    for (const el of root.querySelectorAll(
      "[aria-label],[title],[placeholder],[data-tip],img[alt]",
    )) {
      if (!shown(el)) continue;
      /* a photo's own caption comes from the provider (Pexels, Commons), not from us */
      const skipAlt = el.classList.contains("loc-photo-img");
      for (const attr of ["aria-label", "title", "placeholder", "data-tip", "alt"]) {
        if (attr === "alt" && skipAlt) continue;
        const text = el.getAttribute(attr);
        if (text && text.trim())
          out.push({ kind: attr, text: text.trim(), where: el.className || el.tagName });
      }
    }
    return { out };
  }, rootSelector);
  if (found.error) throw new Error(found.error);
  return found.out;
}

async function leaks(page, rootSelector = "body") {
  const items = await readText(page, rootSelector);
  const seen = new Set();
  return items
    .filter(({ text }) => isEnglish(text))
    .map(
      ({ kind, text, where }) =>
        `${kind}: "${text.replace(/\s+/g, " ").slice(0, 90)}" (${String(where).slice(0, 40)})`,
    )
    .filter((line) => !seen.has(line) && seen.add(line));
}

/* ── driving the app ────────────────────────────────────────────────────── */

async function open(page, { lang = "vi", ...overrides } = {}) {
  await installMocks(page, overrides);
  await page.route("**://images.unsplash.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/gif", body: GIF }),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  /* only the first load: a reload must keep whatever the visitor chose */
  await page.addInitScript((code) => {
    if (!localStorage.getItem("ws_lang")) localStorage.setItem("ws_lang", code);
  }, lang);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  /* the hero is painted once the forecast has landed; scanning earlier reads a skeleton */
  await expect(page.locator("#heroInner .hero-temp")).toBeVisible();
  return errors;
}

/* Opens a view and waits until it is really showing: scanning a view that is
   still hidden would read nothing and call it clean. */
async function go(page, view) {
  await page.evaluate((name) => document.querySelector(`[data-view="${name}"]`).click(), view);
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

async function search(page, query) {
  if (!(await page.locator("#searchInput").isVisible())) {
    await page.locator("#mobileSearchBtn").click();
  }
  await page.locator("#searchInput").fill(query);
}

const VIEWS = [
  { view: "home", root: "#view-home" },
  { view: "map", root: "#view-map" },
  { view: "forecast", root: "#view-forecast" },
  { view: "favorites", root: "#view-favorites" },
  { view: "about", root: "#view-about" },
  { view: "settings", root: "#view-settings" },
];

test.describe("Tiếng Việt, the whole interface", () => {
  test("the language menu switches to Vietnamese and remembers it", async ({ page }) => {
    await open(page, { lang: "fr" });
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="vi"]').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page.locator("#langCode")).toHaveText("VI");
    await expect(page.locator('#langMenu button[data-lang="vi"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('#langMenu button[data-lang="fr"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.locator('.side-item[data-view="home"]')).toContainText("Trang chủ");
    await expect(page.locator('.side-item[data-view="map"]')).toContainText("Bản đồ");
    await expect(page.locator("#langBtn")).toHaveAttribute("aria-label", /Tiếng Việt/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page.locator('.side-item[data-view="favorites"]')).toContainText("Yêu thích");
  });

  for (const { view, root } of VIEWS) {
    test(`${view}: no English is left on screen`, async ({ page }) => {
      const errors = await open(page);
      await go(page, view);
      await expect(page.locator(root)).toBeVisible();
      await page.waitForTimeout(600);
      expect(await leaks(page, root)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("the header, sidebar and footer are Vietnamese on every view", async ({ page }) => {
    await open(page);
    for (const { view } of VIEWS) {
      await go(page, view);
      for (const selector of ["header", "aside, nav", "footer"]) {
        if ((await page.locator(selector).count()) === 0) continue;
        expect(await leaks(page, selector), `${view} › ${selector}`).toEqual([]);
      }
    }
  });
});

test.describe("the checker itself", () => {
  test("flags English on an English page, so a clean Vietnamese page means something", async ({
    page,
  }) => {
    await open(page, { lang: "en" });
    const found = await leaks(page, "#view-home");
    expect(found.length).toBeGreaterThan(10);
    await go(page, "settings");
    expect((await leaks(page, "#view-settings")).length).toBeGreaterThan(10);
  });

  test("flags a single English fallback hidden in Vietnamese", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      document
        .querySelector("#view-home")
        .insertAdjacentHTML(
          "beforeend",
          '<p id="planted">Weather unavailable</p><button id="planted2" aria-label="Open menu">x</button>',
        );
    });
    const found = await leaks(page, "#view-home");
    expect(found.some((line) => line.includes("Weather unavailable"))).toBe(true);
    expect(found.some((line) => line.includes("Open menu"))).toBe(true);
  });
});

test.describe("Tiếng Việt, search", () => {
  test("suggestions, results and the result kind are Vietnamese", async ({ page }) => {
    await open(page);
    await page.locator("#searchInput").focus();
    await expect(page.locator("#searchResults .search-item").first()).toBeVisible();
    expect(await leaks(page, "#searchWrap")).toEqual([]);

    await search(page, "Hà Nội");
    await expect(page.locator("#searchResults .search-item").first()).toContainText("Hà Nội");
    await expect(page.locator("#searchResults .si-kind").first()).toHaveText("Thành phố");
    await expect(page.locator("#searchStatus .map-panel-spinner")).toHaveCount(0);
    expect(await leaks(page, "#searchWrap")).toEqual([]);

    await search(page, "Đức");
    await expect(page.locator("#searchResults .search-item").first()).toContainText("Đức");
    await expect(page.locator("#searchResults .si-kind").first()).toHaveText("Quốc gia");
    expect(await leaks(page, "#searchWrap")).toEqual([]);
  });

  test("no result and a failed lookup say so in Vietnamese", async ({ page }) => {
    await open(page);
    await search(page, "zzzzqqqq");
    await expect(page.locator("#searchResults .search-empty")).toContainText(
      "Không tìm thấy địa điểm",
    );
    expect(await leaks(page, "#searchWrap")).toEqual([]);
  });

  test("choosing a place names it, its country and its landmark in Vietnamese", async ({
    page,
  }) => {
    await open(page);
    await search(page, "Hà Nội");
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText("Hà Nội");
    await expect(page.locator(".hero-region")).toContainText("Việt Nam");
    await expect(page.locator(".hero-loc-kicker")).toContainText("Thành phố");
    expect(await leaks(page, ".hero")).toEqual([]);
  });
});

test.describe("Tiếng Việt, weather, forecast and photos", () => {
  test("conditions, units and the date line are Vietnamese on Home", async ({ page }) => {
    await open(page);
    const text = await page.locator("#view-home").innerText();
    /* innerText follows CSS text-transform, so labels may arrive in capitals */
    expect(text).toMatch(/cảm giác như/i);
    expect(text).toMatch(/độ ẩm/i);
    expect(text).toMatch(/gió/i);
    expect(text).toMatch(/khả năng mưa/i);
    expect(text).toMatch(/dự báo 7 ngày/i);
    expect(text).toMatch(/cập nhật/i);
    await expect(page.locator(".hero-desc")).not.toHaveText(
      /^(Clear sky|Mainly clear|Partly cloudy|Overcast)$/,
    );
    /* the seven-day cards use Vietnamese day names */
    const days = await page.locator("#view-home .fc-day, #view-home .fc-name").allInnerTexts();
    for (const day of days)
      expect(/^(CN|T2|T3|T4|T5|T6|T7|Hôm nay)/.test(day.trim()), day).toBe(true);
  });

  test("the forecast page: hourly labels, summary, charts and air quality", async ({ page }) => {
    await open(page);
    await go(page, "forecast");
    await page.waitForTimeout(800);
    const hours = await page.locator("#hourlyStrip .h-time").allInnerTexts();
    expect(hours[0]).toBe("Bây giờ");
    for (const hour of hours.slice(1)) expect(hour, hour).toMatch(/^\d{1,2}:00$/);
    const view = await page.locator("#view-forecast").innerText();
    expect(view).toMatch(/Dự báo/);
    expect(view).toMatch(/Tóm tắt/);
    expect(await leaks(page, "#view-forecast")).toEqual([]);
    /* switching the chart metric keeps its labels Vietnamese */
    const tabs = page.locator("#view-forecast [data-chart], #view-forecast .chart-tab");
    if ((await tabs.count()) > 1) {
      await tabs.nth(1).click();
      expect(await leaks(page, "#view-forecast")).toEqual([]);
    }
  });

  test("a stock photo, its credit and its provenance label are Vietnamese", async ({ page }) => {
    await open(page);
    await search(page, "Reykjavik");
    await page.locator("#searchResults .search-item", { hasText: "Reykjavik" }).first().click();
    await expect(page.locator("#heroCityName")).toContainText("Reykjavik");
    const slot = page.locator("#heroLandmark .loc-photo");
    await expect(slot).toHaveClass(/has-photo/);
    const credit = page.locator(".hero .loc-credit");
    await expect(credit).toHaveCount(1);
    await expect(credit).toContainText("Pexels ↗");
    await expect(credit).toHaveAttribute("aria-label", /Ảnh/);
    await expect(credit).toHaveAttribute("aria-label", /Pexels/);
    expect(await leaks(page, ".hero")).toEqual([]);
  });

  test("Lourdes: curated photo, Unsplash credit, provenance and landmark in Vietnamese", async ({
    page,
  }) => {
    await open(page);
    await search(page, "Lourdes");
    await page.locator("#searchResults .search-item", { hasText: "Lourdes" }).first().click();
    await expect(page.locator("#heroCityName")).toContainText("Lourdes");
    await expect(page.locator("#heroLandmark .loc-photo")).toHaveClass(/has-photo/);
    const credit = page.locator(".hero .loc-credit");
    await expect(credit).toHaveText("Nick Castelli · Unsplash ↗");
    await expect(credit).toHaveAttribute(
      "aria-label",
      "Ảnh đúng địa điểm — Ảnh của Nick Castelli trên Unsplash",
    );
    await expect(page.locator(".hero-region")).toContainText("Đền thánh Đức Mẹ Lộ Đức");
    expect(await leaks(page, ".hero")).toEqual([]);
  });

  test("no photo: the fallback carries no English", async ({ page }) => {
    await open(page, { photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })) });
    await expect(page.locator("#heroLandmark .loc-photo")).not.toHaveClass(/loading/);
    expect(await leaks(page, ".hero")).toEqual([]);
  });
});

test.describe("Tiếng Việt, the map", () => {
  const LAYERS = [
    ["satellite", "Vệ tinh"],
    ["temperature", "Nhiệt độ"],
    ["rain", "Mưa"],
    ["wind", "Gió"],
    ["clouds", "Mây"],
    ["pressure", "Áp suất"],
    ["humidity", "Độ ẩm"],
    ["airQuality", "Chất lượng không khí"],
    ["alerts", "Cảnh báo"],
    ["lightning", "Sét"],
  ];

  test("every layer button is named in Vietnamese", async ({ page }) => {
    await open(page);
    await go(page, "map");
    await page.locator("#worldMap canvas").waitFor();
    for (const [layer, label] of LAYERS) {
      await expect(page.locator(`.map-layer[data-map-layer="${layer}"]`)).toContainText(label);
    }
    expect(await leaks(page, "#view-map")).toEqual([]);
  });

  test("selecting each layer keeps its legend, states and hints in Vietnamese", async ({
    page,
  }) => {
    await open(page);
    await go(page, "map");
    await page.locator("#worldMap canvas").waitFor();
    for (const [layer] of LAYERS) {
      const button = page.locator(`.map-layer[data-map-layer="${layer}"]`);
      if (await button.isDisabled()) {
        expect(await leaks(page, "#view-map"), `${layer} (unavailable)`).toEqual([]);
        continue;
      }
      await button.click();
      await page.waitForTimeout(900);
      expect(await leaks(page, "#view-map"), layer).toEqual([]);
    }
  });

  test("the forecast time buttons and the panel are Vietnamese", async ({ page }) => {
    await open(page);
    await go(page, "map");
    await page.locator("#worldMap canvas").waitFor();
    await page.locator('.map-layer[data-map-layer="temperature"]').click();
    await expect(page.locator('.map-time[data-map-time="0"]')).toContainText("Hiện tại");
    await page.locator('.map-time[data-map-time="6"]').click();
    await page.waitForTimeout(800);
    expect(await leaks(page, "#view-map")).toEqual([]);
    await expect(page.locator("#mapWeatherPanel .map-panel-photo")).toHaveCount(1);
  });
});

test.describe("Tiếng Việt, favorites, comparison and settings", () => {
  test("an empty favorites page and the add-a-place action are Vietnamese", async ({ page }) => {
    await open(page);
    await go(page, "favorites");
    await expect(page.locator("#view-favorites")).toContainText("Chưa có mục yêu thích");
    expect(await leaks(page, "#view-favorites")).toEqual([]);
  });

  test("saved places, cards, the list view and the comparison are Vietnamese", async ({ page }) => {
    await open(page);
    await page.locator("#heroFavBtn").click();
    await search(page, "Hà Nội");
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText("Hà Nội");
    await page.locator("#heroFavBtn").click();
    await go(page, "favorites");
    await expect(page.locator(".favx-card")).toHaveCount(2);
    await page.waitForTimeout(800);
    expect(await leaks(page, "#view-favorites")).toEqual([]);
    await page.locator('[data-favview="list"]').click();
    await page.waitForTimeout(500);
    expect(await leaks(page, "#view-favorites")).toEqual([]);
    await expect(page.locator("#favTable")).toContainText("Hà Nội");
  });

  test("settings: every control, description and toggle is Vietnamese", async ({ page }) => {
    await open(page);
    await go(page, "settings");
    await expect(page.locator("#view-settings")).toContainText("Ngôn ngữ");
    await expect(page.locator("#view-settings")).toContainText("Chế độ hiển thị");
    await expect(page.locator("#view-settings")).toContainText("Chi tiết");
    await expect(page.locator("#view-settings")).toContainText("Đơn giản");
    await expect(page.locator("#view-settings")).toContainText("Định dạng đồng hồ");
    expect(await leaks(page, "#view-settings")).toEqual([]);
  });

  test("Simple and Detailed modes are Vietnamese and both keep the page clean", async ({
    page,
  }) => {
    await open(page);
    await page
      .locator('#modeToggle [data-mode="simple"], #modeToggleSide [data-mode="simple"]')
      .first()
      .click();
    expect(await leaks(page, "#view-home")).toEqual([]);
    await page
      .locator('#modeToggle [data-mode="detailed"], #modeToggleSide [data-mode="detailed"]')
      .first()
      .click();
    expect(await leaks(page, "#view-home")).toEqual([]);
  });
});

test.describe("Tiếng Việt, toasts, dialogs and device location", () => {
  test("favouriting shows a Vietnamese toast, and removing offers Hoàn tác", async ({ page }) => {
    await open(page);
    await page.locator("#heroFavBtn").click();
    await expect(page.locator("#toast")).toContainText("Đã thêm vào yêu thích");
    expect(await leaks(page, "#toast")).toEqual([]);
    await go(page, "favorites");
    await page.locator(".favx-star").first().click();
    const dialog = page.locator("#confirmDialog");
    await expect(dialog).toContainText("Bỏ mục yêu thích?");
    await expect(dialog).toContainText("Paris");
    expect(await leaks(page, "#confirmDialog")).toEqual([]);
    await dialog.getByRole("button", { name: "Bỏ" }).click();
    await expect(page.locator("#toast")).toContainText("Đã bỏ khỏi yêu thích");
    await expect(page.locator("#toast .toast-action")).toHaveText("Hoàn tác");
    expect(await leaks(page, "#toast")).toEqual([]);
    await page.locator("#toast .toast-action").click();
    await expect(page.locator("#toast")).toBeHidden();
  });

  test("the hide-panel confirmation names its question and both buttons in Vietnamese", async ({
    page,
  }) => {
    await open(page);
    await go(page, "map");
    await page.locator("#mapPanelClose").click();
    const dialog = page.locator("#confirmDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Ẩn bảng thời tiết?");
    await expect(dialog).toContainText("Ẩn bảng");
    await expect(dialog).toContainText("Hủy");
    expect(await leaks(page, "#confirmDialog")).toEqual([]);
    await dialog.getByRole("button", { name: "Hủy" }).click();
    await expect(dialog).toBeHidden();
  });

  test("recent locations: the off, empty and clear states are Vietnamese", async ({ page }) => {
    await open(page);
    await go(page, "map");
    await expect(page.locator("#mapRecents")).toContainText("Địa điểm gần đây");
    await expect(page.locator("#mapRecents")).toContainText("đang tắt");
    expect(await leaks(page, "#mapRecents")).toEqual([]);
    await go(page, "settings");
    await page.locator(".switch[data-recents]").click();
    await go(page, "map");
    await expect(page.locator('#mapRecents [data-state="empty"]')).toContainText(
      "Chưa có địa điểm gần đây",
    );
    expect(await leaks(page, "#mapRecents")).toEqual([]);
  });

  test("the sidebar location card says what happened, in Vietnamese", async ({ page, context }) => {
    await open(page);
    await expect(page.locator("#sidePosBox")).toContainText("Vị trí của tôi");
    await expect(page.locator("#sidePosName")).toHaveText("Dùng vị trí hiện tại của tôi");
    expect(await leaks(page, "#sidePosBox")).toEqual([]);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 21.0278, longitude: 105.8342 });
    await page.locator("#sidePosBtn").click();
    await expect(page.locator("#sidePosWx")).not.toBeEmpty();
    expect(await leaks(page, "#sidePosBox")).toEqual([]);
  });
});

test.describe("Tiếng Việt, failure and empty states", () => {
  test("a failed forecast shows the demo-data notice in Vietnamese", async ({ page }) => {
    await open(page, { weatherStatus: 500 });
    await expect(page.locator("#view-home .wx-notice")).toContainText(/minh họa/i);
    await expect(page.locator("#view-home .wx-notice")).toContainText("Thử lại");
    expect(await leaks(page, "#view-home")).toEqual([]);
  });

  test("offline and provider errors on the map layers are Vietnamese", async ({ page }) => {
    await open(page, { weatherStatus: 500, nwsStatus: 500 });
    await go(page, "map");
    await page.locator("#worldMap canvas").waitFor();
    for (const layer of ["humidity", "airQuality", "alerts", "lightning"]) {
      const button = page.locator(`.map-layer[data-map-layer="${layer}"]`);
      if (await button.isDisabled()) continue;
      await button.click();
      await page.waitForTimeout(900);
      expect(await leaks(page, "#view-map"), layer).toEqual([]);
    }
  });
});

test.describe("Tiếng Việt, mobile, tablet and desktop", () => {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    test(`${width}px: Vietnamese fits, with no overflow and no clipped control`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width < 800 ? 800 : 900 });
      await open(page);
      for (const view of ["home", "favorites", "settings", "map"]) {
        await go(page, view);
        await page.waitForTimeout(400);
        const problems = await page.evaluate(() => {
          const out = [];
          if (document.documentElement.scrollWidth > window.innerWidth) {
            out.push(
              `page scrolls sideways by ${document.documentElement.scrollWidth - window.innerWidth}px`,
            );
          }
          const visible = (el) =>
            el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
          for (const el of document.querySelectorAll(
            ".set-tile, .seg-btn, .map-layer, .side-item, .btn-primary, .btn-ghost, .mode-btn, .lang-menu button, .map-time",
          )) {
            if (!visible(el)) continue;
            const style = getComputedStyle(el);
            const clips = ["hidden", "clip"].includes(style.overflowX);
            if (clips && el.scrollWidth > el.clientWidth + 1) {
              out.push(`clipped: "${el.textContent.trim().slice(0, 40)}" (${el.className})`);
            }
          }
          return out;
        });
        expect(problems, `${view} @ ${width}px`).toEqual([]);
      }
    });
  }

  test("the mobile drawer and search button carry Vietnamese names", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page);
    await expect(page.locator("#mobileSearchBtn")).toHaveAttribute(
      "aria-label",
      "Tìm một địa điểm",
    );
    const burger = page.locator('button[aria-label="Mở menu"]');
    await expect(burger).toBeVisible();
    await burger.click();
    await expect(page.locator('button[aria-label="Đóng menu"]').first()).toBeVisible();
    expect(await leaks(page, "aside, nav")).toEqual([]);
  });
});

test.describe("English, French and Spanish are unchanged", () => {
  for (const [lang, home, map] of [
    ["en", "Home", "Map"],
    ["fr", "Accueil", "Carte"],
    ["es", "Inicio", "Mapa"],
  ]) {
    test(`${lang}: the same labels, and nothing Vietnamese leaks in`, async ({ page }) => {
      await open(page, { lang });
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator('.side-item[data-view="home"]')).toContainText(home);
      await expect(page.locator('.side-item[data-view="map"]')).toContainText(map);
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/Trang chủ|Dự báo|Cài đặt|Yêu thích/);
      await go(page, "forecast");
      const hours = await page.locator("#hourlyStrip .h-time").allInnerTexts();
      expect(hours[0]).toBe(lang === "en" ? "Now" : lang === "fr" ? "Maint." : "Ahora");
    });
  }
});
