/* Xweather lightning panel. It reports recent provider observations only;
 * an empty response never means that lightning is impossible here. */
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";

const ERROR_KEYS = {
  timeout: "mapLightningTimeout",
  offline: "mapLightningOffline",
  http: "mapLightningHttpError",
  malformed: "mapLightningMalformed",
  unavailable: "mapLightningUnavailable",
  rate_limited: "mapLightningRateLimited",
};

/* Xweather's pulse types: cloud-to-ground and in-cloud. */
const TYPE_KEYS = { cg: "mapLightningCloudGround", ic: "mapLightningInCloud" };

export function strikeTypeLabel(type) {
  return t(TYPE_KEYS[String(type || "").toLowerCase()] || "mapLightningStrike");
}

function statusHtml(status, errorKind) {
  if (status === "loading")
    return `<p class="map-lightning-status" data-loading="1">${esc(t("mapLightningLoading"))}</p>`;
  /* "nothing nearby" is still Xweather's answer, so it carries the credit too */
  if (status === "empty")
    return `<p class="map-lightning-status" data-state="clear">${esc(t("mapLightningNone"))}</p>
    <p class="map-lightning-meta">${esc(t("mapLightningProvider"))}</p>`;
  if (status === "unsupported")
    return `<p class="map-lightning-status" data-state="unsupported">${esc(t("mapLightningUnavailable"))}</p>`;
  return `<p class="map-lightning-status" data-state="error">${esc(t(ERROR_KEYS[errorKind] || "mapLightningError"))}</p>`;
}

function readyHtml(data) {
  const rows = data.strikes
    .slice(0, 6)
    .map(
      (strike) => `
    <li class="map-lightning-strike"><span>${esc(strikeTypeLabel(strike.type))}</span><strong>${Number.isFinite(strike.amperage) ? `${Math.round(strike.amperage)} A` : "—"}</strong></li>`,
    )
    .join("");
  return `<div class="map-lightning" data-state="ready">
    <p class="map-lightning-count">${esc(t("mapLightningRecent").replace("{n}", String(data.strikes.length)))}</p>
    <ul class="map-lightning-list">${rows}</ul>
    <p class="map-lightning-meta">${esc(t("mapLightningProvider"))}</p>
  </div>`;
}

export function lightningAnnouncement(state) {
  if (!state || state.status === "idle") return "";
  if (state.status === "loading") return t("mapLightningLoading");
  if (state.status === "ready")
    return t("mapLightningRecent").replace("{n}", String(state.data.strikes.length));
  if (state.status === "empty") return t("mapLightningNone");
  if (state.status === "unsupported") return t("mapLightningUnavailable");
  return t(ERROR_KEYS[state.errorKind] || "mapLightningError");
}

export function renderLightningUI(lightningState) {
  const host = $("#mapWeatherControls");
  if (!host) return;
  if (!lightningState || lightningState.status === "idle") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.innerHTML =
    lightningState.status === "ready"
      ? readyHtml(lightningState.data)
      : statusHtml(lightningState.status, lightningState.errorKind);
}
