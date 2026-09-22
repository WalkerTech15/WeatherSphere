/* The Air Quality map-layer panel: a point reading for the currently
 * selected place (features/map.js's airQualityState), not a rendered map
 * layer — Open-Meteo's Air Quality API has no spatial/tile product, so
 * there is nothing to draw on the map itself. Shares #mapWeatherControls
 * with the ramp-legend UI (ui/render-map-weather.js); only one of the two
 * is ever asked to render at a time, driven by the overlay's own type.
 *
 * `current.time` comes back in the PLACE's own local time (timezone=auto —
 * see providers/open-meteo.js), so it is formatted with the same
 * string-slicing helpers the rest of the app uses for a location's local
 * clock (core/datetime.js's fmtDate/fmtClock), never `new Date(time)`,
 * which would silently reinterpret it in the visitor's own zone. */
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtDate, fmtClock } from "../core/datetime.js";
import { classifyAqi } from "../data/air-quality.js";

const ERROR_MESSAGE_KEYS = {
  timeout: "mapAqiTimeout",
  offline: "mapAqiOffline",
  http: "mapAqiHttpError",
  malformed: "mapAqiMalformed",
  unavailable: "mapAqiUnavailable",
};

function statusHtml(status, errorKind) {
  if (status === "loading") {
    return `<p class="map-aqi-status" data-loading="1">${esc(t("mapAqiLoading"))}</p>`;
  }
  const key = ERROR_MESSAGE_KEYS[errorKind] || "mapAqiError";
  return `<p class="map-aqi-status" data-state="error">${esc(t(key))}</p>`;
}

function pollutantRow(labelKey, value, unit) {
  return `
    <div class="map-aqi-item">
      <dt>${esc(t(labelKey))}</dt>
      <dd>${Math.round(value)}<span class="map-aqi-unit">${esc(unit)}</span></dd>
    </div>`;
}

function readyHtml(data) {
  const aq = classifyAqi(data.aqi);
  const updated = `${fmtDate(data.time.slice(0, 10))}, ${fmtClock(data.time)}`;
  return `
    <div class="map-aqi" data-state="ready">
      <div class="map-aqi-headline">
        <span class="map-aqi-value">${Math.round(data.aqi)}</span>
        <span class="map-aqi-badge ${aq.cls}">${esc(aq.label)}</span>
        <span class="map-aqi-index-label">${esc(t("mapAqiIndex"))}</span>
      </div>
      <dl class="map-aqi-grid">
        ${pollutantRow("mapAqiPm25", data.pm25, data.units.pm25)}
        ${pollutantRow("mapAqiPm10", data.pm10, data.units.pm10)}
        ${pollutantRow("mapAqiNo2", data.no2, data.units.no2)}
        ${pollutantRow("mapAqiO3", data.o3, data.units.o3)}
      </dl>
      <p class="map-aqi-meta">${esc(t("mapAqiProvider"))} · ${esc(
        t("mapAqiUpdated").replace("{time}", updated),
      )}</p>
    </div>`;
}

/**
 * Repaint the Air Quality panel.
 * @param {{status: "idle"|"loading"|"ready"|"error", data: object|null,
 *   errorKind: string|null}} aqiState
 */
export function renderAirQualityUI(aqiState) {
  const host = $("#mapWeatherControls");
  if (!host) return;

  if (!aqiState || aqiState.status === "idle") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  host.hidden = false;
  host.innerHTML =
    aqiState.status === "ready"
      ? readyHtml(aqiState.data)
      : statusHtml(aqiState.status, aqiState.errorKind);
}
