/* Official-alert panel state, derived from what an issuer published.
 *
 * Pure, and takes an explicit `nowMs`, so every branch — including expiry —
 * is unit-testable with plain objects (same approach as map-legend.js's
 * buildLegend and features/humidity-state.js). features/map.js supplies the
 * real arguments and owns the DOM.
 *
 * The four statuses are deliberately distinct, because conflating any two of
 * them would mislead:
 *   unsupported  no verified issuer covers this place. NOT "no tornado" —
 *                the app knows nothing here and must say exactly that.
 *   error        an issuer covers it but could not be reached. Also NOT
 *                "no tornado": a failed request is not an all-clear.
 *   clear        an issuer answered, with no active alert. The only state
 *                that may reassure.
 *   active       one or more alerts, currently in force. */
import { isActiveAlert } from "../services/alert-provider.js";

/* The issuer's own CAP vocabularies, most urgent first. Anything outside a
   list sorts last rather than being guessed at. */
export const SEVERITY_ORDER = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];
export const URGENCY_ORDER = ["Immediate", "Expected", "Future", "Past", "Unknown"];

function rankOf(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

/**
 * Most serious first, using only fields the issuer set: its own severity,
 * then its own urgency, then the most recently issued. Never re-scored from
 * weather values.
 */
export function sortAlerts(alerts) {
  return [...alerts].sort(
    (a, b) =>
      rankOf(SEVERITY_ORDER, a.severity) - rankOf(SEVERITY_ORDER, b.severity) ||
      rankOf(URGENCY_ORDER, a.urgency) - rankOf(URGENCY_ORDER, b.urgency) ||
      b.starts - a.starts,
  );
}

/**
 * @param {{status:"unavailable"|"ok"|"error", alerts:object[], sources:object[]}} result
 * @param {number} nowMs
 * @returns {{status:"unsupported"|"error"|"clear"|"active", alerts:object[], sources:object[]}}
 */
export function computeAlertsState(result, nowMs = Date.now()) {
  if (!result || result.status === "unavailable") {
    return { status: "unsupported", alerts: [], sources: [], errorKind: null };
  }
  if (result.status === "error") {
    /* the issuer's failure kind, so the panel can name it ("you're
       offline", "timed out") instead of one shapeless error */
    return { status: "error", alerts: [], sources: [], errorKind: result.errorKind || "network" };
  }
  /* an alert outside its own published window is over — it is never shown,
     and never counted towards "there are alerts" */
  const alerts = sortAlerts((result.alerts || []).filter((a) => isActiveAlert(a, nowMs)));
  return {
    status: alerts.length ? "active" : "clear",
    alerts,
    sources: result.sources || [],
    errorKind: null,
  };
}

/* Whether any alert in force is a tornado alert — drives the panel's tone
   only; the list itself stays in the issuer's own severity order above. */
export function hasTornadoAlert(alerts) {
  return (alerts || []).some((a) => a?.type === "tornado");
}
