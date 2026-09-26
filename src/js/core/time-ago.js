/* "How long ago" for a stored timestamp — the one place that decides whether a
 * timestamp is fit to show.
 *
 * A timestamp that was never set is 0, and "now minus 0" is about 29.8 million
 * minutes: the Favorites page once printed exactly that. So nothing is ever
 * formatted until it has been checked, and anything that fails the check —
 * missing, zero, negative, not a number, before the year 2000, in the future
 * (beyond a minute of clock skew) or older than a week — is reported as "not
 * updated" instead of as a number. Pure apart from the translation lookup;
 * `now` is a parameter so every case is testable. */
import { t } from "./i18n.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Earlier than any real reading: rules out 0, 1, and seconds-not-milliseconds. */
export const EARLIEST_VALID_MS = Date.UTC(2000, 0, 1);
/* A device clock a little ahead of the server's is normal; more is not. */
export const FUTURE_TOLERANCE_MS = MINUTE;
/* Weather older than this is not "updated N days ago", it is not current. */
export const MAX_AGE_MS = 7 * DAY;

/**
 * Whole minutes since `at`, or null when `at` cannot be trusted.
 * @param {unknown} at epoch milliseconds (a Date is accepted too)
 * @param {number} [now]
 */
export function ageMinutes(at, now = Date.now()) {
  const ms = at instanceof Date ? at.getTime() : at;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < EARLIEST_VALID_MS) return null;
  const age = now - ms;
  if (age < -FUTURE_TOLERANCE_MS || age > MAX_AGE_MS) return null;
  return Math.round(Math.max(0, age) / MINUTE);
}

/**
 * "just now", "12 min ago", "3 h ago", "2 d ago" — or null when the
 * timestamp is not fit to show.
 */
export function formatAgo(at, now = Date.now()) {
  const mins = ageMinutes(at, now);
  if (mins === null) return null;
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("agoMin").replace("{m}", mins);
  if (mins < 60 * 24) return t("agoHour").replace("{h}", Math.floor(mins / 60));
  return t("agoDay").replace("{d}", Math.floor(mins / (60 * 24)));
}

/** The relative time on its own, or the translated "not updated". */
export function agoOrNotUpdated(at, now = Date.now()) {
  return formatAgo(at, now) ?? t("notUpdated");
}

/** A full phrase: "Updated 12 min ago", or the translated "not updated". */
export function updatedPhrase(at, now = Date.now()) {
  const ago = formatAgo(at, now);
  return ago === null ? t("notUpdated") : `${t("updated")} ${ago}`;
}
