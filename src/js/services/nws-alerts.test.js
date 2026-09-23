/* The NWS provider: what it will and will not accept from the wire.
 *
 * The negative assertions matter most — a test message, an alert with no
 * attribution, or a place the NWS does not issue for must never become a
 * warning on screen. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  coversUnitedStates,
  nwsAlertsUrl,
  alertTypeFromEvent,
  isRelevantAlert,
  normalizeNwsFeature,
  normalizeNwsPayload,
  fetchAlerts,
  nwsProvider,
  NWS_CACHE_TTL_MS,
  __clearNwsCacheForTests,
} from "./nws-alerts.js";

const OKLAHOMA = { lat: 35.4676, lon: -97.5164 };
const PARIS = { lat: 48.8566, lon: 2.3522 };

/* A feature shaped exactly like api.weather.gov/alerts/active returns one
   (field names verified against the live service). */
const feature = (props = {}, geometry = null) => ({
  type: "Feature",
  geometry,
  properties: {
    "@id": "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc",
    id: "urn:oid:2.49.0.1.840.0.abc",
    event: "Tornado Warning",
    areaDesc: "Cleveland County, OK",
    severity: "Extreme",
    certainty: "Observed",
    urgency: "Immediate",
    status: "Actual",
    messageType: "Alert",
    senderName: "NWS Norman OK",
    headline: "Tornado Warning issued for Cleveland County",
    effective: "2026-09-22T18:00:00-05:00",
    expires: "2026-09-22T18:45:00-05:00",
    web: "http://www.weather.gov",
    ...props,
  },
});

describe("coversUnitedStates", () => {
  it("covers the contiguous states, Alaska, Hawaii and the territories", () => {
    expect(coversUnitedStates(OKLAHOMA)).toBe(true);
    expect(coversUnitedStates({ lat: 61.2181, lon: -149.9003 })).toBe(true); /* Anchorage */
    expect(coversUnitedStates({ lat: 21.3099, lon: -157.8581 })).toBe(true); /* Honolulu */
    expect(coversUnitedStates({ lat: 18.4655, lon: -66.1057 })).toBe(true); /* San Juan */
    expect(coversUnitedStates({ lat: 13.4443, lon: 144.7937 })).toBe(true); /* Guam */
  });

  it("does not cover anywhere the NWS does not issue for", () => {
    expect(coversUnitedStates(PARIS)).toBe(false);
    expect(coversUnitedStates({ lat: 35.6762, lon: 139.6503 })).toBe(false); /* Tokyo */
    expect(coversUnitedStates({ lat: 19.43, lon: -99.13 })).toBe(false); /* Mexico City */
  });

  it("uses the resolved country, which a bounding box alone cannot get right", () => {
    /* Toronto and Tijuana sit inside any rectangle drawn around the lower
       48, so the country code has to win */
    expect(coversUnitedStates({ lat: 43.65, lon: -79.38, cc: "CA" })).toBe(false);
    expect(coversUnitedStates({ lat: 32.51, lon: -117.04, cc: "MX" })).toBe(false);
    expect(coversUnitedStates({ ...OKLAHOMA, cc: "US" })).toBe(true);
    expect(coversUnitedStates({ lat: 18.4655, lon: -66.1057, cc: "PR" })).toBe(true);
  });

  it("falls back to the bounding box only while the country is still unknown", () => {
    expect(coversUnitedStates({ ...OKLAHOMA, cc: "" })).toBe(true);
    expect(coversUnitedStates(PARIS)).toBe(false);
  });

  it("rejects a place with no usable coordinates rather than guessing", () => {
    expect(coversUnitedStates(null)).toBe(false);
    expect(coversUnitedStates({})).toBe(false);
    expect(coversUnitedStates({ lat: "abc", lon: -97 })).toBe(false);
    expect(coversUnitedStates({ lat: NaN, lon: NaN })).toBe(false);
  });
});

