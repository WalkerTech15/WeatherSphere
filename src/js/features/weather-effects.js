/* When a weather effect may exist — and, just as much, when it may not.
 *
 * Pure: no DOM, no app state, no timers. Everything here takes the weather
 * object the app already holds (services/weather-api.js) and answers a single
 * question per effect. Nothing is inferred from a neighbouring field, and a
 * missing field is never read as a value:
 *
 *   snow       the WMO code says snow AND the air is cold enough for it AND
 *              precipitation was actually measured. A snow code on a 9 °C
 *              day, or with no precipitation reading, is not shown.
 *   lightning  the WMO code says THUNDERSTORM. Rain, however heavy, and wind,
 *              however strong, never imply it.
 *   ocean      the location itself is classified as an ocean or sea. This is
 *              a property of the place, not of the weather, so an inland city
 *              or region can never qualify.
 *
 * Demo (offline fallback) weather is invented by construction, so it can never
 * switch a condition-driven effect on. The ocean effect claims nothing about
 * the weather, so it is independent of it.
 *
 * The decisions carry a machine-readable `reason` so a test — or a curious
 * developer — can see WHY an effect is off, not just that it is. */
import { THUNDERSTORM_CODES } from "./advisories.js";
import { isMarineKind } from "../services/photo-relevance.js";

/* WMO snow family: slight/moderate/heavy snowfall, snow grains, snow showers. */
export const SNOW_CODES = [71, 73, 75, 77, 85, 86];
/* Above this near-surface temperature a "snow" reading contradicts itself
   (it is sleet or rain), so nothing falls on screen. */
export const SNOW_MAX_TEMP_C = 2;

/* How hard it is snowing, from the code's own wording — never from a guess. */
const SNOW_INTENSITY = { 71: 1, 77: 1, 85: 1, 73: 2, 75: 3, 86: 3 };

/* Hero particle budget. A phone gets fewer: the effect is atmosphere, and
   must never be what makes a weather page heavy. Measured cost grows roughly
   linearly with the number of flakes (about 25 ms of main-thread style work per
   flake per 5 s on a 4x-throttled Pixel 5 profile), so the ceiling is kept low:
   this is a dusting, not a blizzard. */
export const FLAKE_BUDGET = { desktop: 28, constrained: 10 };
const INTENSITY_SHARE = { 1: 0.45, 2: 0.75, 3: 1 };

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const off = (reason) => ({ active: false, reason });

/**
 * @param {object} current  wx.current
 * @returns {{active:boolean, reason:string, intensity?:1|2|3}}
 */
export function snowEffect(current) {
  if (!current || typeof current !== "object") return off("no-weather");
  const code = finite(current.code);
  if (code === null) return off("no-condition");
  if (!SNOW_CODES.includes(code)) return off("not-snow");

  const temp = finite(current.temp);
  if (temp === null) return off("no-temperature");
  if (temp > SNOW_MAX_TEMP_C) return off("too-warm");

  /* precipitation was measured, and something actually fell */
  const precip = finite(current.precip);
  const snowfall = finite(current.snowfall);
  if (precip === null && snowfall === null) return off("no-precipitation-data");
  if (Math.max(precip ?? 0, snowfall ?? 0) <= 0) return off("no-precipitation");

  return { active: true, reason: "snow", intensity: SNOW_INTENSITY[code] ?? 2 };
}

/**
 * @param {object} current  wx.current
 */
export function lightningEffect(current) {
  if (!current || typeof current !== "object") return off("no-weather");
  const code = finite(current.code);
  if (code === null) return off("no-condition");
  if (!THUNDERSTORM_CODES.includes(code)) return off("not-thunderstorm");
  return { active: true, reason: "thunderstorm" };
}

/* Wave motion follows the measured wind when there is one; without a reading
   the sea is drawn at its calmest rather than guessed rougher. */
export function waveIntensity(windKmh) {
  const wind = finite(windKmh);
  if (wind === null) return 1;
  if (wind >= 35) return 3;
  if (wind >= 15) return 2;
  return 1;
}

/**
 * @param {object} loc      the selected location
 * @param {object} [current] wx.current, only to scale the wave motion
 */
export function oceanEffect(loc, current) {
  if (!loc || typeof loc !== "object") return off("no-location");
  if (!isMarineKind(loc.kind)) return off("not-marine");
  return { active: true, reason: "marine", intensity: waveIntensity(current?.windSpeed) };
}

/**
 * Every hero effect at once.
 *
 * @param {{loc:object, wx:object, isDemo?:boolean}} input
 */
export function heroEffects({ loc, wx, isDemo = false } = {}) {
  const current = wx?.current;
  const ocean = oceanEffect(loc, isDemo ? null : current);
  if (isDemo) {
    return {
      snow: off("demo-data"),
      lightning: off("demo-data"),
      ocean,
      any: ocean.active,
    };
  }
  const snow = snowEffect(current);
  const lightning = lightningEffect(current);
  return { snow, lightning, ocean, any: snow.active || lightning.active || ocean.active };
}

/* How many snowflakes to draw. */
export function flakeCount(intensity, { constrained = false } = {}) {
  const budget = constrained ? FLAKE_BUDGET.constrained : FLAKE_BUDGET.desktop;
  return Math.max(4, Math.round(budget * (INTENSITY_SHARE[intensity] ?? INTENSITY_SHARE[2])));
}

/**
 * How an effect that IS eligible is drawn.
 *   animated  it moves
 *   static    same picture, no movement (switched off, reduced motion, or the
 *             browser cannot animate) — an honest still of a real condition
 *
 * @param {{allowed:boolean, supported?:boolean}} input
 */
export function motionMode({ allowed, supported = true } = {}) {
  return allowed && supported ? "animated" : "static";
}
