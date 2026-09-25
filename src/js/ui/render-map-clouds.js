/* OpenWeatherMap cloud-cover panel. The clouds themselves are raster tiles the
 * map draws; this panel only says what state that layer is in, and carries the
 * provider credit. It reuses the lightning panel's status/meta styles so the
 * two point-in-time overlays look alike. */
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { CLOUDS_ATTRIBUTION_URL } from "../services/openweather-clouds.js";

const ERROR_KEYS = {
  timeout: "mapCloudsTimeout",
  offline: "mapCloudsOffline",
  unavailable: "mapCloudsUnavailable",
  rate_limited: "mapCloudsRateLimited",
};

/* The credit is a real link, so it works for keyboard users too. */
function attributionHtml() {
  return `<p class="map-lightning-meta map-clouds-meta">${esc(t("mapCloudsProvider"))}
    <a href="${CLOUDS_ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">OpenWeatherMap</a></p>`;
}

function errorKey(errorKind) {
  return ERROR_KEYS[errorKind] || "mapCloudsError";
}

export function cloudsAnnouncement(state) {
  if (!state || state.status === "idle") return "";
  if (state.status === "loading") return t("mapCloudsLoading");
  if (state.status === "ready") return t("mapCloudsReady");
  return t(errorKey(state.errorKind));
}

export function renderCloudsUI(cloudsState) {
  const host = $("#mapWeatherControls");
  if (!host) return;
  if (!cloudsState || cloudsState.status === "idle") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const { status, errorKind } = cloudsState;
  if (status === "loading") {
    host.innerHTML = `<p class="map-lightning-status map-clouds-status" data-loading="1">${esc(t("mapCloudsLoading"))}</p>`;
  } else if (status === "ready") {
    host.innerHTML = `<p class="map-lightning-status map-clouds-status" data-state="clear">${esc(t("mapCloudsReady"))}</p>${attributionHtml()}`;
  } else {
    host.innerHTML = `<p class="map-lightning-status map-clouds-status" data-state="error">${esc(t(errorKey(errorKind)))}</p>`;
  }
}
