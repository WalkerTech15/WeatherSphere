/* Side-by-side comparison table, rendered into the Favorites view.
 *
 * Two halves on purpose:
 *   - formatComparisonCell / buildComparisonRows are PURE, so every unit
 *     conversion and every "no data" case is unit-testable without a DOM.
 *   - renderComparison does the markup and the event wiring.
 *
 * Accessibility: this is a real <table> with a <caption>, row headers
 * (scope="row") for the metric names and column headers (scope="col") for
 * the places, so a screen reader announces "Humidity, Paris, 55%" rather
 * than reading a grid of loose numbers. The picker is a group of real
 * toggle buttons with aria-pressed, and each column carries its own remove
 * button — reachable by keyboard in DOM order, no roving tabindex needed. */
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtTemp, tempUnit, fmtWind, windUnit, uvLabel } from "../core/units.js";
import { locName, locAccessibleName, locCountryFlagHtml, localTimeStr } from "../core/location.js";
import {
  COMPARISON_METRICS,
  comparableLocations,
  comparisonLocations,
  comparisonWx,
  comparisonStatus,
  comparisonAqiFailed,
  comparisonMatches,
  isCompared,
  toggleComparison,
  removeFromComparison,
  clearComparison,
  comparisonFull,
  loadComparisonWeather,
} from "../features/comparison.js";
import { showToast } from "./notifications.js";
import { providerById } from "../data/attributions.js";

const DASH = "—";
/* A column whose weather is on its way. A dash says "this place has no value";
   this says "not yet". */
const LOADING = "…";

/* One metric of one place, already formatted for display in the visitor's
   chosen units. Returns the em dash for anything missing, so a partial
   response (air quality is a separate service and may fail alone) degrades
   per cell rather than blanking the column. */
export function formatComparisonCell(metric, entry) {
  if (!entry) return DASH;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (metric) {
    case "temperature": {
      const v = num(entry.temp);
      return v === null ? DASH : `${fmtTemp(v)}${tempUnit()}`;
    }
    case "feelsLike": {
      const v = num(entry.feelsLike);
      return v === null ? DASH : `${fmtTemp(v)}${tempUnit()}`;
    }
    case "humidity": {
      const v = num(entry.humidity);
      return v === null ? DASH : `${Math.round(v)}%`;
    }
    case "wind": {
      const v = num(entry.wind);
      return v === null ? DASH : `${fmtWind(v)} ${windUnit()}`;
    }
    case "precipitation": {
      const v = num(entry.precipitation);
      return v === null ? DASH : `${Math.round(v)}%`;
    }
    case "uv": {
      const v = num(entry.uv);
      return v === null ? DASH : `${Math.round(v)} · ${uvLabel(v)}`;
    }
    case "airQuality": {
      const v = num(entry.aqi);
      return v === null ? DASH : String(Math.round(v));
    }
    case "localTime":
      return localTimeStr(entry.timezone) || DASH;
    default:
      return DASH;
  }
}

const hasValue = (entry) =>
  ["temp", "feelsLike", "humidity", "wind", "precipitation", "uv", "aqi"].some(
    (key) => typeof entry?.[key] === "number" && Number.isFinite(entry[key]),
  );

/**
 * Where the table stands, and each column with it — so a dash is only ever
 * printed for a place that has no value, never for weather still loading or a
 * request that failed.
 *
 * Column: "ready" (it has values), "loading" (its weather is on its way) or
 * "unavailable" (the request failed, or the provider had nothing for it).
 * State: "loading" while any column waits; "error" when no column has values;
 * "partial" when some do not; otherwise "ready".
 *
 * `current` says whether the weather held is of exactly these places, so a
 * column added a moment ago reads as loading even before its request starts.
 */
export function comparisonView(locs, wx = {}, options = {}) {
  const { status = "ready", current = true, aqiFailed = false } = options;
  const waiting = status === "loading" || status === "idle" || (status === "ready" && !current);
  const columns = {};
  for (const loc of locs) {
    const entry = wx[loc.id];
    if (status === "error") columns[loc.id] = "unavailable";
    else if (entry) columns[loc.id] = hasValue(entry) ? "ready" : "unavailable";
    else columns[loc.id] = waiting ? "loading" : "unavailable";
  }
  const kinds = Object.values(columns);
  let state = "ready";
  if (kinds.includes("loading")) state = "loading";
  else if (kinds.every((kind) => kind === "unavailable")) state = "error";
  else if (kinds.includes("unavailable")) state = "partial";
  return {
    state,
    columns,
    unavailable: locs.filter((loc) => columns[loc.id] === "unavailable"),
    aqiFailed: Boolean(aqiFailed) && (state === "ready" || state === "partial"),
  };
}

