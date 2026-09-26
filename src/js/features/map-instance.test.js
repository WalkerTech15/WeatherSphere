/* Creating a map and keeping it on the selected place. The SDK is a stand-in
 * that counts what is built, so the point is the rules around it: one
 * instance per container however many callers ask, a fly-to only for a new
 * place, and an honest error when there is no key or the SDK fails. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PARIS, TARBES } from "./map-layer-harness.js";

const sdk = vi.hoisted(() => ({
  built: [],
  loadMapLibre: vi.fn(),
  key: "test-key",
}));

vi.mock("../ui/navigation.js", () => ({ switchView: vi.fn() }));
vi.mock("../core/config.js", () => ({
  get MAPTILER_KEY() {
    return sdk.key;
  },
  MAP_STYLE: "style.json",
}));
vi.mock("./map-sdk.js", () => ({
  loadMapLibre: (...args) => sdk.loadMapLibre(...args),
  whenMapNearViewport: () => Promise.resolve(),
  idle: () => Promise.resolve(),
}));

/* enough of MapLibre for createMapInstance and updateMap */
class FakeMap {
  constructor(options) {
    this.options = options;
    this.flights = [];
    this.handlers = {};
    this.keyboard = { disableRotation() {} };
    this.touchZoomRotate = { disableRotation() {} };
    sdk.built.push(this);
  }
  addControl() {}
  on(event, handler) {
    this.handlers[event] = handler;
  }
  once(event, handler) {
    this.handlers[`once:${event}`] = handler;
  }
  off() {}
  remove() {}
  resize() {}
  isStyleLoaded() {
    return true;
  }
  getStyle() {
    return { layers: [] };
  }
  getSource() {}
  addSource() {}
  addLayer() {}
  getCanvas() {
    return { setAttribute() {} };
  }
  getContainer() {
    return { querySelectorAll: () => [] };
  }
  cameraForBounds() {
    return null;
  }
  flyTo(options) {
    this.flights.push(options);
  }
}

class FakePopup {
  on() {}
  setHTML() {}
  isOpen() {
    return false;
  }
}

class FakeMarker {
  setLngLat(point) {
    this.point = point;
    return this;
  }
  setPopup() {
    return this;
  }
  addTo() {
    return this;
  }
  getElement() {
    return { querySelector: () => null };
  }
}

const maplibregl = {
  Map: FakeMap,
  Popup: FakePopup,
  Marker: FakeMarker,
  NavigationControl: class {},
};

function fakeContainer() {
  const classes = new Set(["is-loading"]);
  return {
    offsetWidth: 800,
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
    querySelector: () => null,
    innerHTML: "",
  };
}

/* a full place, as the search and the map both hand one over */
const city = (base) => ({
  ...base,
  kind: "city",
  region: { en: "Region", fr: "Région" },
  country: { en: "France", fr: "France" },
  cc: "FR",
});

let containers;

async function load() {
  vi.resetModules();
  const state = (await import("../core/state.js")).state;
  const registry = await import("./map-registry.js");
  const instance = await import("./map-instance.js");
  return { state, MAPS: registry.MAPS, ...instance };
}

beforeEach(() => {
  sdk.built.length = 0;
  sdk.key = "test-key";
  sdk.loadMapLibre.mockReset().mockResolvedValue(maplibregl);
  containers = { worldMap: fakeContainer(), homeMap: fakeContainer() };
  vi.stubGlobal("document", {
    querySelector: (selector) => containers[selector.slice(1)] ?? null,
    createElement: () => ({ className: "", setAttribute() {}, innerHTML: "" }),
  });
  vi.stubGlobal("requestAnimationFrame", (fn) => fn());
});

afterEach(() => vi.unstubAllGlobals());

