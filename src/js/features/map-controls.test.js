/* The map's own chrome: control labels, label language, quieter boundaries. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import {
  mapLocale,
  applyMapControlLabels,
  applyMapLanguage,
  softenBaseBoundaries,
} from "./map-controls.js";

beforeEach(() => {
  state.lang = "en";
});

describe("mapLocale", () => {
  it("translates every string MapLibre would otherwise show in English", () => {
    const keys = [
      "Map.Title",
      "Marker.Title",
      "Popup.Close",
      "NavigationControl.ZoomIn",
      "NavigationControl.ZoomOut",
      "AttributionControl.ToggleAttribution",
      "GeolocateControl.FindMyLocation",
    ];
    expect(Object.keys(mapLocale()).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(mapLocale()[key]).toBeTruthy();
  });

  it("follows the interface language", () => {
    const english = mapLocale()["NavigationControl.ZoomIn"];
    state.lang = "fr";
    expect(mapLocale()["NavigationControl.ZoomIn"]).not.toBe(english);
  });
});

describe("applyMapControlLabels", () => {
  const element = (hasTitle = true) => ({
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    hasAttribute: (name) => hasTitle && name === "title",
  });

  function fakeMap(byselector) {
    const canvas = element(false);
    const root = { querySelectorAll: (selector) => byselector[selector] || [] };
    return { canvas, map: { getCanvas: () => canvas, getContainer: () => root } };
  }

  it("names the canvas and each control, keeping a tooltip in step", () => {
    const zoomIn = element();
    const { canvas, map } = fakeMap({ ".maplibregl-ctrl-zoom-in": [zoomIn] });
    applyMapControlLabels(map);
    expect(canvas.attrs["aria-label"]).toBeTruthy();
    expect(zoomIn.attrs["aria-label"]).toBe(mapLocale()["NavigationControl.ZoomIn"]);
    expect(zoomIn.attrs.title).toBe(zoomIn.attrs["aria-label"]);
  });

  it("does not add a tooltip to a control that had none", () => {
    const zoomOut = element(false);
    const { map } = fakeMap({ ".maplibregl-ctrl-zoom-out": [zoomOut] });
    applyMapControlLabels(map);
    expect(zoomOut.attrs.title).toBeUndefined();
  });

  it("does nothing, and does not throw, for a map that was already removed", () => {
    const removed = {
      getCanvas() {
        throw new Error("removed");
      },
    };
    expect(() => applyMapControlLabels(removed)).not.toThrow();
  });
});

describe("applyMapLanguage", () => {
  const layers = [
    { id: "place-label", type: "symbol", layout: { "text-field": ["get", "name"] } },
    { id: "poi-icon", type: "symbol", layout: {} },
    { id: "road", type: "line", layout: {} },
  ];
  const fakeMap = ({ loaded = true, failOn } = {}) => {
    const set = [];
    return {
      set,
      isStyleLoaded: () => loaded,
      getStyle: () => ({ layers }),
      setLayoutProperty(id, property, value) {
        if (id === failOn) throw new Error("locked");
        set.push({ id, property, value });
      },
    };
  };

  it("points label layers at the active language, falling back to the local name", () => {
    state.lang = "fr";
    const map = fakeMap();
    applyMapLanguage(map);
    expect(map.set).toEqual([
      {
        id: "place-label",
        property: "text-field",
        value: ["coalesce", ["get", "name:fr"], ["get", "name"]],
      },
    ]);
  });

  it("leaves icon-only and non-symbol layers alone", () => {
    const map = fakeMap();
    applyMapLanguage(map);
    expect(map.set.map((entry) => entry.id)).toEqual(["place-label"]);
  });

  it("does nothing before the style has loaded, or for no map", () => {
    const map = fakeMap({ loaded: false });
    applyMapLanguage(map);
    expect(map.set).toEqual([]);
    expect(() => applyMapLanguage(null)).not.toThrow();
  });

  it("carries on past a layer that will not take the property", () => {
    const map = fakeMap({ failOn: "place-label" });
    expect(() => applyMapLanguage(map)).not.toThrow();
  });
});

describe("softenBaseBoundaries", () => {
  const boundaryLayers = [
    { id: "country-border", type: "line", "source-layer": "country_border" },
    { id: "country-border-dark", type: "line", "source-layer": "country_border" },
    { id: "sub-border", type: "line", "source-layer": "sub_border" },
    { id: "road", type: "line", "source-layer": "transportation" },
    { id: "country-fill", type: "fill", "source-layer": "country_border" },
  ];

  it("quiets only the known boundary lines, more for regions than countries", () => {
    const painted = {};
    softenBaseBoundaries({
      isStyleLoaded: () => true,
      getStyle: () => ({ layers: boundaryLayers }),
      setPaintProperty: (id, property, value) => (painted[id] = [property, value]),
    });
    expect(painted).toEqual({
      "country-border": ["line-opacity", 0.42],
      "country-border-dark": ["line-opacity", 0.14],
      "sub-border": ["line-opacity", 0.28],
    });
  });

  it("waits for a loaded style", () => {
    let touched = false;
    softenBaseBoundaries({
      isStyleLoaded: () => false,
      getStyle: () => ({ layers: boundaryLayers }),
      setPaintProperty: () => (touched = true),
    });
    expect(touched).toBe(false);
  });
});
