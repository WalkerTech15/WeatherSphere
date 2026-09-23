/* The U.S. National Weather Service as an official alert issuer.
 *
 * This is the first provider plugged into services/alert-provider.js's seam
 * (see its header for what a provider must be). Everything here comes from
 * what the NWS itself published: no alert is ever derived from wind, rain,
 * pressure, a weather code or lightning, and no alert is ever synthesised.
 *
 * ENDPOINT   https://api.weather.gov/alerts/active?point=<lat>,<lon>
 *   Official, documented, and needs no API key or account — verified against
 *   the live service, which answers `Access-Control-Allow-Origin: *`, so the
 *   browser calls it directly with no proxy and no secret.
 *
 * COVERAGE   The endpoint answers HTTP 400 ("Parameter \"point\" is invalid:
 *   out of bounds") for anywhere it does not issue for, which is NOT the same
 *   as "no alerts". coversUnitedStates() gates the request so a place outside
 *   NWS territory is reported as *uncovered* rather than as reassuringly
 *   clear — the app must never tell someone in France that there is no
 *   tornado. The boxes below are deliberately generous: a point inside them
 *   that the NWS still rejects surfaces as an error (never as "none"),
 *   which alert-provider.js already guarantees.
 *
 * CACHING    The service sends `Cache-Control: public, max-age=5`, so this
 *   module caches for 5 seconds and no longer — long enough to collapse the
 *   duplicate calls one location change can trigger, short enough to stay
 *   inside what the provider permits. The app's ordinary 5-MINUTE weather
 *   cache is deliberately NOT reused here: a warning is not a forecast.
 *
 * SOURCE LINK  `properties.web` is plain http (verified live), which the
 *   seam rejects on purpose, so the canonical `properties["@id"]` — https,
 *   official, and specific to that one alert — is used for attribution. */
import { requestJson, malformed } from "../weather/weather-errors.js";
import { createSharedRequestCache } from "../weather/weather-cache.js";

export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";
export const NWS_PROVIDER_ID = "nws-us";
export const NWS_PROVIDER_NAME = "National Weather Service";

/* Matches the provider's own `Cache-Control: max-age=5`. */
export const NWS_CACHE_TTL_MS = 5000;

/* Where the NWS issues alerts: the 50 states plus the territories the API
   accepts (verified live for Alaska, Hawaii and Puerto Rico). */
const US_COVERAGE = [
  { minLat: 24.4, maxLat: 49.5, minLon: -125.1, maxLon: -66.9 } /* contiguous 48 */,
  { minLat: 51.0, maxLat: 71.6, minLon: -179.9, maxLon: -129.0 } /* Alaska */,
  { minLat: 18.7, maxLat: 22.4, minLon: -160.5, maxLon: -154.7 } /* Hawaii */,
  { minLat: 17.6, maxLat: 18.6, minLon: -67.5, maxLon: -64.5 } /* Puerto Rico + USVI */,
  { minLat: 13.2, maxLat: 20.6, minLon: 144.5, maxLon: 146.2 } /* Guam + N. Marianas */,
  { minLat: -14.7, maxLat: -14.0, minLon: -171.2, maxLon: -169.3 } /* American Samoa */,
];

/* ISO codes of the territories the NWS issues for. */
const US_COUNTRY_CODES = new Set(["US", "PR", "VI", "GU", "MP", "AS", "UM"]);

/**
 * Does the NWS issue alerts for this place? Two signals, in order:
 *
 *   1. the resolved country code, when the place has one. This is the
 *      authoritative answer — a bounding box cannot tell Toronto or Tijuana
 *      from the United States, and telling someone in Canada anything about
 *      U.S. alerts would be wrong in both directions.
 *   2. a bounding box, only when no country is known yet (a fresh map click
 *      whose reverse geocoding has not landed). Generous on purpose: a point
 *      inside it that the NWS itself rejects comes back as an ERROR, which is
 *      never presented as "no alerts".
 *
 * Coordinates and country only — never the weather at the place.
 */
