import { describe, it, expect } from "vitest";
import {
  severityTone,
  alertToNotification,
  mergeFavoritesNotifications,
  summarizeFavoritesCoverage,
} from "./favorites-notifications.js";

const NOW = Date.UTC(2026, 8, 22, 18, 0, 0);
const HOUR = 3600 * 1000;

const alert = (over = {}) => ({
  type: "tornado",
  event: "Tornado Warning",
  severity: "Extreme",
  urgency: "Immediate",
  area: "Cleveland County, OK",
  authority: "NWS Norman OK",
  starts: NOW - HOUR,
  expires: NOW + HOUR,
  source: { name: "National Weather Service", url: "https://api.weather.gov/alerts/x" },
  providerId: "nws-us",
  ...over,
});

describe("severityTone", () => {
  it("maps each official severity step to its own fixed tone", () => {
    expect(severityTone("Extreme")).toBe("severe");
    expect(severityTone("Severe")).toBe("warning");
    expect(severityTone("Moderate")).toBe("caution");
    expect(severityTone("Minor")).toBe("normal");
  });

  it("falls back to info rather than guessing at an unrecognised wording", () => {
    expect(severityTone("Unknown")).toBe("info");
    expect(severityTone("")).toBe("info");
    expect(severityTone(undefined)).toBe("info");
  });
});

describe("alertToNotification", () => {
  it("builds a stable key from provider + location + type + starts", () => {
    const n = alertToNotification(alert(), "paris-fr");
    expect(n.key).toBe("nws-us:paris-fr:tornado:" + (NOW - HOUR));
    expect(n.locId).toBe("paris-fr");
    expect(n.tone).toBe("severe");
    expect(n.read).toBe(false);
  });

  it("a re-issued alert (new starts time) gets a different key", () => {
    const a = alertToNotification(alert(), "loc-1");
    const b = alertToNotification(alert({ starts: NOW }), "loc-1");
    expect(a.key).not.toBe(b.key);
  });

  it("respects an explicit read flag", () => {
    expect(alertToNotification(alert(), "loc-1", true).read).toBe(true);
  });
});

describe("mergeFavoritesNotifications", () => {
  it("adds a fresh active alert as unread", () => {
    const merged = mergeFavoritesNotifications(
      [],
      [{ locId: "loc-1", status: "active", alerts: [alert()] }],
      NOW,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].read).toBe(false);
  });

  it("keeps the read flag for an alert that is still the same instance", () => {
    const previous = [alertToNotification(alert(), "loc-1", true)];
    const merged = mergeFavoritesNotifications(
      previous,
      [{ locId: "loc-1", status: "active", alerts: [alert()] }],
      NOW,
    );
    expect(merged[0].read).toBe(true);
  });

  it("drops a notification once the issuer no longer reports it as active", () => {
    const previous = [alertToNotification(alert(), "loc-1")];
    const merged = mergeFavoritesNotifications(
      previous,
      [{ locId: "loc-1", status: "clear", alerts: [] }],
      NOW,
    );
    expect(merged).toEqual([]);
  });

  it("carries an unexpired notification through a transient fetch error", () => {
    const previous = [alertToNotification(alert(), "loc-1")];
    const merged = mergeFavoritesNotifications(
      previous,
      [{ locId: "loc-1", status: "error", alerts: [] }],
      NOW,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe(previous[0].key);
  });

  it("carries an unexpired notification when coverage briefly reads unsupported", () => {
    const previous = [alertToNotification(alert(), "loc-1")];
    const merged = mergeFavoritesNotifications(
      previous,
      [{ locId: "loc-1", status: "unsupported", alerts: [] }],
      NOW,
    );
    expect(merged).toHaveLength(1);
  });

  it("never carries an already-expired notification through an error", () => {
    const previous = [alertToNotification(alert({ expires: NOW - 1 }), "loc-1")];
    const merged = mergeFavoritesNotifications(
      previous,
      [{ locId: "loc-1", status: "error", alerts: [] }],
      NOW,
    );
    expect(merged).toEqual([]);
  });

  it("handles several favorites independently in one cycle", () => {
    const previous = [alertToNotification(alert(), "loc-1", true)];
    const merged = mergeFavoritesNotifications(
      previous,
      [
        { locId: "loc-1", status: "active", alerts: [alert()] },
        {
          locId: "loc-2",
          status: "active",
          alerts: [alert({ event: "Flood Warning", type: "flood" })],
        },
      ],
      NOW,
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((n) => n.locId === "loc-1").read).toBe(true);
    expect(merged.find((n) => n.locId === "loc-2").read).toBe(false);
  });

  it("never duplicates the same key twice", () => {
    const merged = mergeFavoritesNotifications(
      [],
      [{ locId: "loc-1", status: "active", alerts: [alert(), alert()] }],
      NOW,
    );
    expect(merged).toHaveLength(1);
  });
});

describe("summarizeFavoritesCoverage", () => {
  it("is 'ok' once at least one favorite has a verified issuer", () => {
    expect(summarizeFavoritesCoverage(["active", "unsupported"])).toBe("ok");
    expect(summarizeFavoritesCoverage(["clear"])).toBe("ok");
  });

  it("is 'no-coverage' only when every favorite is unsupported", () => {
    expect(summarizeFavoritesCoverage(["unsupported", "unsupported"])).toBe("no-coverage");
    expect(summarizeFavoritesCoverage([])).toBe("no-coverage");
  });
});
