/* The "you are here" dot. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./map-sdk.js", () => ({
  loadMapLibre: () => Promise.resolve({ Marker: FakeMarker }),
}));

class FakeMarker {
  constructor() {
    this.position = null;
  }
  setLngLat(lngLat) {
    this.position = lngLat;
    return this;
  }
  addTo() {
    return this;
  }
}

/* just enough of a MapLibre map to record what gets drawn */
function fakeMap({ loaded = true } = {}) {
  const sources = new Map();
  const map = {
    layers: [],
    idleHandlers: [],
    isStyleLoaded: () => loaded,
    getSource: (id) => sources.get(id),
    addSource: (id, spec) =>
      sources.set(id, {
        spec,
        setData(data) {
          this.spec.data = data;
        },
      }),
    addLayer: (layer) => map.layers.push(layer.id),
    once: (event, handler) => map.idleHandlers.push([event, handler]),
  };
  return map;
}

async function loadModule() {
  vi.resetModules();
  const registry = await import("./map-registry.js");
  const mod = await import("./map-user-location.js");
  return { ...mod, MAPS: registry.MAPS };
}

const distanceMeters = (from, [lon, lat]) => {
  const rad = Math.PI / 180;
  const dLat = (lat - from.lat) * rad * 6378137;
  const dLon = (lon - from.lon) * rad * 6378137 * Math.cos(from.lat * rad);
  return Math.hypot(dLat, dLon);
};

describe("circlePolygon", () => {
  it("is a closed ring of the requested radius around the point", async () => {
    const { circlePolygon } = await loadModule();
    const feature = circlePolygon(2.35, 48.85, 500);
    const ring = feature.geometry.coordinates[0];
    expect(feature.geometry.type).toBe("Polygon");
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const point of ring) {
      expect(distanceMeters({ lat: 48.85, lon: 2.35 }, point)).toBeGreaterThan(495);
      expect(distanceMeters({ lat: 48.85, lon: 2.35 }, point)).toBeLessThan(505);
    }
  });

  it("scales longitude by latitude, so the ring stays round away from the equator", async () => {
    const { circlePolygon } = await loadModule();
    const ring = circlePolygon(0, 60, 1000).geometry.coordinates[0];
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    const widthDeg = Math.max(...lons) - Math.min(...lons);
    const heightDeg = Math.max(...lats) - Math.min(...lats);
    expect(widthDeg / heightDeg).toBeCloseTo(2, 1); /* 1 / cos(60°) */
  });
});

describe("showUserLocation and applyRememberedUserLocation", () => {
  let module;
  beforeEach(async () => {
    /* the dot is a real element; only its creation is needed here */
    vi.stubGlobal("document", { createElement: () => ({ className: "", innerHTML: "" }) });
    module = await loadModule();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("draws nothing for a map created before any fix", () => {
    const map = fakeMap();
    module.applyRememberedUserLocation({ map, userMarker: null });
    expect(map.layers).toEqual([]);
  });

  it("draws the accuracy circle on every live map", () => {
    const a = fakeMap();
    const b = fakeMap();
    module.MAPS.worldMap = { map: a };
    module.MAPS.homeMap = { map: b };
    module.showUserLocation(48.85, 2.35, 30);
    expect(a.layers).toEqual(["userAccFill", "userAccLine"]);
    expect(b.layers).toEqual(["userAccFill", "userAccLine"]);
  });

  it("keeps at least a 20 m circle for a very precise fix", () => {
    const map = fakeMap();
    module.MAPS.worldMap = { map };
    module.showUserLocation(48.85, 2.35, 3);
    const ring = map.getSource("userAcc").spec.data.geometry.coordinates[0];
    expect(distanceMeters({ lat: 48.85, lon: 2.35 }, ring[0])).toBeGreaterThan(19);
  });

  it("re-applies the remembered fix to a map created afterwards", () => {
    module.showUserLocation(48.85, 2.35, 30);
    const late = fakeMap();
    module.applyRememberedUserLocation({ map: late, userMarker: null });
    expect(late.layers).toEqual(["userAccFill", "userAccLine"]);
  });

  it("updates the circle rather than adding a second one", () => {
    const map = fakeMap();
    module.MAPS.worldMap = { map };
    module.showUserLocation(48.85, 2.35, 30);
    module.showUserLocation(43.23, 0.07, 30);
    expect(map.layers).toEqual(["userAccFill", "userAccLine"]);
  });

  it("waits for the style before drawing", () => {
    const map = fakeMap({ loaded: false });
    module.MAPS.worldMap = { map };
    module.showUserLocation(48.85, 2.35, 30);
    expect(map.layers).toEqual([]);
    expect(map.idleHandlers).toHaveLength(1);
    expect(map.idleHandlers[0][0]).toBe("idle");
  });
});
