/* How a selected place is presented on a map: how far to zoom for its kind,
   and the popup over its pin. Pure of map instances. */
import { state } from "../core/state.js";
import { esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit } from "../core/units.js";
import { flagsHtml, locRegion, locCountry, locName, locKindLabel } from "../core/location.js";

/* zoom per location type; huge countries get a wider view */
export function zoomFor(loc) {
  if (typeof loc._zoom === "number") return loc._zoom; /* MapTiler result: type-based */
  if (loc.kind === "country") return ["usa", "canada", "australia"].includes(loc.id) ? 4 : 5;
  if (loc.kind === "state" || loc.kind === "province" || loc.kind === "region") return 6;
  if (loc.kind === "village") return 13;
  if (loc.kind === "address" || loc.kind === "poi") return 16;
  return 11; // city / town
}

export function popupHtml(loc) {
  const line2 =
    loc.kind === "country"
      ? esc(locRegion(loc))
      : `${locKindLabel(loc)} · ${esc(locRegion(loc))}${locRegion(loc) ? ", " : ""}${esc(locCountry(loc))}`;
  const c = state.wx && state.wx.current;
  return `<div class="map-popup">
    <div class="mp-name">${flagsHtml(loc, "small")} <b>${esc(locName(loc))}</b></div>
    <div class="mp-sub">${line2}${loc.landmark ? ` · ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : ""}</div>
    ${
      c
        ? `<div class="mp-wx">${weatherIcon(wmo(c.code).icon, c.isDay)}
      <div><b>${fmtTemp(c.temp)}${tempUnit()}</b><span>${wxDesc(c.code, state.lang)}</span></div>
    </div>`
        : ""
    }
    <button class="mp-link" type="button">${t("viewWeather")} →</button>
  </div>`;
}
