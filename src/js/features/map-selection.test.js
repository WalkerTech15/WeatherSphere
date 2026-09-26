/* Choosing a place ON the map: the outline, and the click. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isSelectableMapClick,
  setMapClickHandler,
  bindMapSelection,
  updateSelectionArea,
  raiseSelectionArea,
} from "./map-selection.js";

const clickOn = (matchesSelector) => ({
  originalEvent: { target: { closest: (selector) => (matchesSelector ? selector : null) } },
});

describe("isSelectableMapClick", () => {
  it("accepts a click on the map surface", () => {
    expect(isSelectableMapClick(clickOn(false))).toBe(true);
  });

  it("refuses a click that landed on a marker, popup or control", () => {
    expect(isSelectableMapClick(clickOn(true))).toBe(false);
  });

  it("accepts an event with no DOM target (a programmatic click)", () => {
    expect(isSelectableMapClick({})).toBe(true);
    expect(isSelectableMapClick(undefined)).toBe(true);
    expect(isSelectableMapClick({ originalEvent: { target: {} } })).toBe(true);
  });
});

function fakeInstance({ loaded = true } = {}) {
  const sources = new Map();
  const handlers = {};
  const map = {
    layers: [],
    moved: [],
    isStyleLoaded: () => loaded,
    getStyle: () => ({ layers: [{ id: "labels", type: "symbol" }] }),
    getSource: (id) => sources.get(id),
    addSource: (id, spec) =>
      sources.set(id, {
        data: spec.data,
        setData(data) {
          this.data = data;
        },
      }),
    addLayer: (layer, before) => map.layers.push([layer.id, before]),
    getLayer: (id) => (map.layers.some(([layerId]) => layerId === id) ? { id } : undefined),
    moveLayer: (id, before) => map.moved.push([id, before]),
    on: (event, handler) => (handlers[event] = handler),
    once: (event, handler) => (handlers.once = [event, handler]),
  };
  const marker = {
    position: null,
    setLngLat(point) {
      this.position = point;
    },
  };
  return { map, handlers, marker };
}

const polygonLoc = {
  kind: "state",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
};

describe("updateSelectionArea", () => {
  it("draws a real polygon under the labels, once", () => {
    const inst = fakeInstance();
    updateSelectionArea(inst, polygonLoc);
    expect(inst.map.layers).toEqual([
      ["weather-selection-fill", "labels"],
      ["weather-selection-line", "labels"],
    ]);
    updateSelectionArea(inst, polygonLoc);
    expect(inst.map.layers).toHaveLength(2); /* the source is updated, not re-added */
  });

  it("draws nothing for a point-only place — never a rectangle from a bbox", () => {
    const inst = fakeInstance();
    updateSelectionArea(inst, { kind: "city", bbox: [0, 0, 1, 1] });
    expect(inst.map.getSource("weather-selection-area").data.features).toEqual([]);
  });

  it("empties the outline when the selection is cleared", () => {
    const inst = fakeInstance();
    updateSelectionArea(inst, polygonLoc);
    updateSelectionArea(inst, null);
    expect(inst.map.getSource("weather-selection-area").data.features).toEqual([]);
  });

  it("waits for the style before drawing", () => {
    const inst = fakeInstance({ loaded: false });
    updateSelectionArea(inst, polygonLoc);
    expect(inst.map.layers).toEqual([]);
    expect(inst.handlers.once[0]).toBe("idle");
  });
});

describe("raiseSelectionArea", () => {
  it("moves the outline into the slot between the weather and the labels", () => {
    const inst = fakeInstance();
    updateSelectionArea(inst, polygonLoc);
    raiseSelectionArea(inst);
    expect(inst.map.moved).toEqual([
      ["weather-selection-fill", "labels"],
      ["weather-selection-line", "labels"],
    ]);
  });

  it("does nothing when there is no outline, or no map", () => {
    const inst = fakeInstance();
    raiseSelectionArea(inst);
    expect(inst.map.moved).toEqual([]);
    expect(() => raiseSelectionArea(null)).not.toThrow();
  });
});

describe("bindMapSelection", () => {
  let inst;
  beforeEach(() => {
    inst = fakeInstance();
    setMapClickHandler(null);
  });

  it("moves the pin at once, remembers the click, and hands the point on", () => {
    const handler = vi.fn();
    setMapClickHandler(handler);
    bindMapSelection(inst);
    inst.handlers.click({ ...clickOn(false), lngLat: { lng: 0.07, lat: 43.23 } });
    expect(inst.marker.position).toEqual([0.07, 43.23]);
    expect(inst.pendingClickKey).toBe("43.23,0.07");
    expect(handler).toHaveBeenCalledWith({ lat: 43.23, lon: 0.07 });
  });

  it("drops the previous place's outline right away", () => {
    setMapClickHandler(() => {});
    updateSelectionArea(inst, polygonLoc);
    bindMapSelection(inst);
    inst.handlers.click({ ...clickOn(false), lngLat: { lng: 1, lat: 1 } });
    expect(inst.map.getSource("weather-selection-area").data.features).toEqual([]);
  });

  it("ignores a click on the marker, a popup or a control", () => {
    const handler = vi.fn();
    setMapClickHandler(handler);
    bindMapSelection(inst);
    inst.handlers.click({ ...clickOn(true), lngLat: { lng: 1, lat: 1 } });
    expect(handler).not.toHaveBeenCalled();
    expect(inst.marker.position).toBeNull();
  });

  it("ignores every click until the selection pipeline has registered itself", () => {
    bindMapSelection(inst);
    inst.handlers.click({ ...clickOn(false), lngLat: { lng: 1, lat: 1 } });
    expect(inst.marker.position).toBeNull();
  });
});
