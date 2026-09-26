/* How a selected place is presented on the map: how far to zoom, and the popup
 * over its pin. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { zoomFor, popupHtml } from "./map-place.js";

beforeEach(() => {
  state.lang = "en";
  state.wx = null;
});

describe("zoomFor", () => {
  it("zooms wider for bigger kinds of place", () => {
    expect(zoomFor({ kind: "country", id: "france" })).toBe(5);
    expect(zoomFor({ kind: "state" })).toBe(6);
    expect(zoomFor({ kind: "province" })).toBe(6);
    expect(zoomFor({ kind: "region" })).toBe(6);
    expect(zoomFor({ kind: "city" })).toBe(11);
    expect(zoomFor({ kind: "town" })).toBe(11);
    expect(zoomFor({ kind: "village" })).toBe(13);
    expect(zoomFor({ kind: "address" })).toBe(16);
    expect(zoomFor({ kind: "poi" })).toBe(16);
  });

  it("gives the three huge countries a wider view than other countries", () => {
    for (const id of ["usa", "canada", "australia"]) {
      expect(zoomFor({ kind: "country", id })).toBe(4);
    }
  });

  it("prefers the zoom a geocoder result already carries", () => {
    expect(zoomFor({ kind: "city", _zoom: 9.5 })).toBe(9.5);
    expect(zoomFor({ kind: "city", _zoom: 0 })).toBe(0);
  });

  it("falls back to city scale for an unknown kind", () => {
    expect(zoomFor({ kind: "galaxy" })).toBe(11);
  });
});

describe("popupHtml", () => {
  const paris = {
    name: { en: "Paris", fr: "Paris" },
    kind: "city",
    region: "Île-de-France",
    country: "France",
  };

  it("names the place and offers the way back to its weather", () => {
    const html = popupHtml(paris);
    expect(html).toContain("Paris");
    expect(html).toContain('class="mp-link"');
    expect(html).toContain("View weather");
  });

  it("shows no weather block until a forecast has arrived", () => {
    expect(popupHtml(paris)).not.toContain("mp-wx");
  });

  it("escapes place names, so a hostile result cannot inject markup", () => {
    const html = popupHtml({
      ...paris,
      name: { en: '<img src=x onerror="alert(1)">', fr: "x" },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("follows the interface language", () => {
    state.lang = "fr";
    expect(popupHtml(paris)).toContain("Voir la météo");
  });
});