describe("nwsAlertsUrl", () => {
  it("asks the official endpoint for the selected point", () => {
    const url = nwsAlertsUrl(OKLAHOMA);
    expect(url.origin).toBe("https://api.weather.gov");
    expect(url.pathname).toBe("/alerts/active");
    expect(url.searchParams.get("point")).toBe("35.4676,-97.5164");
  });

  it("carries no key, token or credential", () => {
    const url = nwsAlertsUrl(OKLAHOMA);
    expect([...url.searchParams.keys()]).toEqual(["point"]);
  });
});

describe("alertTypeFromEvent", () => {
  it("calls a tornado a tornado, warning or watch", () => {
    expect(alertTypeFromEvent("Tornado Warning")).toBe("tornado");
    expect(alertTypeFromEvent("Tornado Watch")).toBe("tornado");
  });

  it("never invents a tornado from another event", () => {
    expect(alertTypeFromEvent("Severe Thunderstorm Warning")).toBe("severe-thunderstorm-warning");
    expect(alertTypeFromEvent("High Wind Warning")).toBe("high-wind-warning");
    expect(alertTypeFromEvent("Flash Flood Warning")).toBe("flash-flood-warning");
  });

  it("has no type for a missing event name", () => {
    expect(alertTypeFromEvent("")).toBe("");
    expect(alertTypeFromEvent(null)).toBe("");
  });
});

describe("isRelevantAlert", () => {
  it("keeps tornado warnings and watches whatever their severity", () => {
    expect(isRelevantAlert(feature().properties)).toBe(true);
    expect(
      isRelevantAlert(feature({ event: "Tornado Watch", severity: "Moderate" }).properties),
    ).toBe(true);
  });

  it("keeps the alerts the NWS itself classed Extreme or Severe", () => {
    expect(
      isRelevantAlert(
        feature({ event: "Severe Thunderstorm Warning", severity: "Severe" }).properties,
      ),
    ).toBe(true);
  });

  it("drops routine advisories the issuer did not class as severe", () => {
    expect(
      isRelevantAlert(feature({ event: "Small Craft Advisory", severity: "Minor" }).properties),
    ).toBe(false);
    expect(
      isRelevantAlert(feature({ event: "Frost Advisory", severity: "Moderate" }).properties),
    ).toBe(false);
  });

  it("never lets a TEST message reach a visitor, even a tornado one", () => {
    expect(isRelevantAlert(feature({ status: "Test" }).properties)).toBe(false);
    expect(isRelevantAlert(feature({ status: "Exercise" }).properties)).toBe(false);
    expect(isRelevantAlert(feature({ status: "Draft" }).properties)).toBe(false);
  });

  it("drops junk", () => {
    expect(isRelevantAlert(null)).toBe(false);
    expect(isRelevantAlert({})).toBe(false);
  });
});

describe("normalizeNwsFeature", () => {
  it("keeps every fact the panel must show", () => {
    expect(normalizeNwsFeature(feature())).toMatchObject({
      type: "tornado",
      event: "Tornado Warning",
      urgency: "Immediate",
      certainty: "Observed",
      severity: "Extreme",
      authority: "NWS Norman OK",
      area: { name: "Cleveland County, OK" },
      source: {
        name: "National Weather Service",
        url: "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc",
      },
    });
  });

  it("attributes to the https alert record, never the http web link", () => {
    /* properties.web is plain http on the live service, which the seam
       rejects — using it would silently drop every alert */
    const alert = normalizeNwsFeature(feature());
    expect(alert.source.url.startsWith("https://")).toBe(true);
    expect(alert.source.url).not.toBe("http://www.weather.gov");
  });

  it("keeps the polygon when the NWS published one", () => {
    const geometry = {
      type: "Polygon",
      coordinates: [
        [
          [-97, 35],
          [-97, 36],
          [-96, 36],
          [-97, 35],
        ],
      ],
    };
    expect(normalizeNwsFeature(feature({}, geometry)).area.geometry).toEqual(geometry);
  });

  it("still works for a zone-based alert with no polygon — most alerts have none", () => {
    const alert = normalizeNwsFeature(feature());
    expect(alert.area.geometry).toBeNull();
    expect(alert.area.name).toBe("Cleveland County, OK");
  });

  it("drops an alert missing any fact the panel must show", () => {
    for (const field of ["event", "areaDesc", "severity", "senderName", "effective", "@id"]) {
      const f = feature();
      delete f.properties[field];
      expect(normalizeNwsFeature(f), `missing ${field}`).toBeNull();
    }
  });

  it("falls back to the issuer's other published times rather than inventing one", () => {
    const f = feature({ effective: undefined, sent: "2026-09-22T18:00:00-05:00" });
    expect(normalizeNwsFeature(f).starts).toBe("2026-09-22T18:00:00-05:00");
    const g = feature({ expires: undefined, ends: "2026-09-22T19:00:00-05:00" });
    expect(normalizeNwsFeature(g).expires).toBe("2026-09-22T19:00:00-05:00");
  });

  it("drops a test message and an irrelevant advisory", () => {
    expect(normalizeNwsFeature(feature({ status: "Test" }))).toBeNull();
    expect(
      normalizeNwsFeature(feature({ event: "Small Craft Advisory", severity: "Minor" })),
    ).toBeNull();
  });

  it("drops junk", () => {
    expect(normalizeNwsFeature(null)).toBeNull();
    expect(normalizeNwsFeature({})).toBeNull();
    expect(normalizeNwsFeature({ properties: null })).toBeNull();
  });
});

