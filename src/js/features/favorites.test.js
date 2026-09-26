/* Favorites' batched weather: live values, an honest failure state (never
 * invented numbers), and the freshness rule that avoids refetching the same
 * list. */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";

vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-home.js", () => ({ renderHero: vi.fn() }));
vi.mock("../ui/render-favorites.js", () => ({ renderFavorites: vi.fn() }));
vi.mock("../ui/render-comparison.js", () => ({ refreshComparison: vi.fn() }));

import { state } from "../core/state.js";
import { FAVORITES_WEATHER_TTL_MS } from "../core/config.js";
import { batchEntry } from "../weather/open-meteo.fixtures.js";
import { renderFavorites } from "../ui/render-favorites.js";
import * as favorites from "./favorites.js";

const PARIS = { id: "paris", lat: 48.8566, lon: 2.3522, name: { en: "Paris" } };
const TOKYO = { id: "tokyo", lat: 35.6762, lon: 139.6503, name: { en: "Tokyo" } };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:34:00Z"));
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
});
afterAll(() => {
  vi.useRealTimers();
  globalThis.localStorage = originalStorage;
});
beforeEach(() => {
  state.favorites = [PARIS, TOKYO];
  renderFavorites.mockClear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/* The module keeps its last weather between calls, so the tests about a
   first load or a failure need a module of their own. */
async function fresh() {
  vi.resetModules();
  const { state: freshState } = await import("../core/state.js");
  freshState.favorites = [PARIS, TOKYO];
  const fav = await import("./favorites.js");
  const { renderFavorites: render } = await import("../ui/render-favorites.js");
  return { fav, render, state: freshState };
}

describe("loadFavWeather", () => {
  it("stores live values per favorite from one batched request", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await favorites.loadFavWeather(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain(
      "latitude=48.8566%2C35.6762&longitude=2.3522%2C139.6503",
    );
    expect(favorites.favWx).toEqual({
      paris: { temp: 20, code: 61, isDay: 1, humidity: 55, wind: 12, hi: 24, lo: 14 },
      tokyo: { temp: 30, code: 61, isDay: 1, humidity: 55, wind: 12, hi: 34, lo: 24 },
    });
    expect(renderFavorites).toHaveBeenCalledTimes(1);
  });

  it("reports a failure — no numbers — when the request throws", async () => {
    const { fav, render } = await fresh();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("error");
    expect(fav.favWx).toEqual({});
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("reports a failure on an HTTP error", async () => {
    const { fav } = await fresh();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("error");
    expect(fav.favWx).toEqual({});
  });

  it("keeps the favorites that have weather when one has none — no fake values for it", async () => {
    const { fav } = await fresh();
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20)]));
    await fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("ready");
    expect(fav.favWx.paris.temp).toBe(20);
    expect(fav.favWx.tokyo).toBeUndefined();
  });

  it("reports a failure when none of the favorites has weather", async () => {
    const { fav } = await fresh();
    globalThis.fetch = vi.fn(async () => ok([null, null]));
    await fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("error");
  });

  it("marks the state loading while a request is in flight, ready once it lands", async () => {
    const { fav } = await fresh();
    let answer;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const pending = fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("loading");
    answer(ok([batchEntry(20), batchEntry(30)]));
    await pending;
    expect(fav.favStatus).toBe("ready");
  });

  it("stamps the weather with the time it arrived", async () => {
    const { fav } = await fresh();
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await fav.loadFavWeather(true);
    expect(fav.favWxAt).toBe(Date.now());
  });

  it("a failure is not cached as fresh: the next visit tries again", async () => {
    const { fav } = await fresh();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await fav.loadFavWeather(true);
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await fav.loadFavWeather(); /* not forced */
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(fav.favStatus).toBe("ready");
  });

  it("a retry after a failure shows the loading state again at once", async () => {
    const { fav, render } = await fresh();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await fav.loadFavWeather(true);
    render.mockClear();
    let answer;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const retry = fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("loading");
    expect(render).toHaveBeenCalledTimes(1);
    answer(ok([batchEntry(20), batchEntry(30)]));
    await retry;
    expect(fav.favStatus).toBe("ready");
  });

  it("a failed refresh keeps the last real weather, and its real (old) timestamp", async () => {
    const { fav } = await fresh();
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await fav.loadFavWeather(true);
    const at = fav.favWxAt;
    vi.setSystemTime(Date.now() + 10 * 60000);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await fav.loadFavWeather(true);
    expect(fav.favStatus).toBe("error");
    expect(fav.favWx.paris.temp).toBe(20);
    expect(fav.favWxAt).toBe(at);
  });

  it("accepts the single-object response used for one favorite", async () => {
    state.favorites = [PARIS];
    globalThis.fetch = vi.fn(async () => ok(batchEntry(11)));
    await favorites.loadFavWeather(true);
    expect(favorites.favWx.paris.temp).toBe(11);
  });

  it("does nothing for an empty list", async () => {
    state.favorites = [];
    globalThis.fetch = vi.fn();
    await favorites.loadFavWeather(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips the request while the same list is still fresh, unless forced", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await favorites.loadFavWeather(true);
    await favorites.loadFavWeather();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await favorites.loadFavWeather(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches when the list changes or the TTL expires", async () => {
    globalThis.fetch = vi.fn(async () => ok([batchEntry(20), batchEntry(30)]));
    await favorites.loadFavWeather(true);
    state.favorites = [TOKYO, PARIS];
    await favorites.loadFavWeather();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + FAVORITES_WEATHER_TTL_MS + 1);
    await favorites.loadFavWeather();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("loadFavWeather — overlapping loads", () => {
  /* fetch answered by hand; rejects on abort like a real fetch */
  function controlledFetch() {
    const requests = [];
    globalThis.fetch = vi.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          requests.push({ url: String(url), signal, resolve });
        }),
    );
    return requests;
  }
  const places = (url) => new URL(url).searchParams.get("latitude").split(",").length;
  const answer = (req, temps) => req.resolve(ok(temps.map((t) => batchEntry(t))));

  it("opening Favorites while a star-toggle's load is in flight sends no second request", async () => {
    const requests = controlledFetch();
    const forced = favorites.loadFavWeather(true); /* the star toggle */
    const viewOpen = favorites.loadFavWeather(); /* the view opening right after */
    expect(requests).toHaveLength(1);
    answer(requests[0], [20, 30]);
    await Promise.all([forced, viewOpen]);
    expect(favorites.favWx.paris.temp).toBe(20);
    expect(renderFavorites).toHaveBeenCalledTimes(1);
  });

  it("a changed list cancels the older load, whose late answer is ignored", async () => {
    const requests = controlledFetch();
    state.favorites = [PARIS];
    const older = favorites.loadFavWeather(true);
    state.favorites = [PARIS, TOKYO];
    const newer = favorites.loadFavWeather(true);
    expect(requests[0].signal.aborted).toBe(true);
    expect(places(requests[1].url)).toBe(2);
    answer(requests[1], [21, 31]);
    await Promise.all([older, newer]);
    expect(favorites.favWx).toEqual({
      paris: { temp: 21, code: 61, isDay: 1, humidity: 55, wind: 12, hi: 25, lo: 15 },
      tokyo: { temp: 31, code: 61, isDay: 1, humidity: 55, wind: 12, hi: 35, lo: 25 },
    });
    /* the cancelled load neither rendered nor reported a failure */
    expect(renderFavorites).toHaveBeenCalledTimes(1);
  });

  it("a slow older answer cannot overwrite a newer list even if it arrives", async () => {
    const answers = [];
    globalThis.fetch = vi.fn(
      (url) => new Promise((resolve) => answers.push({ url: String(url), resolve })),
    );
    state.favorites = [PARIS];
    const older = favorites.loadFavWeather(true);
    state.favorites = [PARIS, TOKYO];
    const newer = favorites.loadFavWeather(true);
    answer(answers[1], [22, 32]);
    await newer;
    answer(answers[0], [99]); /* lands last */
    await older;
    expect(favorites.favWx.paris.temp).toBe(22);
    expect(favorites.favWx.tokyo.temp).toBe(32);
  });
});
