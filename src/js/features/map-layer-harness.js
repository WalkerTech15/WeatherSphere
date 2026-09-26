/* Shared stand-ins for the layer tests (map-layer-*.test.js): a layer button
 * with the DOM surface the overlay touches, and a map that records the GeoJSON
 * it is given. Not part of the app — nothing imports this but the tests. */
import { vi } from "vitest";

export function fakeLayerButton(name) {
  const classes = new Set();
  return {
    dataset: { mapLayer: name },
    disabled: false,
    tabIndex: 0,
    attrs: {},
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
  };
}

/* Stubs `document` for one layer's button and the live region. */
export function stubLayerDocument(name) {
  const button = fakeLayerButton(name);
  const region = { textContent: "" };
  vi.stubGlobal("document", {
    querySelector: (selector) => {
      if (selector === "#mapLayerStatus") return region;
      return selector.includes(`"${name}"`) ? button : null;
    },
    querySelectorAll: (selector) => (selector === ".map-layer" ? [button] : []),
  });
  return { button, region };
}

/* A map that keeps the data of every GeoJSON source and the layers added. */
export function fakeGeoMap({ loaded = true } = {}) {
  const sources = new Map();
  const map = {
    sources,
    layers: [],
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
    addLayer: (layer) => map.layers.push(layer.id),
    getLayer: (id) => (map.layers.includes(id) ? { id } : undefined),
  };
  return map;
}

export const PARIS = { lat: 48.85, lon: 2.35, name: { en: "Paris", fr: "Paris" } };
export const TARBES = { lat: 43.23, lon: 0.07, name: { en: "Tarbes", fr: "Tarbes" } };