describe("normalizeNwsPayload", () => {
  it("reads a FeatureCollection and keeps only usable alerts", () => {
    const payload = {
      type: "FeatureCollection",
      features: [
        feature(),
        feature({ status: "Test" }),
        feature({ event: "Frost Advisory", severity: "Minor" }),
      ],
    };
    const alerts = normalizeNwsPayload(payload);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("tornado");
  });

  it("an empty list is a real answer, not an error", () => {
    expect(normalizeNwsPayload({ type: "FeatureCollection", features: [] })).toEqual([]);
  });

  it("rejects anything that is not a FeatureCollection", () => {
    for (const junk of [null, undefined, {}, { features: "no" }, [], "text"]) {
      expect(() => normalizeNwsPayload(junk)).toThrowError(
        expect.objectContaining({ kind: "malformed" }),
      );
    }
  });
});

describe("fetchAlerts", () => {
  const originalFetch = globalThis.fetch;
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  beforeEach(() => __clearNwsCacheForTests());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("asks the NWS and returns its alerts", async () => {
    globalThis.fetch = vi.fn(async () => ok({ type: "FeatureCollection", features: [feature()] }));
    const alerts = await fetchAlerts(OKLAHOMA);
    expect(alerts).toHaveLength(1);
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain("api.weather.gov/alerts/active");
  });

  it("caches only as long as the provider permits", () => {
    expect(NWS_CACHE_TTL_MS).toBe(5000);
  });

  it("collapses duplicate calls for the same point inside that window", async () => {
    globalThis.fetch = vi.fn(async () => ok({ type: "FeatureCollection", features: [] }));
    await Promise.all([fetchAlerts(OKLAHOMA), fetchAlerts(OKLAHOMA)]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces an HTTP failure instead of reporting no alerts", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(fetchAlerts(OKLAHOMA)).rejects.toMatchObject({ kind: "http" });
  });

  it("surfaces a malformed answer instead of reporting no alerts", async () => {
    globalThis.fetch = vi.fn(async () => ok({ nope: true }));
    await expect(fetchAlerts(OKLAHOMA)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("cancels the request when the caller leaves", async () => {
    const pending = [];
    globalThis.fetch = vi.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          pending.push({ signal });
        }),
    );
    const controller = new AbortController();
    const request = fetchAlerts(OKLAHOMA, { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ kind: "aborted" });
    expect(pending[0].signal.aborted).toBe(true);
  });
});

describe("the provider object", () => {
  it("declares itself official, named and covering the United States", () => {
    expect(nwsProvider.id).toBe("nws-us");
    expect(nwsProvider.name).toBe("National Weather Service");
    expect(nwsProvider.official).toBe(true);
    expect(nwsProvider.covers(OKLAHOMA)).toBe(true);
    expect(nwsProvider.covers(PARIS)).toBe(false);
  });
});
