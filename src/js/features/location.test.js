/* selectLocation(): the weather a selection ends up showing.
 *
 * Runs the REAL provider, cache and request stack against a stubbed fetch,
 * so these tests cover what a visitor sees when they change place quickly
 * or the network misbehaves: only the latest selection may write weather,
 * superseded requests are cancelled, and every failure other than a
 * cancellation falls back to demo weather exactly as before. */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";

const override = vi.hoisted(() => ({ fetchForecast: null }));

vi.mock("../core/i18n.js", () => ({ t: (key) => key }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-map.js", () => ({
  renderMapInfo: vi.fn(),
  renderRecentLocations: vi.fn(),
  resetMapSheet: vi.fn(),
}));
vi.mock("./map.js", () => ({ renderMap: vi.fn() }));
vi.mock("./geolocation.js", () => ({ renderSidePos: vi.fn() }));
vi.mock("../services/photo-api.js", () => ({ bumpPhotoToken: vi.fn(), prefetchLocPhoto: vi.fn() }));
vi.mock("../ui/render-home.js", () => ({
  renderHeroSkeleton: vi.fn(),
  renderHero: vi.fn(),
  renderMetrics: vi.fn(),
  renderGroupedMetrics: vi.fn(),
  renderForecast: vi.fn(),
  renderChartTabs: vi.fn(),
  renderChart: vi.fn(),
  renderInsights: vi.fn(),
  renderHomeHourly: vi.fn(),
}));
vi.mock("../ui/render-advisory.js", () => ({ renderAdvisory: vi.fn(), clearAdvisory: vi.fn() }));
vi.mock("../ui/render-weather-notice.js", () => ({
  renderWeatherNotice: vi.fn(),
  clearWeatherNotice: vi.fn(),
}));
vi.mock("../ui/render-ambient.js", () => ({ syncAmbient: vi.fn(), clearAmbient: vi.fn() }));
vi.mock("../ui/render-forecast.js", () => ({ renderHourly: vi.fn(), renderForecastPage: vi.fn() }));
/* Real provider, with a seam to swap in the (unavailable) school API. */
vi.mock("../weather/weather-provider.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchForecast: (...args) =>
      override.fetchForecast ? override.fetchForecast(...args) : actual.fetchForecast(...args),
  };
});

import { state } from "../core/state.js";
import { selectLocation } from "./location.js";
import { renderHero } from "../ui/render-home.js";
import { renderForecastPage } from "../ui/render-forecast.js";
import { showToast } from "../ui/notifications.js";
import { demoWeather } from "../weather/weather-demo.js";
import { __clearWeatherCachesForTests } from "../weather/weather-cache.js";
import * as schoolApi from "../weather/providers/school-api.js";
import { forecastPayload } from "../weather/open-meteo.fixtures.js";

const place = (id, lat, lon) => ({ id, kind: "city", lat, lon, name: { en: id, fr: id } });
const PARIS = place("paris", 48.8566, 2.3522);
const TOKYO = place("tokyo", 35.6762, 139.6503);
const LIMA = place("lima", -12.0464, -77.0428);

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const latOf = (url) => Number(new URL(url).searchParams.get("latitude"));
/* each place's forecast carries its own latitude as the temperature, so a
   test can tell whose weather ended up on screen */
const forecastFor = (url) => {
  const payload = forecastPayload();
  payload.current.temperature_2m = latOf(url);
  return payload;
};

/* A fetch whose answers the test releases by hand. Like a real fetch, it
   rejects with the signal's reason when its signal aborts. */
function controlledFetch() {
  const requests = [];
  globalThis.fetch = vi.fn(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        const entry = { url: String(url), signal, resolve, reject };
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        requests.push(entry);
      }),
  );
  const forecasts = () => requests.filter((r) => !r.url.includes("air-quality"));
  const release = (entry) =>
    entry.resolve(
      entry.url.includes("air-quality")
        ? ok({ current: { european_aqi: 40 } })
        : ok(forecastFor(entry.url)),
    );
  return { requests, forecasts, release };
}

const originalFetch = globalThis.fetch;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:34:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  __clearWeatherCachesForTests();
  override.fetchForecast = null;
  state.wx = null;
  state.isDemo = false;
  vi.clearAllMocks();
  /* the "could not load" toast is rate-limited to once a minute */
  vi.setSystemTime(Date.now() + 61_000);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
});

