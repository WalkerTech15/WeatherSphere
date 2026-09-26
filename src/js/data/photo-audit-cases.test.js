import { describe, expect, it } from "vitest";
import { MAJOR_CITIES, MAJOR_CITY_KEYS } from "./major-cities.js";
import { LOCATIONS, findLocations } from "./locations.js";

const normalize = (value) =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

describe("photo audit inventory", () => {
  it("covers every country represented by the major-city catalog", () => {
    const countries = Object.keys(MAJOR_CITIES);
    expect(countries.length).toBeGreaterThanOrEqual(70);
    expect(new Set(countries).size).toBe(countries.length);
  });

  it("keeps every audit case tied to a valid country code", () => {
    for (const [country, names] of Object.entries(MAJOR_CITIES)) {
      for (const name of names.split(",")) {
        expect(name.trim(), `${country} has an empty city name`).toBeTruthy();
        expect(MAJOR_CITY_KEYS.has(`${normalize(name)}|${country}`)).toBe(true);
      }
    }
  });

  it("includes at least one searchable city for each audited country", () => {
    for (const [country, names] of Object.entries(MAJOR_CITIES)) {
      expect(names.split(",").filter(Boolean).length, country).toBeGreaterThan(0);
    }
  });

  it("keeps the reviewed Lourdes image tied to Lourdes and its source", () => {
    const lourdes = LOCATIONS.find((location) => location.id === "lourdes");
    expect(lourdes?.landmark?.img).toContain("images.unsplash.com/photo-1641070496002-8077aefba51c");
    expect(lourdes?.landmark?.photo).toMatchObject({
      source: "unsplash",
      photographer: "Nick Castelli",
      link: expect.stringContaining("mnctB7nxJiQ"),
    });
  });

  it("resolves the full Lourdes region search to the curated place", () => {
    expect(findLocations("Lourdes, Occitania, France", "en")[0]?.id).toBe("lourdes");
  });
});
