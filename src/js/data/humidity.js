/* Relative-humidity comfort category, shared by every place that shows a
 * humidity reading — the home/forecast metric card (ui/render-home.js) and
 * the map's Humidity layer (features/map.js + ui/render-map-humidity.js).
 * One classification lives here so the two can never disagree about what
 * counts as "Humid" or "Dry" for the same value. Thresholds match the ones
 * the metric card already used before this module existed. */
import { t } from "../core/i18n.js";

export function classifyHumidity(value) {
  if (value == null || !Number.isFinite(value)) return { label: "—", cls: "" };
  if (value > 70) return { label: t("humid"), cls: "is-warn" };
  if (value < 35) return { label: t("dry"), cls: "is-warn" };
  return { label: t("comfortable"), cls: "is-good" };
}
