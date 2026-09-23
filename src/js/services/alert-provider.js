/* Official severe-weather alerts — the seam every official issuer plugs into.
 *
 * STATUS: one source is connected — the U.S. National Weather Service
 * (services/nws-alerts.js). Inside NWS territory the functions below report
 * real, published alerts (and a genuine "none" when the NWS answers with an
 * empty list). ANYWHERE ELSE they still report "unavailable", so the app
 * draws no layer, badge or "no alerts" reassurance outside that coverage.
 *
 * WHAT EXISTS TODAY AND WHY IT IS NOT ENOUGH
 * features/advisories.js derives hazards (thunderstorm, strong gusts, …) from
 * the Open-Meteo forecast. Those are advisories computed from model output,
 * and the interface says so. They are not warnings from a meteorological
 * authority, and nothing in them can say "a tornado has been sighted or
 * warned". Wind, rain and pressure do NOT indicate a tornado, and this module
 * is deliberately unable to be handed any of them: its only input is what an
 * official provider itself issued.
 *
 * WHAT A PROVIDER MUST BE
 * A provider is only listed here once its source has been verified as an
 * official issuer (for example a national weather service publishing CAP
 * alerts for its own territory) and its licence allows this use. It is an
 * object:
 *
 *   {
 *     id:        "nws-us",                      stable, lower-case
 *     name:      "National Weather Service",     shown as attribution
 *     official:  true,                           must be literally true
 *     covers(loc)               → boolean        does it issue for this place?
 *     fetchAlerts(loc, {signal}) → Promise<RawAlert[]>
 *   }
 *
 * WHAT AN ALERT MUST CARRY (anything less is dropped, never "best-effort")
 *   type       the provider's own event class — "tornado" is only ever a value
 *              the provider set from an official event code
 *   area       the affected area (name and/or geometry)
 *   severity   the authority's own severity wording
 *   authority  who issued it
 *   starts / expires   ISO times; an alert outside its window is not active
 *   source     { name, url } — attribution, shown wherever the alert is
 *
 * WHEN A UI IS BUILT ON THIS
 * It must show: the affected area, alert type, severity, issuing authority,
 * start and expiry, a text alternative for anything drawn on the map, the
 * source attribution — and, ONLY while a source is connected and reachable, a
 * clear "No tornado alerts" state. With no source the honest state is to show
 * nothing at all, which is what tornadoLayerModel() returns. */
import { nwsProvider } from "./nws-alerts.js";
import { isWeatherError } from "../weather/weather-errors.js";

/* Verified official issuers. The U.S. National Weather Service is verified:
   an official government issuer publishing CAP alerts for its own
   territory, over a documented keyless endpoint — see services/nws-alerts.js.
   It covers the United States only, so everywhere else still resolves to
   "unavailable" and the app says nothing rather than "no tornado". */
export const OFFICIAL_ALERT_PROVIDERS = [nwsProvider];

