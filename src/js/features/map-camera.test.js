/* Moving the map page's camera. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const flights = [];
const fakeMap = { flyTo: (options) => flights.push(options) };

async function loadModules() {
  vi.resetModules();
  const registry = await import("./map-registry.js");
  const camera = await import("./map-camera.js");
  return { MAPS: registry.MAPS, ...camera };
}

beforeEach(() => {
  flights.length = 0;
});

describe("jumpTo", () => {
  it("flies the map page's map, always flat and north-up", async () => {
    const { MAPS, jumpTo } = await loadModules();
    MAPS.worldMap = { map: fakeMap };
    jumpTo([2.35, 48.85], 5);
    expect(flights).toEqual([
      { center: [2.35, 48.85], zoom: 5, bearing: 0, pitch: 0, duration: 1200 },
    ]);
  });

  it("takes a duration of 0 to restore a shared view without a flight", async () => {
    const { MAPS, jumpTo } = await loadModules();
    MAPS.worldMap = { map: fakeMap };
    jumpTo([0, 0], 2, { duration: 0 });
    expect(flights[0].duration).toBe(0);
  });

  it("holds the view until the map exists, then applies it once", async () => {
    const { MAPS, jumpTo, applyPendingCamera } = await loadModules();
    jumpTo([10, 20], 4, { duration: 0 });
    expect(flights).toEqual([]);
    applyPendingCamera("worldMap"); /* still no map: nothing to fly */
    expect(flights).toEqual([]);
    MAPS.worldMap = { map: fakeMap };
    applyPendingCamera("homeMap"); /* the Home preview never takes it */
    expect(flights).toEqual([]);
    applyPendingCamera("worldMap");
    expect(flights).toEqual([{ center: [10, 20], zoom: 4, bearing: 0, pitch: 0, duration: 0 }]);
    applyPendingCamera("worldMap"); /* and only once */
    expect(flights).toHaveLength(1);
  });

  it("keeps only the latest view asked for before the map exists", async () => {
    const { MAPS, jumpTo, applyPendingCamera } = await loadModules();
    jumpTo([1, 1], 1);
    jumpTo([2, 2], 2);
    MAPS.worldMap = { map: fakeMap };
    applyPendingCamera("worldMap");
    expect(flights.map((f) => f.center)).toEqual([[2, 2]]);
  });
});