/* The whole table as data: one row per metric, one cell per selected place.
   `wx` is passed in rather than read from the module so tests can supply a
   fixture. `columns` (from comparisonView) marks the places still loading. */
export function buildComparisonRows(locs, wx = {}, columns = {}) {
  return COMPARISON_METRICS.map((metric) => ({
    metric,
    label: t(metric === "uv" ? "uvIndex" : metric),
    cells: locs.map((loc) =>
      columns[loc.id] === "loading" ? LOADING : formatComparisonCell(metric, wx[loc.id]),
    ),
  }));
}

/* Where the numbers in the table come from, right under them. Open-Meteo
   supplies both the weather and the air quality (see features/comparison.js). */
function sourceNoteHtml() {
  const provider = providerById("open-meteo");
  const link = `<a href="${esc(provider.url)}" target="_blank" rel="noopener">${esc(provider.name)}</a>`;
  return `<p class="compare-source">${t("compareSource").replace("{provider}", link)}</p>`;
}

function retryHtml() {
  return `<button type="button" class="compare-clear compare-retry" data-compare-retry>${esc(t("compareRetry"))}</button>`;
}

/* One sentence saying what the dashes and ellipses in the table mean, when
   they mean anything. */
function statusHtml(view) {
  let text = "";
  let retry = false;
  if (view.state === "loading") text = t("compareLoading");
  else if (view.state === "error") {
    text = t("compareUnavailable");
    retry = true;
  } else if (view.state === "partial") {
    const names = view.unavailable.map((loc) => locName(loc)).join(", ");
    text = t("comparePlaceUnavailable").replace("{names}", names);
    retry = true;
  } else if (view.aqiFailed) {
    text = t("compareAqiUnavailable");
    retry = true;
  }
  if (!text) return "";
  return `<p class="compare-empty compare-status" role="status" data-state="${view.state}">${esc(text)} ${retry ? retryHtml() : ""}</p>`;
}

function pickerHtml() {
  const options = comparableLocations();
  if (!options.length) {
    return `<p class="compare-empty">${esc(t("compareNoPlaces"))}</p>`;
  }
  return `<div class="compare-picker" role="group" aria-label="${esc(t("comparePick"))}">
      ${options
        .map((loc) => {
          const on = isCompared(loc);
          /* Disabled only when the cap is reached AND this one is not
             already selected — a selected chip must always stay clickable
             so the visitor can free a slot. */
          const disabled = !on && comparisonFull();
          const label = (on ? t("compareRemove") : t("compareAdd")).replace(
            "{name}",
            locAccessibleName(loc),
          );
          return `<button type="button" class="compare-chip" data-compare-id="${esc(loc.id)}"
              aria-pressed="${on}" ${disabled ? "disabled" : ""} aria-label="${esc(label)}">
              ${locCountryFlagHtml(loc)}<span>${esc(locName(loc))}</span>
            </button>`;
        })
        .join("")}
    </div>`;
}

function tableHtml(locs, view) {
  const rows = buildComparisonRows(locs, comparisonWx, view.columns);
  return `${statusHtml(view)}<div class="table-scroll">
      <table class="compare-table" aria-busy="${view.state === "loading"}">
        <caption class="sr-only">${esc(t("compareTitle"))}</caption>
        <thead>
          <tr>
            <th scope="col">${esc(t("compareMetric"))}</th>
            ${locs
              .map(
                (loc) => `<th scope="col">
                  <span class="compare-col">
                    <span class="compare-col-name">${locCountryFlagHtml(loc)}${esc(locName(loc))}</span>
                    <button type="button" class="compare-remove" data-compare-remove="${esc(loc.id)}"
                      aria-label="${esc(t("compareRemove").replace("{name}", locAccessibleName(loc)))}">
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                </th>`,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <th scope="row">${esc(row.label)}</th>
                ${row.cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>${sourceNoteHtml()}`;
}

