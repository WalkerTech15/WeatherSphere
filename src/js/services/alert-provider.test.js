/* The seam for a future official tornado overlay.
 *
 * No official alert source is connected, so the most important assertions
 * here are the negative ones: without a verified provider there is no alert,
 * no layer, no "all clear", and nothing weather-shaped can create one. */
import { describe, it, expect, vi } from "vitest";
import {
  OFFICIAL_ALERT_PROVIDERS,
  REQUIRED_ALERT_FIELDS,
  normalizeOfficialAlert,
  isActiveAlert,
  fetchOfficialAlerts,
  isTornadoAlert,
  tornadoLayerModel,
  alertFacts,
} from "./alert-provider.js";

const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);
const HOUR = 3600 * 1000;
const PLACE = { id: "x", kind: "city", lat: 35, lon: -97 };

const provider = (over = {}) => ({
  id: "test-nws",
  name: "Test Weather Service",
  official: true,
  covers: () => true,
  fetchAlerts: async () => [],
  ...over,
});

const rawAlert = (over = {}) => ({
  type: "Tornado",
  area: { name: "Cleveland County" },
  severity: "Extreme",
  authority: "Test Weather Service, Norman",
  starts: new Date(NOW - HOUR).toISOString(),
  expires: new Date(NOW + HOUR).toISOString(),
  source: { name: "Test Weather Service", url: "https://alerts.example.gov/abc" },
  ...over,
});

/* Outside NWS territory nothing is connected, so the negative assertions
   still hold there — and they are the ones that matter, because saying
   "no tornado" to someone the app knows nothing about would be a lie.
   `ABROAD` carries a country code, so no provider covers it and no request
   is ever made (these tests touch no network). */
const ABROAD = { id: "paris", kind: "city", lat: 48.8566, lon: 2.3522, cc: "FR" };

describe("outside any connected source's coverage", () => {
  it("registers exactly the one verified issuer, the U.S. National Weather Service", () => {
    expect(OFFICIAL_ALERT_PROVIDERS.map((p) => p.id)).toEqual(["nws-us"]);
    expect(OFFICIAL_ALERT_PROVIDERS.every((p) => p.official === true)).toBe(true);
  });

  it("reports 'unavailable' for a place no issuer covers", async () => {
    expect(await fetchOfficialAlerts(ABROAD)).toEqual({
      status: "unavailable",
      alerts: [],
      sources: [],
    });
  });

  it("draws nothing there: no layer, no alert, and no 'no tornado alerts' reassurance", async () => {
    const model = tornadoLayerModel(await fetchOfficialAlerts(ABROAD), NOW);
    expect(model).toMatchObject({
      state: "no-source",
      visible: false,
      showClearState: false,
      alerts: [],
    });
  });

  it("treats a missing answer the same way", () => {
    expect(tornadoLayerModel(undefined, NOW)).toMatchObject({
      visible: false,
      showClearState: false,
    });
    expect(tornadoLayerModel(null, NOW).state).toBe("no-source");
  });

  it("cannot be handed weather — its only input is what an authority issued", async () => {
    /* extreme wind, heavy rain and a pressure crash: none of it is an input,
       and none of it can conjure a provider where none covers the place */
    const stormy = { wind: 200, gust: 260, code: 99, pressure: 880, rainProb: 100 };
    const result = await fetchOfficialAlerts({ ...ABROAD, ...stormy });
    expect(result.status).toBe("unavailable");
    expect(tornadoLayerModel(result, NOW).visible).toBe(false);
  });

  it("weather values cannot produce an alert even where an issuer does cover", async () => {
    /* the provider is asked for the place; what it returns is the ONLY
       source of alerts, so a storm with no published alert stays silent */
    const stormy = { ...PLACE, wind: 200, gust: 260, code: 99, pressure: 880 };
    const result = await fetchOfficialAlerts(stormy, { providers: [provider()] });
    expect(result.status).toBe("ok");
    expect(tornadoLayerModel(result, NOW)).toMatchObject({ state: "clear", visible: false });
  });
});

describe("provider eligibility", () => {
  it("ignores a provider that is not declared official", async () => {
    const fetchAlerts = vi.fn(async () => [rawAlert()]);
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [provider({ official: false, fetchAlerts })],
    });
    expect(result.status).toBe("unavailable");
    expect(fetchAlerts).not.toHaveBeenCalled();
  });

  it("ignores a provider that does not cover the place", async () => {
    const fetchAlerts = vi.fn(async () => [rawAlert()]);
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [provider({ covers: () => false, fetchAlerts })],
    });
    expect(result.status).toBe("unavailable");
    expect(fetchAlerts).not.toHaveBeenCalled();
  });

  it("requires official to be literally true", async () => {
    for (const official of [1, "true", "yes", undefined]) {
      const result = await fetchOfficialAlerts(PLACE, { providers: [provider({ official })] });
      expect(result.status, String(official)).toBe("unavailable");
    }
  });
});

