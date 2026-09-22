/* The Humidity map-layer panel: a point reading for the currently selected
 * place (features/map.js's humidityState), not a rendered map layer —
 * MapTiler's weather SDK has no humidity overlay (only temperature, rain,
 * wind and pressure — see features/weather-layers.js's WEATHER_LAYER_IDS).
 * The reading itself comes from the app's already-fetched forecast
 * (state.wx), not a request of its own — see features/humidity-state.js.
 *
 * Shares #mapWeatherControls with the ramp-legend UI
 * (ui/render-map-weather.js) and the Air Quality panel
 * (ui/render-map-airquality.js); only one of the three ever renders at a
 * time, driven by the overlay's own type. Deliberately reuses the Air
 * Quality panel's `.map-aqi-*` classes (see styles/views/map.css) — the
 * same "status line / value + badge / meta line" shape applies here too, so
 * a second point-reading panel needed no new CSS. */
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtDateTime } from "../core/datetime.js";
import { classifyHumidity } from "../data/humidity.js";

const ERROR_MESSAGE_KEYS = {
  offline: "mapHumidityOffline",
  unavailable: "mapHumidityUnavailable",
  error: "mapHumidityError",
};

function statusHtml(status, errorKind) {
  if (status === "loading") {
    return `<p class="map-aqi-status" data-loading="1">${esc(t("mapHumidityLoading"))}</p>`;
  }
  const key = ERROR_MESSAGE_KEYS[errorKind] || "mapHumidityError";
  return `<p class="map-aqi-status" data-state="error">${esc(t(key))}</p>`;
}

function readyHtml(data) {
  const cat = classifyHumidity(data.humidity);
  const updated = fmtDateTime(data.updatedAt);
  return `
    <div class="map-aqi map-humidity" data-state="ready">
      <div class="map-aqi-headline">
        <span class="map-aqi-value">${Math.round(data.humidity)}<span class="map-aqi-unit">%</span></span>
        <span class="map-aqi-badge ${cat.cls}">${esc(cat.label)}</span>
        <span class="map-aqi-index-label">${esc(t("humidity"))}</span>
      </div>
      <p class="map-aqi-meta">${esc(t("mapHumidityProvider"))} · ${esc(
        t("mapHumidityUpdated").replace("{time}", updated),
      )}</p>
    </div>`;
}

/**
 * Repaint the Humidity panel.
 * @param {{status: "idle"|"loading"|"ready"|"error", data: object|null,
 *   errorKind: string|null}} humidityState
 */
export function renderHumidityUI(humidityState) {
  const host = $("#mapWeatherControls");
  if (!host) return;

  if (!humidityState || humidityState.status === "idle") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  host.hidden = false;
  host.innerHTML =
    humidityState.status === "ready"
      ? readyHtml(humidityState.data)
      : statusHtml(humidityState.status, humidityState.errorKind);
}