/* Which control inside the block currently has focus, as a selector that
   will still match after the block is rebuilt.

   Toggling a chip replaces the whole block's markup, which destroys the
   very button the visitor just activated — a mouse user never notices, but
   a keyboard user is dropped back to <body> and loses their place. The
   selector is rebuilt from the control's own data attribute rather than
   held as a node reference, precisely because the node does not survive. */
function focusedControlSelector(host) {
  const active = document.activeElement;
  if (!active || !host.contains(active)) return "";
  if (active.dataset.compareId)
    return `[data-compare-id="${CSS.escape(active.dataset.compareId)}"]`;
  if (active.dataset.compareRemove) {
    return `[data-compare-remove="${CSS.escape(active.dataset.compareRemove)}"]`;
  }
  if (active.id === "compareClearBtn") return "#compareClearBtn";
  if ("compareRetry" in active.dataset) return "[data-compare-retry]";
  return "";
}

/* Puts focus back on the equivalent control after a rebuild. Falls back to
   the picker's first chip when the exact control is gone (the visitor
   removed the column they were standing on), so focus never lands on
   <body>. */
function restoreFocus(host, selector) {
  if (!selector) return;
  const target = $(selector, host) || $(".compare-chip", host);
  target?.focus();
}

/* Set when the visitor presses "Try again": the button is gone while the table
   loads, so focus is handed back to it if the failure stands — otherwise a
   keyboard user would be dropped on the first chip. */
let retryHadFocus = false;

export function renderComparison() {
  const host = $("#compareBlock");
  if (!host) return;
  const locs = comparisonLocations();
  const view = comparisonView(locs, comparisonWx, {
    status: comparisonStatus,
    current: comparisonMatches(locs),
    aqiFailed: comparisonAqiFailed,
  });
  const previouslyFocused = focusedControlSelector(host);

  host.innerHTML = `
    <div class="block-head compare-head">
      <div>
        <h2 class="section-title sm" id="compareTitle">${esc(t("compareTitle"))}</h2>
        <p class="section-sub">${esc(t("compareSub"))}</p>
      </div>
      ${
        locs.length
          ? `<button type="button" class="compare-clear" id="compareClearBtn">${esc(t("compareClear"))}</button>`
          : ""
      }
    </div>
    <div class="card compare-card">
      ${pickerHtml()}
      ${
        locs.length >= 2
          ? tableHtml(locs, view)
          : comparableLocations().length
            ? `<p class="compare-empty">${esc(t("compareEmpty"))}</p>`
            : ""
      }
    </div>`;

  $$("[data-compare-id]", host).forEach((btn) =>
    btn.addEventListener("click", () => {
      const loc = comparableLocations().find((l) => l.id === btn.dataset.compareId);
      if (!loc) return;
      const result = toggleComparison(loc);
      /* Silently doing nothing at the cap would read as a broken button */
      if (result === "full") return showToast(t("compareFull"));
      refreshComparison();
    }),
  );
  $$("[data-compare-remove]", host).forEach((btn) =>
    btn.addEventListener("click", () => {
      removeFromComparison(btn.dataset.compareRemove);
      refreshComparison();
    }),
  );
  $("[data-compare-retry]", host)?.addEventListener("click", () => {
    retryHadFocus = true;
    refreshComparison();
  });
  $("#compareClearBtn")?.addEventListener("click", () => {
    clearComparison();
    refreshComparison();
  });

  restoreFocus(host, previouslyFocused);
  if (retryHadFocus) {
    const retry = $("[data-compare-retry]", host);
    if (retry) retry.focus();
    if (retry || view.state !== "loading") retryHadFocus = false;
  }
}

/* Start the fetch, paint, then paint again when it lands — so a click feels
   immediate (the column appears at once, marked as loading) and fills in when
   the batched request arrives. The fetch starts FIRST so the first paint
   already knows it is loading (a retry would otherwise repaint the old
   failure for a moment). loadComparisonWeather is latest-only, so a rapid
   sequence of picks can only ever paint the last one. */
export function refreshComparison() {
  const pending = comparisonLocations().length >= 2 ? loadComparisonWeather(true) : null;
  renderComparison();
  pending?.then(() => renderComparison());
}

/* Called when the view opens: same flow, but honouring the freshness
   window rather than forcing a refetch. */
export function loadComparison() {
  const pending = comparisonLocations().length >= 2 ? loadComparisonWeather() : null;
  renderComparison();
  pending?.then(() => renderComparison());
}