describe("normalizeOfficialAlert — nothing unverifiable gets through", () => {
  it("accepts a complete alert and keeps every field the UI must show", () => {
    const alert = normalizeOfficialAlert(rawAlert(), provider());
    expect(alert).toMatchObject({
      type: "tornado",
      area: "Cleveland County",
      severity: "Extreme",
      authority: "Test Weather Service, Norman",
      source: { name: "Test Weather Service", url: "https://alerts.example.gov/abc" },
      providerId: "test-nws",
    });
    expect(alert.starts).toBe(NOW - HOUR);
    expect(alert.expires).toBe(NOW + HOUR);
  });

  it("lists exactly the fields a future tornado UI must carry", () => {
    expect(REQUIRED_ALERT_FIELDS).toEqual([
      "type",
      "area",
      "severity",
      "authority",
      "starts",
      "expires",
      "source",
    ]);
  });

  it("drops an alert missing any required field", () => {
    for (const drop of ["type", "area", "severity", "authority", "starts", "expires", "source"]) {
      const raw = rawAlert();
      delete raw[drop];
      expect(normalizeOfficialAlert(raw, provider()), `missing ${drop}`).toBeNull();
    }
  });

  it("drops an alert with no attribution link, or one that is not https", () => {
    expect(normalizeOfficialAlert(rawAlert({ source: { name: "X" } }), provider())).toBeNull();
    expect(
      normalizeOfficialAlert(
        rawAlert({ source: { name: "X", url: "http://a.gov/x" } }),
        provider(),
      ),
    ).toBeNull();
    expect(
      normalizeOfficialAlert(
        rawAlert({ source: { name: "X", url: "javascript:alert(1)" } }),
        provider(),
      ),
    ).toBeNull();
  });

  it("drops blank strings and impossible windows", () => {
    expect(normalizeOfficialAlert(rawAlert({ authority: "   " }), provider())).toBeNull();
    expect(normalizeOfficialAlert(rawAlert({ starts: "soon" }), provider())).toBeNull();
    expect(
      normalizeOfficialAlert(
        rawAlert({ starts: new Date(NOW).toISOString(), expires: new Date(NOW).toISOString() }),
        provider(),
      ),
    ).toBeNull();
  });

  it("drops junk and anything from a non-official provider", () => {
    for (const junk of [null, undefined, "tornado", 42, []]) {
      expect(normalizeOfficialAlert(junk, provider())).toBeNull();
    }
    expect(normalizeOfficialAlert(rawAlert(), provider({ official: false }))).toBeNull();
    expect(normalizeOfficialAlert(rawAlert(), null)).toBeNull();
  });
});

describe("with a verified official provider (future)", () => {
  it("is active only inside its own window", () => {
    const alert = normalizeOfficialAlert(rawAlert(), provider());
    expect(isActiveAlert(alert, NOW)).toBe(true);
    expect(isActiveAlert(alert, NOW - 2 * HOUR)).toBe(false); /* not started */
    expect(isActiveAlert(alert, NOW + 2 * HOUR)).toBe(false); /* expired */
    expect(isActiveAlert(alert, NOW + HOUR)).toBe(false); /* expiry is exclusive */
    expect(isActiveAlert(null, NOW)).toBe(false);
  });

  it("shows an active tornado alert with its source", async () => {
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [provider({ fetchAlerts: async () => [rawAlert()] })],
    });
    const model = tornadoLayerModel(result, NOW);
    expect(model).toMatchObject({ state: "active", visible: true, showClearState: false });
    expect(model.alerts).toHaveLength(1);
    expect(model.sources).toEqual([{ id: "test-nws", name: "Test Weather Service" }]);
  });

  it("shows the clear state ONLY when a source answered with no active tornado alert", async () => {
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [provider({ fetchAlerts: async () => [] })],
    });
    expect(tornadoLayerModel(result, NOW)).toMatchObject({
      state: "clear",
      visible: false,
      showClearState: true,
    });
  });

  it("does not treat other official alert types, or expired tornado alerts, as tornado alerts", async () => {
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [
        provider({
          fetchAlerts: async () => [
            rawAlert({ type: "Flood" }),
            rawAlert({ type: "Thunderstorm" }),
            rawAlert({ expires: new Date(NOW - 30 * 60 * 1000).toISOString() }),
          ],
        }),
      ],
    });
    expect(result.alerts).toHaveLength(3); /* valid alerts, all kept… */
    expect(tornadoLayerModel(result, NOW)).toMatchObject({
      state: "clear",
      visible: false,
    }); /* …none a live tornado alert */
  });

  it("drops invalid alerts a provider returns rather than showing them", async () => {
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [provider({ fetchAlerts: async () => [rawAlert({ authority: "" }), rawAlert()] })],
    });
    expect(result.alerts).toHaveLength(1);
  });

  it("never presents a failure as 'no alerts'", async () => {
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [
        provider({
          fetchAlerts: async () => {
            throw new Error("offline");
          },
        }),
      ],
    });
    expect(result.status).toBe("error");
    expect(tornadoLayerModel(result, NOW)).toMatchObject({
      state: "error",
      visible: false,
      showClearState: false,
    });
  });

  it("still answers when one of several providers fails", async () => {
    const result = await fetchOfficialAlerts(PLACE, {
      providers: [
        provider({
          id: "down",
          fetchAlerts: async () => {
            throw new Error("x");
          },
        }),
        provider({ id: "up", fetchAlerts: async () => [rawAlert()] }),
      ],
    });
    expect(result.status).toBe("ok");
    expect(result.alerts).toHaveLength(1);
  });

  it("identifies a tornado alert only by the provider's own event type", () => {
    expect(isTornadoAlert({ type: "tornado" })).toBe(true);
    expect(isTornadoAlert({ type: "thunderstorm" })).toBe(false);
    expect(isTornadoAlert({ type: "severe wind" })).toBe(false);
    expect(isTornadoAlert(null)).toBe(false);
  });

  it("exposes every fact a renderer must present, source last", () => {
    const facts = alertFacts(normalizeOfficialAlert(rawAlert(), provider()));
    expect(facts.map((f) => f.key)).toEqual([
      "type",
      "severity",
      "area",
      "authority",
      "starts",
      "expires",
      "source",
    ]);
    expect(facts.at(-1).href).toBe("https://alerts.example.gov/abc");
    expect(alertFacts(null)).toEqual([]);
  });
});