describe("updateMap", () => {
  it("builds one map per container, even when several callers ask in the same tick", async () => {
    const { state, MAPS, updateMap } = await load();
    state.loc = city(PARIS);
    state.view = "map";
    await Promise.all([updateMap("worldMap"), updateMap("worldMap"), updateMap("worldMap")]);
    expect(sdk.built).toHaveLength(1);
    expect(sdk.loadMapLibre).toHaveBeenCalledTimes(1);
    expect(MAPS.worldMap.map).toBe(sdk.built[0]);
  });

  it("starts centred on the selection and keeps the map flat and north-up", async () => {
    const { state, updateMap } = await load();
    state.loc = city(PARIS);
    await updateMap("worldMap");
    const { options } = sdk.built[0];
    expect(options.center).toEqual([PARIS.lon, PARIS.lat]);
    expect(options).toMatchObject({ pitch: 0, bearing: 0, dragRotate: false, touchPitch: false });
    expect(options.locale["Map.Title"]).toBeTruthy();
  });

  it("flies to a new place once, and leaves the camera alone for the same place", async () => {
    const { state, MAPS, updateMap } = await load();
    state.loc = city(PARIS);
    await updateMap("worldMap");
    expect(MAPS.worldMap.map.flights).toHaveLength(1);
    expect(MAPS.worldMap.map.flights[0]).toMatchObject({
      center: [PARIS.lon, PARIS.lat],
      bearing: 0,
      pitch: 0,
    });
    await updateMap("worldMap"); /* a language or unit change */
    expect(MAPS.worldMap.map.flights).toHaveLength(1);
    state.loc = city(TARBES);
    await updateMap("worldMap");
    expect(MAPS.worldMap.map.flights).toHaveLength(2);
    expect(MAPS.worldMap.map.flights[1].center).toEqual([TARBES.lon, TARBES.lat]);
  });

  it("applies the CURRENT selection to a call that queued behind the creation", async () => {
    const { state, MAPS, updateMap } = await load();
    state.loc = city(PARIS);
    const first = updateMap("worldMap");
    state.loc = city(TARBES);
    const second = updateMap("worldMap");
    await Promise.all([first, second]);
    const flights = MAPS.worldMap.map.flights;
    expect(flights.map((f) => f.center)).toEqual([[TARBES.lon, TARBES.lat]]);
  });

  it("shows the offline notice, and builds nothing, when there is no key", async () => {
    sdk.key = "";
    const { state, MAPS, updateMap } = await load();
    state.loc = city(PARIS);
    await updateMap("worldMap");
    expect(sdk.built).toHaveLength(0);
    expect(MAPS.worldMap).toBeUndefined();
    expect(containers.worldMap.innerHTML).toContain("map-offline");
    expect(containers.worldMap.classes.has("is-loading")).toBe(false);
  });

  it("shows the notice when the SDK cannot be loaded, and can be retried", async () => {
    sdk.loadMapLibre.mockRejectedValueOnce(new Error("chunk failed"));
    const { state, MAPS, updateMap } = await load();
    state.loc = city(PARIS);
    await updateMap("worldMap");
    expect(containers.worldMap.innerHTML).toContain("map-offline");
    expect(MAPS.worldMap).toBeUndefined();
    containers.worldMap = fakeContainer();
    await updateMap("worldMap");
    expect(MAPS.worldMap).toBeDefined();
  });

  it("does not build a map for a container that is not on screen yet", async () => {
    const { state, updateMap } = await load();
    state.loc = city(PARIS);
    state.view = "home";
    containers.worldMap.offsetWidth = 0;
    await updateMap("worldMap");
    expect(sdk.built).toHaveLength(0);
  });

  it("removes a map whose style never loaded, and shows the notice", async () => {
    const { state, MAPS, updateMap } = await load();
    state.loc = city(PARIS);
    await updateMap("worldMap");
    const map = sdk.built[0];
    map.isStyleLoaded = () => false;
    map.handlers["once:error"]();
    expect(MAPS.worldMap).toBeUndefined();
    expect(containers.worldMap.innerHTML).toContain("map-offline");
  });

  it("reports the camera it settles on, for the shared link", async () => {
    const { state, updateMap } = await load();
    const bus = await import("../core/app-bus.js");
    const moved = vi.fn();
    bus.on("map:moved", moved);
    state.loc = city(PARIS);
    await updateMap("worldMap");
    const map = sdk.built[0];
    map.getCenter = () => ({ lat: 1, lng: 2 });
    map.getZoom = () => 7;
    map.handlers.moveend();
    expect(moved).toHaveBeenCalledWith({ id: "worldMap", lat: 1, lon: 2, zoom: 7 });
  });

  it("only the map page's map is one you can click to select", async () => {
    const { state, updateMap } = await load();
    state.loc = city(PARIS);
    state.view = "home";
    await updateMap("worldMap");
    await updateMap("homeMap");
    const [world, home] = sdk.built;
    expect(typeof world.handlers.click).toBe("function");
    expect(home.handlers.click).toBeUndefined();
  });
});
