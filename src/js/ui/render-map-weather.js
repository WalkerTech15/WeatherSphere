/* The overlay controls that sit beside the map: the forecast-time selector
   (Now / +3 h / +6 h / +12 h / +24 h) and the legend for the active weather
   layer.
 *
 * Both live in #mapWeatherControls, a sibling of #worldMap inside the map
 * card — never inside the map container. That placement is deliberate: a
 * click on a legend or a time button is then structurally incapable of
 * reaching MapLibre's canvas listeners, so it can never be mistaken for a
 * "select this coordinate" map click.
 *
 * Satellite is the plain basemap and carries no weather data, so it gets no
 * legend and no timeline at all — the whole block is emptied and hidden.
 * Air Quality and Humidity are likewise excluded here: neither has a
 * colour ramp or a forecast-time concept (both are point readings for the
 * selected place, not a map layer), so each gets its own renderer —
 * ui/render-map-airquality.js and ui/render-map-humidity.js, called
 * separately by features/map.js and sharing this same host. Humidity does
 * read a forecast hour (from the place's own hourly forecast), so its panel
 * reuses this file's timeline (timelineHtml / bindTimeline below) rather than
 * drawing a second one. */
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtDateTime } from "../core/datetime.js";
import { TIME_OFFSETS } from "../features/map-timeline.js";
import { legendModel, normalizeRampStops, hasLegend } from "../features/map-legend.js";

/* One entry per layer in LEGEND_LAYERS (features/map-legend.js) — a layer
   without one would be titled by t(undefined), i.e. the word "undefined". */
export const LEGEND_TITLE_KEYS = {
  temperature: "temperature",
  rain: "precipitation",
  wind: "windSpeed",
  pressure: "pressure",
};

const OFFSET_LABEL_KEYS = {
  0: "mapTimeNow",
  3: "mapTimePlus3",
  6: "mapTimePlus6",
  12: "mapTimePlus12",
  24: "mapTimePlus24",
};

/* What the timeline needs to draw itself — a ramp layer's overlay (below) or
   the Humidity panel's own reading hand over the same shape:
     offset   the chosen hour
     status   loading | ready | error | unavailable | none  ("none" draws
              no status line: the caller shows its own message)
     offsets  the hours the data can answer, or null while not yet known
     timeMs   the moment shown, and clamped whether it is the nearest one */
export function rampTimelineView(overlay) {
  return {
    offset: overlay.offset,
    status: overlay.status,
    offsets: overlay.status === "ready" ? overlay.offsets : null,
    timeMs: overlay.timeMs,
    clamped: overlay.clamped,
  };
}

function timeStatusText(view) {
  if (view.status === "none") return "";
  if (view.status === "loading") return t("mapTimeLoading");
  if (view.status === "error") return t("mapTimeError");
  if (view.status === "unavailable") return t("mapTimeUnavailable");
  if (!view.timeMs) return t("mapTimeUnavailable");
  const shown = t("mapTimeShowing").replace("{time}", fmtDateTime(view.timeMs));
  return view.clamped ? `${shown} — ${t("mapTimeClamped")}` : shown;
}

export function timelineHtml(view) {
  const buttons = TIME_OFFSETS.map((offset) => {
    const active = view.offset === offset;
    /* an offset the data cannot reach is disabled rather than silently
       showing the same picture as its neighbour — but the chosen one never
       is, so keyboard focus is never stranded on a disabled control */
    const reachable = active || !view.offsets || view.offsets.includes(offset);
    return `<button class="map-time" type="button" role="radio"
        data-map-time="${offset}"
        aria-checked="${active}"
        tabindex="${active ? 0 : -1}"
        ${reachable ? "" : "disabled"}>${esc(t(OFFSET_LABEL_KEYS[offset]))}</button>`;
  }).join("");

  return `
    <div class="map-time-row" role="radiogroup" aria-label="${esc(t("mapTimeline"))}">
      ${buttons}
    </div>
    ${statusHtml(view)}`;
}

function statusHtml(view) {
  const text = timeStatusText(view);
  if (!text) return "";
  return `<p class="map-time-status" ${view.status === "loading" ? 'data-loading="1"' : ""}>${esc(
    text,
  )}</p>`;
}

/* The legend view-model, or null when there is nothing to draw one from
   (satellite, a layer still loading, or a ramp the provider did not supply).
   Built once per render and shared by the markup and the painting pass. */
function legendFor(overlay) {
  if (!hasLegend(overlay.type) || overlay.status !== "ready") return null;
  return legendModel(overlay.type, normalizeRampStops(overlay.colorRamp));
}

function legendHtml(overlay, legend) {
  if (!hasLegend(overlay.type) || overlay.status !== "ready") return "";
  if (!legend) {
    return `<p class="map-legend-empty">${esc(t("mapLegendUnavailable"))}</p>`;
  }

  const title = `${t(LEGEND_TITLE_KEYS[overlay.type])} (${legend.unit})`;
  const scale = t("mapLegendScale")
    .replace("{min}", legend.minLabel)
    .replace("{max}", legend.maxLabel)
    .replace("{unit}", legend.unit);
  const ticks = legend.ticks
    .map((tick) => `<li data-pct="${tick.pct}"><span>${esc(tick.label)}</span></li>`)
    .join("");

  return `
    <figure class="map-legend" data-legend="${esc(overlay.type)}">
      <figcaption class="map-legend-title">${esc(title)}</figcaption>
      <div class="map-legend-bar" role="img" aria-label="${esc(scale)}"></div>
      <ol class="map-legend-ticks">${ticks}</ol>
    </figure>`;
}

