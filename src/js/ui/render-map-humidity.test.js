/* What a screen reader hears for the Humidity panel: the reading, its class,
 * and — since the panel now has a forecast hour — which moment it is for. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { humidityAnnouncement } from "./render-map-humidity.js";

const NOW = Date.UTC(2026, 8, 22, 10, 0, 0);
const HOUR = 3600 * 1000;

const ready = (humidity, offsetHours = 0) => ({
  status: "ready",
  data: {
    humidity,
    updatedAt: new Date(NOW),
    offset: offsetHours,
    timeMs: NOW + offsetHours * HOUR,
  },
  errorKind: null,
  offsets: [0, 3, 6, 12, 24],
});

beforeEach(() => {
  state.lang = "en";
});

describe("humidityAnnouncement", () => {
  it("is silent while idle", () => {
    expect(humidityAnnouncement({ status: "idle" })).toBe("");
    expect(humidityAnnouncement(null)).toBe("");
  });

  it("says just the reading for 'now', as it always has", () => {
    expect(humidityAnnouncement(ready(62))).toMatch(/^Humidity, 62%, [^.]+$/);
  });

  it.each([3, 6, 12, 24])("names the moment a +%i h reading is for", (hours) => {
    expect(humidityAnnouncement(ready(62, hours))).toMatch(/^Humidity, 62%, .+\. Showing .+/);
  });

  it("names a different moment for a different hour", () => {
    expect(humidityAnnouncement(ready(62, 3))).not.toBe(humidityAnnouncement(ready(62, 24)));
  });

  it("is French in French", () => {
    state.lang = "fr";
    expect(humidityAnnouncement(ready(62))).toMatch(/^Humidité, 62%, [^.]+$/);
    expect(humidityAnnouncement(ready(62, 6))).toMatch(/^Humidité, 62%, .+\. Affichage : .+/);
  });

  it("says loading and each failure in words", () => {
    expect(humidityAnnouncement({ status: "loading" })).toBe("Loading humidity…");
    const error = (errorKind) => humidityAnnouncement({ status: "error", errorKind });
    expect(error("offline")).toBe("You're offline — humidity data is unavailable.");
    expect(error("unavailable")).toBe("Humidity data is unavailable for this location.");
    expect(error("error")).toBe("Humidity data could not be loaded.");
  });
});
