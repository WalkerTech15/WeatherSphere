/* The Clouds layer's lifecycle: whether it may be offered, what it puts on the
 * map, and how each way it can fail is reported. The map, the network and the
 * panel painter are stand-ins; the overlay module is the real one. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMap: vi.fn(async () => {}),
  paintClouds: vi.fn(),
  offline: false,
}));

vi.mock("./map-instance.js", () => ({ updateMap: mocks.updateMap }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-map-weather.js", () => ({
  renderWeatherOverlayUI: vi.fn(),
  updateTimeStatus: vi.fn(),
}));
vi.mock("../ui/render-map-clouds.js", () => ({
  renderCloudsUI: mocks.paintClouds,
  cloudsAnnouncement: (state) => `clouds ${state.status} ${state.errorKind ?? ""}`.trim(),
}));
vi.mock("../services/offline.js", () => ({ isOffline: () => mocks.offline }));

/* a MapLibre map that records what is added, removed and listened to */
function fakeMap() {
  const sources = new Map();
  const layers = [];
  const handlers = new Map();
  return {
    sources,
    layers,
    handlers,
    isStyleLoaded: () => true,
    getStyle: () => ({ layers: [{ id: "labels", type: "symbol" }] }),
    addSource: (id, spec) => sources.set(id, spec),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
    addLayer: (layer, before) => layers.push({ ...layer, before }),
    getLayer: (id) => layers.find((layer) => layer.id === id),
    removeLayer: (id) => layers.splice(0, layers.length, ...layers.filter((l) => l.id !== id)),
    moveLayer: vi.fn(),
    on: (event, handler) => handlers.set(event, handler),
    off: (event, handler) => handlers.get(event) === handler && handlers.delete(event),
  };
}

function cloudsButton() {
  const badge = { hidden: false };
  const attrs = { "aria-checked": "false" };
  return {
    dataset: { mapLayer: "clouds" },
    disabled: true,
    tabIndex: 0,
    badge,
    attrs,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute: (key, value) => (attrs[key] = value),
    getAttribute: (key) => attrs[key] ?? null,
    removeAttribute: (key) => delete attrs[key],
    querySelector: () => badge,
  };
}

let button;

async function load({ available = true } = {}) {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ available }) })),
  );
  const registry = await import("./map-registry.js");
  const overlay = await import("./map-overlay.js");
  const clouds = await import("./map-layer-clouds.js");
  const map = fakeMap();
  registry.MAPS.worldMap = { map };
  return { map, ...overlay, ...clouds, MAPS: registry.MAPS };
}

