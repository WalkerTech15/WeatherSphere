/* Unit conversion + formatting, reading the user's chosen units from state. */
import { state } from "./state.js";
import { t } from "./i18n.js";

export const toF = (c) => (c * 9) / 5 + 32;
export const toMph = (k) => k / 1.609;

export const convTemp = (c) => (state.unitTemp === "f" ? toF(c) : c);
export const fmtTemp = (c) => Math.round(convTemp(c));
export const tempUnit = () => (state.unitTemp === "f" ? "°F" : "°C");

export const convWind = (k) =>
  state.unitWind === "mph" ? toMph(k) : state.unitWind === "ms" ? k / 3.6 : k;
export const fmtWind = (k) => Math.round(convWind(k));
export const windUnit = () => ({ kmh: "km/h", mph: "mph", ms: "m/s" })[state.unitWind];

/* Distance (nearby places). No separate setting for it either — same
   metric/imperial signal as temperature and precipitation above. */
export const toMiles = (km) => km / 1.60934;
export const convDistance = (km) => (state.unitTemp === "f" ? toMiles(km) : km);
export const fmtDistance = (km) => {
  const value = convDistance(km);
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
};
export const distanceUnit = () => (state.unitTemp === "f" ? "mi" : "km");

/* Precipitation intensity has its own Settings control (state.unitPrecip) —
   unlike distance above, it no longer follows the temperature unit. mm/h and
   in/h are exactly the two units the MapTiler precipitation layer itself
   reports (PrecipitationPickAt.value / .valueImperial), so a legend built on
   them can never disagree with the map. */
export const toInPerHour = (mm) => mm / 25.4;
export const convPrecip = (mm) => (state.unitPrecip === "in" ? toInPerHour(mm) : mm);
export const precipUnit = () => (state.unitPrecip === "in" ? "in/h" : "mm/h");

/* Atmospheric pressure. 33.8639 is the NIST-standard hPa-per-inHg figure
   (1013.25 hPa, standard atmospheric pressure, is 29.92 inHg with this
   divisor — the commonly quoted reference value). inHg always prints two
   decimal places (it's a private, spec-style rounding: 29.9 vs 29.92 reads
   as a materially different reading in aviation/weather-station contexts,
   unlike hPa's whole-number convention). */
export const toInHg = (hpa) => hpa / 33.8639;
export const convPressure = (hpa) => (state.unitPressure === "inhg" ? toInHg(hpa) : hpa);
export const fmtPressure = (hpa) => {
  const value = convPressure(hpa);
  return state.unitPressure === "inhg" ? value.toFixed(2) : String(Math.round(value));
};
export const pressureUnit = () => (state.unitPressure === "inhg" ? "inHg" : "hPa");

/* Visibility — its own Settings control (state.unitVisibility), reusing
   toMiles() above rather than a second km→mi conversion. Same sub-10
   rounding as fmtDistance: a value under 10 (mi or km) keeps one decimal so
   fog/poor-visibility readings — the cases actually worth reading precisely
   — don't all collapse to the same whole number. */
export const convVisibility = (km) => (state.unitVisibility === "mi" ? toMiles(km) : km);
export const fmtVisibility = (km) => {
  const value = convVisibility(km);
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
};
export const visibilityUnit = () => (state.unitVisibility === "mi" ? "mi" : "km");

/* m/s is the MapTiler wind layer's own unit; convWind() speaks km/h. */
export const MS_TO_KMH = 3.6;

const COMPASS_KEYS = [
  "windDirN",
  "windDirNE",
  "windDirE",
  "windDirSE",
  "windDirS",
  "windDirSW",
  "windDirW",
  "windDirNW",
];
const COMPASS_ABBR = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/* Pure index/abbreviation lookup — no i18n dependency, easy to unit test. */
export function compassIndex(deg) {
  return Math.round((deg % 360) / 45) % 8;
}
export function compassAbbr(deg) {
  return COMPASS_ABBR[compassIndex(deg)];
}

export function compass(deg) {
  const i = compassIndex(deg);
  return { label: t(COMPASS_KEYS[i]), abbr: COMPASS_ABBR[i], deg };
}

export function uvLabel(uv) {
  if (uv < 3) return t("uvLow");
  if (uv < 6) return t("uvModerate");
  if (uv < 8) return t("uvHigh");
  if (uv < 11) return t("uvVeryHigh");
  return t("uvExtreme");
}