describe("rapid location changes", () => {
  it("shows only the last place and cancels the requests it replaced", async () => {
    const net = controlledFetch();
    const a = selectLocation(PARIS);
    const b = selectLocation(TOKYO);
    const c = selectLocation(LIMA);
    expect(net.forecasts()).toHaveLength(3);

    /* Paris and Tokyo were superseded: both their requests are aborted */
    expect(net.requests.filter((r) => r.signal.aborted)).toHaveLength(4);
    net.requests.filter((r) => !r.signal.aborted).forEach(net.release);
    await Promise.all([a, b, c]);

    expect(state.loc).toBe(LIMA);
    expect(state.wx.current.temp).toBe(LIMA.lat);
    expect(state.isDemo).toBe(false);
    expect(renderHero).toHaveBeenCalledTimes(1);
    /* a cancellation is not a failure: no demo data, no error toast */
    expect(showToast).not.toHaveBeenCalled();
  });

  it("never lets a slow earlier answer overwrite a newer place", async () => {
    /* a fetch that ignores cancellation — only the selection guard stands
       between Paris's late answer and the screen */
    const answers = [];
    globalThis.fetch = vi.fn(
      (url) => new Promise((resolve) => answers.push({ url: String(url), resolve })),
    );
    const a = selectLocation(PARIS);
    const b = selectLocation(TOKYO);
    const answer = (lat) =>
      answers
        .filter((x) => latOf(x.url) === lat)
        .forEach((x) => x.resolve(ok(x.url.includes("air-quality") ? {} : forecastFor(x.url))));

    answer(TOKYO.lat);
    await b;
    expect(state.wx.current.temp).toBe(TOKYO.lat);

    answer(PARIS.lat); /* lands last */
    await a;
    expect(state.loc).toBe(TOKYO);
    expect(state.wx.current.temp).toBe(TOKYO.lat);
    expect(renderHero).toHaveBeenCalledTimes(1);
  });

  it("joins the request already loading when the same place is selected again", async () => {
    const net = controlledFetch();
    const a = selectLocation(PARIS);
    const b = selectLocation(PARIS);
    expect(net.forecasts()).toHaveLength(1);
    expect(net.requests.some((r) => r.signal.aborted)).toBe(false);
    net.requests.forEach(net.release);
    await Promise.all([a, b]);
    expect(state.wx.current.temp).toBe(PARIS.lat);
  });

  it("reuses a cached forecast when returning to a place", async () => {
    const net = controlledFetch();
    const first = selectLocation(PARIS);
    net.requests.forEach(net.release);
    await first;
    const tokyo = selectLocation(TOKYO); /* left loading, then replaced */
    const again = selectLocation(PARIS);
    await Promise.all([tokyo, again]);
    expect(net.forecasts().filter((r) => latOf(r.url) === PARIS.lat)).toHaveLength(1);
    expect(state.wx.current.temp).toBe(PARIS.lat);
  });

  it("keeps air quality from an older place off the newer one", async () => {
    const net = controlledFetch();
    const a = selectLocation(PARIS);
    /* Paris's forecast lands, its air quality does not yet */
    net.requests.filter((r) => !r.url.includes("air-quality")).forEach(net.release);
    await a;
    const parisWx = state.wx;
    const b = selectLocation(TOKYO);
    net.requests
      .filter((r) => r.url.includes("air-quality") && latOf(r.url) === PARIS.lat)
      .forEach(net.release);
    net.requests.filter((r) => latOf(r.url) === TOKYO.lat).forEach(net.release);
    await b;
    await flush();
    expect(state.wx).not.toBe(parisWx);
    expect(state.wx.current.temp).toBe(TOKYO.lat);
  });
});

describe("failures still fall back to demo weather", () => {
  function expectDemo(loc) {
    expect(state.isDemo).toBe(true);
    const demo = demoWeather(loc);
    expect(state.wx.current.temp).toBe(demo.current.temp);
    expect(state.wx.timezone).toBe(demo.timezone);
    expect(showToast).toHaveBeenCalledWith("loadError");
    expect(renderHero).toHaveBeenCalledTimes(1);
  }

  const failWith = (fn) => {
    globalThis.fetch = vi.fn(async (url) => fn(String(url)));
  };

  it("on an HTTP error", async () => {
    failWith(() => ({ ok: false, status: 503, json: async () => ({}) }));
    await selectLocation(PARIS);
    expectDemo(PARIS);
  });

  it("on a malformed body", async () => {
    failWith((url) => ok(url.includes("air-quality") ? {} : { current: {} }));
    await selectLocation(PARIS);
    expectDemo(PARIS);
  });

  it("on a body that is not JSON", async () => {
    failWith(() => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    await selectLocation(PARIS);
    expectDemo(PARIS);
  });

  it("on a timeout", async () => {
    failWith(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await selectLocation(PARIS);
    expectDemo(PARIS);
  });

  it("while offline", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });
    failWith(() => {
      throw new TypeError("Failed to fetch");
    });
    await selectLocation(PARIS);
    expectDemo(PARIS);
  });

  it("when the provider is unavailable", async () => {
    override.fetchForecast = () => schoolApi.fetchForecast();
    globalThis.fetch = vi.fn();
    await selectLocation(PARIS);
    expectDemo(PARIS);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("retries the network on the next selection after a failure", async () => {
    failWith(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await selectLocation(PARIS);
    expect(state.isDemo).toBe(true);
    failWith((url) => ok(url.includes("air-quality") ? {} : forecastFor(url)));
    await selectLocation(PARIS);
    expect(state.isDemo).toBe(false);
    expect(state.wx.current.temp).toBe(PARIS.lat);
  });
});

describe("air quality", () => {
  it("fills in after the forecast and repaints the forecast page", async () => {
    const net = controlledFetch();
    const done = selectLocation(PARIS);
    net.forecasts().forEach(net.release);
    await done;
    expect(state.wx.current.aqi).toBeNull();
    net.requests.filter((r) => r.url.includes("air-quality")).forEach(net.release);
    await flush();
    expect(state.wx.current.aqi).toBe(40);
    expect(renderForecastPage).toHaveBeenCalled();
  });
});
