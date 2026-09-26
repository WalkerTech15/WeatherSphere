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
 * a second point-reading panel needed no new CSS.
 *
 * The forecast-time row above the reading is the ramp layers' own (see
 * ui/render-map-weather.js): the reading is the place's hourly humidity at
 * the chosen hour, from the forecast already fetched. */
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtDateTime } from "../core/datetime.js";
import { classifyHumidity } from "../data/humidity.js";
import {
  timelineHtml,
  bindTimeline,
  focusedTimelineOffset,
  restoreTimelineFocus,
} from "./render-map-weather.js";

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

/* One short sentence for the panel's live region (features/map.js). */
export function humidityAnnouncement(humidityState) {
  if (!humidityState || humidityState.status === "idle") return "";
  if (humidityState.status === "loading") return t("mapHumidityLoading");
  if (humidityState.status === "ready") {
    const cat = classifyHumidity(humidityState.data.humidity);
    const reading = `${t("humidity")}, ${Math.round(humidityState.data.humidity)}%, ${cat.label}`;
    /* "now" needs no date; a later hour says which moment it is for */
    if (!humidityState.data.offset) return reading;
    return `${reading}. ${t("mapTimeShowing").replace("{time}", fmtDateTime(humidityState.data.timeMs))}`;
  }
  return t(ERROR_MESSAGE_KEYS[humidityState.errorKind] || "mapHumidityError");
}

/* What the shared timeline needs from a humidity state. While ready it names
   the moment shown; while loading or on an error it draws no status line of
   its own, because the reading's own message below already says which. */
function timelineView(humidityState, offset) {
  const { status, data, offsets } = humidityState;
  return {
    offset,
    status: status === "ready" ? "ready" : "none",
    offsets: status === "loading" ? null : offsets,
    timeMs: data?.timeMs ?? null,
    clamped: false,
  };
}

/**
 * Repaint the Humidity panel.
 * @param {{status: "idle"|"loading"|"ready"|"error", data: object|null,
 *   errorKind: string|null, offsets: number[]}} humidityState
 * @param {number} offset  the chosen forecast hour
 * @param {(offset: number) => void} [onSelectTime]
 */
export function renderHumidityUI(humidityState, offset = 0, onSelectTime) {
  const host = $("#mapWeatherControls");
  if (!host) return;

  if (!humidityState || humidityState.status === "idle") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  const focusedOffset = focusedTimelineOffset();
  host.hidden = false;
  host.innerHTML =
    timelineHtml(timelineView(humidityState, offset)) +
    (humidityState.status === "ready"
      ? readyHtml(humidityState.data)
      : statusHtml(humidityState.status, humidityState.errorKind));
  if (onSelectTime) bindTimeline(host, onSelectTime);
  restoreTimelineFocus(host, focusedOffset);
}