export const REQUIRED_ALERT_FIELDS = [
  "type",
  "area",
  "severity",
  "authority",
  "starts",
  "expires",
  "source",
];

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
const time = (v) => {
  const ms = typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const httpsUrl = (v) => {
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};

/**
 * Validate one raw alert from a provider. Returns the normalised alert, or
 * null when it cannot be verified as complete — an incomplete alert is never
 * shown, because a half-attributed warning is worse than none.
 */
export function normalizeOfficialAlert(raw, provider) {
  if (!raw || typeof raw !== "object" || !provider || provider.official !== true) return null;
  const type = text(raw.type).toLowerCase();
  const area = text(raw.area?.name ?? raw.area);
  const severity = text(raw.severity);
  const authority = text(raw.authority);
  const starts = time(raw.starts);
  const expires = time(raw.expires);
  const sourceName = text(raw.source?.name) || text(provider.name);
  const sourceUrl = httpsUrl(raw.source?.url);
  if (!type || !area || !severity || !authority || !sourceName || !sourceUrl) return null;
  if (starts === null || expires === null || expires <= starts) return null;
  return {
    type,
    /* The issuer's own event name and CAP qualifiers, carried through for
       renderers that show them. Optional on purpose — they are NOT in
       REQUIRED_ALERT_FIELDS, so an issuer that does not publish them still
       produces a valid alert rather than being dropped. Empty string, never
       invented. */
    event: text(raw.event) || type,
    urgency: text(raw.urgency),
    certainty: text(raw.certainty),
    headline: text(raw.headline),
    area,
    geometry: raw.area?.geometry ?? null,
    severity,
    authority,
    starts,
    expires,
    source: { name: sourceName, url: sourceUrl },
    providerId: provider.id,
  };
}

/* Inside its own window. */
export function isActiveAlert(alert, nowMs = Date.now()) {
  return Boolean(alert) && alert.starts <= nowMs && nowMs < alert.expires;
}

/**
 * Ask every verified provider that covers `loc`.
 *
 * @returns {Promise<{status:"unavailable"|"ok"|"error", alerts:object[], sources:object[]}>}
 *   unavailable  no verified provider covers this place — say nothing
 *   ok           at least one provider answered (an empty list is a real "none")
 *   error        every covering provider failed — never presented as "none"
 */
export async function fetchOfficialAlerts(
  loc,
  { providers = OFFICIAL_ALERT_PROVIDERS, signal } = {},
) {
  const covering = (Array.isArray(providers) ? providers : []).filter(
    (p) => p && p.official === true && typeof p.covers === "function" && p.covers(loc) === true,
  );
  if (covering.length === 0) return { status: "unavailable", alerts: [], sources: [] };

  const settled = await Promise.allSettled(
    covering.map(async (p) => ({ provider: p, raw: await p.fetchAlerts(loc, { signal }) })),
  );
  const answered = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (answered.length === 0) {
    /* Carry WHY it failed, so the UI can say "you're offline" or "timed
       out" rather than one shapeless error — but still never "no alerts". */
    const reason = settled.find((r) => r.status === "rejected")?.reason;
    return {
      status: "error",
      errorKind: isWeatherError(reason) ? reason.kind : "network",
      alerts: [],
      sources: [],
    };
  }

  const alerts = answered.flatMap(({ provider, raw }) =>
    (Array.isArray(raw) ? raw : []).map((a) => normalizeOfficialAlert(a, provider)).filter(Boolean),
  );
  return {
    status: "ok",
    alerts,
    sources: answered.map(({ provider }) => ({ id: provider.id, name: provider.name })),
  };
}

export const isTornadoAlert = (alert) => alert?.type === "tornado";

/**
 * What a tornado overlay should do, given an answer from fetchOfficialAlerts.
 *
 *   state "no-source"  nothing verified covers this place → draw NOTHING
 *   state "error"      a source exists but failed         → draw nothing
 *   state "clear"      a source answered, none active     → "No tornado alerts"
 *   state "active"     one or more active tornado alerts  → draw them
 */
export function tornadoLayerModel(result, nowMs = Date.now()) {
  if (!result || result.status === "unavailable") {
    return { state: "no-source", visible: false, showClearState: false, alerts: [], sources: [] };
  }
  if (result.status === "error") {
    return { state: "error", visible: false, showClearState: false, alerts: [], sources: [] };
  }
  const alerts = result.alerts.filter((a) => isTornadoAlert(a) && isActiveAlert(a, nowMs));
  return {
    state: alerts.length ? "active" : "clear",
    visible: alerts.length > 0,
    showClearState: alerts.length === 0,
    alerts,
    sources: result.sources,
  };
}

/* The facts a renderer must present for one alert, in reading order. Wording
   and translation belong to the renderer; this is only the contract. */
export function alertFacts(alert) {
  if (!alert) return [];
  return [
    { key: "type", value: alert.type },
    { key: "severity", value: alert.severity },
    { key: "area", value: alert.area },
    { key: "authority", value: alert.authority },
    { key: "starts", value: alert.starts },
    { key: "expires", value: alert.expires },
    { key: "source", value: alert.source.name, href: alert.source.url },
  ];
}
