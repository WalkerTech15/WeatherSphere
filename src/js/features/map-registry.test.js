/* The registry of live maps, and what can be read from it. */
import { describe, it, expect, beforeEach } from "vitest";
import { MAPS, getMapCamera, resizeMaps } from "./map-registry.js";

beforeEach(() => {
  for (const id of Object.keys(MAPS)) delete MAPS[id];
});

describe("getMapCamera", () => {
  it("is null while the map page's map does not exist", () => {
    expect(getMapCamera()).toBeNull();
    MAPS.homeMap = { map: { getCenter: () => ({ lat: 1, lng: 2 }), getZoom: () => 3 } };
    expect(getMapCamera()).toBeNull(); /* only the map PAGE's camera is shared */
  });

  it("reads the centre and zoom of the map page's map", () => {
    MAPS.worldMap = { map: { getCenter: () => ({ lat: 43.23, lng: 0.07 }), getZoom: () => 11.5 } };
    expect(getMapCamera()).toEqual({ lat: 43.23, lon: 0.07, zoom: 11.5 });
  });

  it("is null, not a crash, when the map was removed mid-call", () => {
    MAPS.worldMap = {
      map: {
        getCenter() {
          throw new Error("removed");
        },
      },
    };
    expect(getMapCamera()).toBeNull();
  });
});

describe("resizeMaps", () => {
  it("resizes every map, and skips one that is not ready", () => {
    const resized = [];
    MAPS.worldMap = {
      map: {
        resize() {
          throw new Error("not initialised");
        },
      },
    };
    MAPS.homeMap = { map: { resize: () => resized.push("home") } };
    expect(() => resizeMaps()).not.toThrow();
    expect(resized).toEqual(["home"]);
  });
});