const painted = () => mocks.paintClouds.mock.lastCall?.[0];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.updateMap.mockReset().mockResolvedValue();
  mocks.paintClouds.mockClear();
  mocks.offline = false;
  button = cloudsButton();
  vi.stubGlobal("document", {
    querySelector: (selector) => {
      if (selector === "#mapLayerStatus") return { textContent: "" };
      return selector.includes('"clouds"') ? button : null;
    },
    querySelectorAll: (selector) => (selector === ".map-layer" ? [button] : []),
  });
  vi.stubGlobal("location", { origin: "https://weathersphere.example" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("whether the layer may be offered", () => {
  it("enables the button, drops its badge and gives it a name, once the proxy has a key", async () => {
    const { bindClouds } = await load({ available: true });
    bindClouds();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.attrs["aria-disabled"]).toBeUndefined();
    expect(button.badge.hidden).toBe(true);
    expect(button.dataset.i18nTip).toBe("tipLayerClouds");
    expect(button.tabIndex).toBe(-1); /* the checked layer keeps the Tab stop */
  });

  it("keeps it disabled, badged and explained when there is no key", async () => {
    const { bindClouds } = await load({ available: false });
    bindClouds();
    await vi.waitFor(() => expect(button.dataset.i18nTip).toBe("tipLayerCloudsUnavailable"));
    expect(button.disabled).toBe(true);
    expect(button.attrs["aria-disabled"]).toBe("true");
    expect(button.badge.hidden).toBe(false);
  });

  it("asks the proxy once, however many times the layer is chosen", async () => {
    const { bindClouds, setCloudsLayer } = await load({ available: true });
    bindClouds();
    await setCloudsLayer();
    await setCloudsLayer();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("what it puts on the map", () => {
  it("adds the proxy's raster tiles under the labels, credited to OpenWeatherMap", async () => {
    const { map, setCloudsLayer, getMapOverlayState } = await load();
    await setCloudsLayer();
    const source = map.getSource("openweather-clouds");
    expect(source.type).toBe("raster");
    expect(source.tiles).toEqual([
      "https://weathersphere.example/api/openweather-clouds?z={z}&x={x}&y={y}",
    ]);
    expect(source.tileSize).toBe(256);
    expect(source.attribution).toContain("https://openweathermap.org");
    expect(source.attribution).toContain("OpenWeatherMap");
    expect(source.attribution).toContain("noopener");
    expect(map.layers).toEqual([expect.objectContaining({ type: "raster", before: "labels" })]);
    expect(getMapOverlayState().type).toBe("clouds");
    expect(painted().status).toBe("loading");
  });

  it("never names OpenWeatherMap's own host or carries a key", async () => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    const spec = JSON.stringify(map.getSource("openweather-clouds"));
    expect(spec).not.toMatch(/tile\.openweathermap\.org|appid/i);
  });

  it("is ready once its source has loaded, and stays ready past the timeout", async () => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    map.handlers.get("sourcedata")({ sourceId: "openweather-clouds", isSourceLoaded: false });
    expect(painted().status).toBe("loading");
    map.handlers.get("sourcedata")({ sourceId: "other", isSourceLoaded: true });
    expect(painted().status).toBe("loading");
    map.handlers.get("sourcedata")({ sourceId: "openweather-clouds", isSourceLoaded: true });
    expect(painted().status).toBe("ready");
    vi.advanceTimersByTime(60000);
    expect(painted().status).toBe("ready");
    expect(button.attrs["aria-checked"]).toBe("true");
  });
});

describe("every way it can fail is reported, and nothing is drawn in its place", () => {
  const fail = (map, status, sourceId = "openweather-clouds") =>
    map.handlers.get("error")({ sourceId, error: { status } });

  it.each([
    [401, "unavailable", true],
    [403, "unavailable", true],
    [503, "unavailable", true],
    [429, "rate_limited", true],
    [504, "timeout", false],
    [502, "http", false],
    [undefined, "network", false],
  ])("a tile answered %s is %s (layer dropped: %s)", async (status, kind, dropped) => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    fail(map, status);
    expect(painted()).toMatchObject({ status: "error", errorKind: kind });
    expect(map.layers.length).toBe(dropped ? 0 : 1);
    expect(map.getSource("openweather-clouds") === undefined).toBe(dropped);
  });

  it("reports only the first failure", async () => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    fail(map, 502);
    fail(map, 429);
    expect(painted().errorKind).toBe("http");
  });

  it("ignores a failure from some other source", async () => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    fail(map, 503, "basemap");
    expect(painted().status).toBe("loading");
  });

  it("ends in a timeout, and drops the layer, when no tile ever answers", async () => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    vi.advanceTimersByTime(11999);
    expect(painted().status).toBe("loading");
    vi.advanceTimersByTime(1);
    expect(painted()).toMatchObject({ status: "error", errorKind: "timeout" });
    expect(map.layers).toEqual([]);
  });

  it("is unavailable, without touching the map, when the proxy has no key", async () => {
    const { map, setCloudsLayer } = await load({ available: false });
    await setCloudsLayer();
    expect(painted()).toMatchObject({ status: "error", errorKind: "unavailable" });
    expect(map.sources.size).toBe(0);
    expect(mocks.updateMap).not.toHaveBeenCalled();
  });

  it("is offline, without touching the map, when the browser is offline", async () => {
    mocks.offline = true;
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    expect(painted()).toMatchObject({ status: "error", errorKind: "offline" });
    expect(map.sources.size).toBe(0);
  });

  it("reports a map that would not load as a network failure", async () => {
    mocks.updateMap.mockRejectedValue(new Error("no map"));
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    expect(painted()).toMatchObject({ status: "error", errorKind: "network" });
    expect(map.handlers.size).toBe(0);
  });

  it("does not report a failure after the layer was left", async () => {
    const { map, setCloudsLayer, resetOverlay } = await load();
    await setCloudsLayer();
    const onError = map.handlers.get("error");
    resetOverlay("rain");
    onError({ sourceId: "openweather-clouds", error: { status: 503 } });
    expect(painted().status).toBe("idle");
  });
});

describe("leaving and re-choosing", () => {
  it("removes its tiles, its listeners and its timer when another layer is chosen", async () => {
    const { map, setCloudsLayer, resetOverlay } = await load();
    await setCloudsLayer();
    expect(map.handlers.size).toBe(2);
    resetOverlay("wind");
    expect(map.layers).toEqual([]);
    expect(map.sources.size).toBe(0);
    expect(map.handlers.size).toBe(0);
    vi.advanceTimersByTime(60000); /* a timer left behind would fire now */
    expect(painted().status).toBe("idle");
  });

  it("starts afresh, with one source and one set of listeners, when chosen again", async () => {
    const { map, setCloudsLayer } = await load();
    await setCloudsLayer();
    await setCloudsLayer();
    expect(map.sources.size).toBe(1);
    expect(map.layers).toHaveLength(1);
    expect(map.handlers.size).toBe(2);
  });

  it("adds nothing when another layer was chosen while it was still starting", async () => {
    const { map, setCloudsLayer, startLayerRequest } = await load();
    const pending = setCloudsLayer();
    startLayerRequest(); /* the visitor picked something else */
    await pending;
    expect(map.sources.size).toBe(0);
  });
});