export function coversUnitedStates(loc) {
  const cc = typeof loc?.cc === "string" ? loc.cc.trim().toUpperCase() : "";
  if (cc) return US_COUNTRY_CODES.has(cc);

  const lat = Number(loc?.lat);
  const lon = Number(loc?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return US_COVERAGE.some(
    (box) => lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon,
  );
}

export function nwsAlertsUrl(loc) {
  const url = new URL(NWS_ALERTS_URL);
  /* the API wants "lat,lon" rounded — 4 decimals is ~11 m, far finer than
     any alert polygon, and keeps the cache key stable across tiny jitter */
  url.searchParams.set("point", `${Number(loc.lat).toFixed(4)},${Number(loc.lon).toFixed(4)}`);
  return url;
}

const TORNADO_EVENT = /\btornado\b/i;

/**
 * The internal type for one NWS event name. "tornado" is returned only when
 * the NWS event itself says tornado — never inferred from severity, wind or
 * anything else. Any other event keeps its own name as a slug.
 */
export function alertTypeFromEvent(event) {
  const name = typeof event === "string" ? event.trim() : "";
  if (!name) return "";
  if (TORNADO_EVENT.test(name)) return "tornado";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Which published alerts this feature shows. Two rules, both read straight
 * off the alert:
 *   1. it must be a real one — CAP `status` "Actual" excludes the NWS's own
 *      Test/Exercise/Draft messages, which must never reach a visitor;
 *   2. it must be a tornado alert (warning OR watch), or an alert the NWS
 *      itself classed Extreme or Severe.
 * Nothing here looks at weather values.
 */
export function isRelevantAlert(props) {
  if (!props || props.status !== "Actual") return false;
  if (TORNADO_EVENT.test(String(props.event || ""))) return true;
  return props.severity === "Extreme" || props.severity === "Severe";
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");

/**
 * One GeoJSON feature → the raw alert shape alert-provider.js validates.
 * Returns null when the feature is unusable, so a half-formed warning is
 * dropped rather than shown with gaps.
 */
export function normalizeNwsFeature(feature) {
  const props = feature?.properties;
  if (!props || !isRelevantAlert(props)) return null;

  const event = str(props.event);
  const type = alertTypeFromEvent(event);
  const area = str(props.areaDesc);
  const severity = str(props.severity);
  const authority = str(props.senderName);
  /* `effective` is when the alert came into force; /alerts/active only ever
     returns alerts in force, so this (not the optional future `onset`) is
     the honest start. */
  const starts = str(props.effective) || str(props.sent);
  const expires = str(props.expires) || str(props.ends);
  const url = str(props["@id"]);
  if (!type || !event || !area || !severity || !authority || !starts || !expires || !url) {
    return null;
  }

  return {
    type,
    event,
    /* the authority's own wording, shown verbatim and never re-ranked */
    urgency: str(props.urgency),
    certainty: str(props.certainty),
    headline: str(props.headline),
    area: { name: area, geometry: feature.geometry ?? null },
    severity,
    authority,
    starts,
    expires,
    source: { name: NWS_PROVIDER_NAME, url },
  };
}

/** Whole payload → raw alerts. Throws `malformed` on anything else. */
export function normalizeNwsPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.features)) {
    throw malformed("NWS alerts payload is not a FeatureCollection");
  }
  return payload.features.map(normalizeNwsFeature).filter(Boolean);
}

/* 5-second cache — see the header. Its own instance and key space, never
   shared with forecast data. */
const alertsCache = createSharedRequestCache(NWS_CACHE_TTL_MS);

export function nwsAlertsCacheKey(loc) {
  return `${NWS_PROVIDER_ID}:${Number(loc.lat).toFixed(4)},${Number(loc.lon).toFixed(4)}`;
}

export function fetchAlerts(loc, { signal } = {}) {
  return alertsCache.get(
    nwsAlertsCacheKey(loc),
    async (requestSignal) =>
      normalizeNwsPayload(await requestJson(nwsAlertsUrl(loc), { signal: requestSignal })),
    signal,
  );
}

/* The provider object alert-provider.js consumes. */
export const id = NWS_PROVIDER_ID;
export const name = NWS_PROVIDER_NAME;
export const official = true;
export const covers = coversUnitedStates;

export const nwsProvider = { id, name, official, covers, fetchAlerts };

export function __clearNwsCacheForTests() {
  alertsCache.clear();
}
