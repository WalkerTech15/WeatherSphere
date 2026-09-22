/* European Air Quality Index category, shared by every place that shows an
 * AQI number — the forecast page's "day details" card and the map's Air
 * Quality layer (features/map.js + ui/render-map-airquality.js). One
 * classification lives here so the two can never disagree about what
 * counts as "Good" or "Poor" for the same value. Thresholds match the
 * bands Open-Meteo's own European AQI documentation describes as
 * Good/Fair/Moderate/Poor/Very poor, collapsed to the three severity
 * colours (`is-good`/`is-warn`/`is-bad`) this app already uses elsewhere. */
import { t } from "../core/i18n.js";

export function classifyAqi(aqi) {
  if (aqi == null || !Number.isFinite(aqi)) return { label: "—", cls: "" };
  if (aqi <= 50) return { label: t("aqGood"), cls: "is-good" };
  if (aqi <= 75) return { label: t("aqModerate"), cls: "is-warn" };
  if (aqi <= 100) return { label: t("aqPoor"), cls: "is-bad" };
  return { label: t("aqVeryPoor"), cls: "is-bad" };
}