/* The optional "Animate" toggle: the rain forecast playing through, or the
   wind particles moving. Offered only while the overlay is ready AND the
   animation controller says there is real data to animate and motion is
   allowed — otherwise nothing is drawn, not a disabled button. It is a toggle,
   so it carries aria-pressed and one constant name. */
function animationHtml(overlay) {
  const anim = overlay.animation;
  if (!anim?.available || overlay.status !== "ready") return "";
  const label = anim.kind === "rain" ? t("mapAnimateRain") : t("mapAnimateWind");
  const icon = anim.playing
    ? '<path d="M8 5v14M16 5v14"/>' /* pause: what pressing it will do */
    : '<path d="m7 4 13 8-13 8z"/>';
  return `<div class="map-anim-row">
      <button class="map-time map-anim" type="button" data-map-anim="${esc(anim.kind)}"
        aria-pressed="${anim.playing ? "true" : "false"}" aria-label="${esc(label)}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor"
          stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${icon}</svg>
        ${esc(t("mapAnimate"))}
      </button>
    </div>`;
}

/* While rain plays the forecast time moves several times a second. Only the
   status line changes, so the buttons — and keyboard focus on them — are left
   alone rather than rebuilt every tick. */
export function updateTimeStatus(overlay) {
  const status = $("#mapWeatherControls .map-time-status");
  if (status && overlay) status.textContent = timeStatusText(rampTimelineView(overlay));
}

/* The gradient and tick offsets are numeric values derived from the layer's
   own color ramp; they are applied as element styles rather than interpolated
   into the markup so no provider-supplied value ever reaches an HTML string. */
function paintLegend(host, legend) {
  const bar = $(".map-legend-bar", host);
  if (!bar || !legend) return;
  bar.style.backgroundImage = legend.gradient;
  $$(".map-legend-ticks li", host).forEach((item) => {
    const pct = Number(item.dataset.pct);
    if (Number.isFinite(pct)) item.style.left = `${pct}%`;
  });
}

/* Roving-tabindex arrow navigation, the same pattern the theme menu uses:
   one tab stop for the group, arrows move between the options and select. */
export function bindTimeline(host, onSelectTime) {
  const buttons = $$(".map-time:not(.map-anim)", host);
  buttons.forEach((button) => {
    button.addEventListener("click", () => onSelectTime(Number(button.dataset.mapTime)));
  });
  const row = $(".map-time-row", host);
  row?.addEventListener("keydown", (event) => {
    const usable = buttons.filter((button) => !button.disabled);
    if (!usable.length) return;
    const index = usable.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % usable.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + usable.length) % usable.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = usable.length - 1;
    if (next === null) return;
    event.preventDefault();
    usable[next].focus();
    onSelectTime(Number(usable[next].dataset.mapTime));
  });
}

/* Re-rendering replaces the buttons, so a caller remembers which hour held
   keyboard focus before, and puts it back on the equivalent control after. */
export function focusedTimelineOffset() {
  return document.activeElement?.closest?.(".map-time:not(.map-anim)")?.dataset.mapTime;
}

/* Put focus back, and make sure the chosen hour is on screen. The row is
   rebuilt on every change — which resets its scroll — and on a narrow phone it
   scrolls sideways, so the hour just chosen (by click, arrow key or a shared
   link) could otherwise sit past the edge. Only the row is scrolled, never
   the page. */
export function restoreTimelineFocus(host, offset) {
  if (offset !== undefined) $(`.map-time[data-map-time="${offset}"]`, host)?.focus();
  const row = $(".map-time-row", host);
  const chosen = $('.map-time[aria-checked="true"]', row || host);
  if (row && chosen) revealInRow(row, chosen);
}

function revealInRow(row, button) {
  /* keep the row's own padding as a margin, so the button never touches its edge */
  const edge = parseFloat(getComputedStyle(row).paddingLeft) || 0;
  const left = button.offsetLeft - edge;
  const right = button.offsetLeft + button.offsetWidth + edge;
  if (left < row.scrollLeft) row.scrollLeft = left;
  else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
}

/**
 * Repaint the overlay controls.
 * @param {object} overlay  the map's overlay description (type, status,
 *                          offset, colorRamp, timeMs, clamped, offsets)
 * @param {object} handlers { onSelectTime }
 */
export function renderWeatherOverlayUI(overlay, { onSelectTime, onToggleAnimation } = {}) {
  const host = $("#mapWeatherControls");
  if (!host) return;

  if (
    !overlay ||
    overlay.type === "satellite" ||
    overlay.type === "airQuality" ||
    overlay.type === "humidity" ||
    overlay.type === "alerts"
  ) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  /* re-rendering replaces the buttons, so remember whether focus was inside
     the group and put it back on the equivalent control afterwards */
  const focusedOffset = focusedTimelineOffset();
  const focusedAnim = Boolean(document.activeElement?.closest?.(".map-anim"));

  const legend = legendFor(overlay);
  host.hidden = false;
  host.innerHTML = `${animationHtml(overlay)}${timelineHtml(rampTimelineView(overlay))}${legendHtml(overlay, legend)}`;
  paintLegend(host, legend);
  if (onSelectTime) bindTimeline(host, onSelectTime);
  $(".map-anim", host)?.addEventListener("click", () => onToggleAnimation?.());
  if (focusedAnim) $(".map-anim", host)?.focus();
  restoreTimelineFocus(host, focusedOffset);
}
