/* The official-alerts panel for the map's Alerts layer.
 *
 * Every word here is either the issuing authority's own, or one of the
 * fixed states below. Three of those states look similar on screen and must
 * never be confused with one another:
 *
 *   unsupported  no official issuer covers this place → "No official alert
 *                coverage available for this location". NEVER "no tornado":
 *                the app has no information about this place at all.
 *   error        an issuer covers it but could not be reached → says so.
 *                Also never an all-clear.
 *   clear        an issuer answered with nothing in force → the only state
 *                allowed to reassure, and it names the issuer that said so.
 *
 * Like the Air Quality and Humidity panels this is a point reading for the
 * selected place sharing #mapWeatherControls, not a rendered map layer —
 * see features/map.js, which also draws the alert polygon on the map when
 * the issuer published one (most NWS alerts are zone-based and carry none).
 * This panel always states the affected area in words as well, so nothing
 * depends on being able to see or read the map. */
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtDateTime } from "../core/datetime.js";

const ERROR_MESSAGE_KEYS = {
  timeout: "mapAlertsTimeout",
  offline: "mapAlertsOffline",
  http: "mapAlertsHttpError",
  malformed: "mapAlertsMalformed",
};

function statusHtml(status, errorKind) {
  if (status === "loading") {
    return `<p class="map-aqi-status" data-loading="1">${esc(t("mapAlertsLoading"))}</p>`;
  }
  if (status === "unsupported") {
    /* deliberately not "no alerts" and never "no tornado" */
    return `<p class="map-aqi-status" data-state="unsupported">${esc(t("mapAlertsNoCoverage"))}</p>`;
  }
  if (status === "clear") {
    return `<p class="map-aqi-status" data-state="clear">${esc(t("mapAlertsNone"))}</p>`;
  }
  const key = ERROR_MESSAGE_KEYS[errorKind] || "mapAlertsError";
  return `<p class="map-aqi-status" data-state="error">${esc(t(key))}</p>`;
}

/* The issuer's own CAP wording, shown as a labelled fact rather than
   reinterpreted. An empty value is omitted, never filled in with a guess. */
function factRow(labelKey, value) {
  if (!value) return "";
  return `
    <div class="map-alert-fact">
      <dt>${esc(t(labelKey))}</dt>
      <dd>${esc(value)}</dd>
    </div>`;
}

function alertHtml(alert) {
  const tornado = alert.type === "tornado";
  return `
    <li class="map-alert${tornado ? " is-tornado" : ""}" data-alert-type="${esc(alert.type)}">
      <p class="map-alert-badge">${esc(t("mapAlertsOfficial"))}</p>
      <h2 class="map-alert-event">${esc(alert.event)}</h2>
      <dl class="map-alert-facts">
        ${factRow("mapAlertsSeverity", alert.severity)}
        ${factRow("mapAlertsUrgency", alert.urgency)}
        ${factRow("mapAlertsCertainty", alert.certainty)}
        ${factRow("mapAlertsArea", alert.area)}
        ${factRow("mapAlertsAuthority", alert.authority)}
        ${factRow("mapAlertsStarts", fmtDateTime(alert.starts))}
        ${factRow("mapAlertsExpires", fmtDateTime(alert.expires))}
      </dl>
      <a class="map-alert-source" href="${esc(alert.source.url)}" target="_blank" rel="noopener noreferrer">${esc(
        t("mapAlertsSource").replace("{name}", alert.source.name),
      )}</a>
    </li>`;
}

function readyHtml(alertsState) {
  const list = alertsState.alerts.map(alertHtml).join("");
  return `
    <div class="map-alerts" data-state="active">
      <ol class="map-alerts-list">${list}</ol>
    </div>`;
}

/* One short sentence for the panel's live region (features/map.js): which
   official alerts are in force, or exactly why there is nothing to show —
   never merely silence, and never "no tornado" outside coverage. */
export function alertsAnnouncement(alertsState) {
  if (!alertsState || alertsState.status === "idle") return "";
  if (alertsState.status === "loading") return t("mapAlertsLoading");
  if (alertsState.status === "active") {
    return `${t("mapAlertsOfficial")}, ${alertsState.alerts.map((a) => a.event).join(", ")}`;
  }
  if (alertsState.status === "clear") return t("mapAlertsNone");
  if (alertsState.status === "unsupported") return t("mapAlertsNoCoverage");
  return t(ERROR_MESSAGE_KEYS[alertsState.errorKind] || "mapAlertsError");
}

/**
 * Repaint the Alerts panel.
 * @param {{status:"idle"|"loading"|"active"|"clear"|"unsupported"|"error",
 *   alerts: object[], errorKind: string|null}} alertsState
 */
export function renderAlertsUI(alertsState) {
  const host = $("#mapWeatherControls");
  if (!host) return;

  if (!alertsState || alertsState.status === "idle") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  host.hidden = false;
  /* Screen readers hear the result through #mapLayerStatus, a polite live
     region features/map.js fills from alertsAnnouncement() above — this
     markup is rebuilt on every repaint, so it cannot announce itself. */
  host.innerHTML =
    alertsState.status === "active"
      ? readyHtml(alertsState)
      : statusHtml(alertsState.status, alertsState.errorKind);
}
