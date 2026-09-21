/* Motion preferences, in one place.
 *
 * Every weather animation asks the same question — "may I move?" — and the
 * answer has two parts that must never be confused: what the visitor chose in
 * Settings, and what their device says. The device wins. A visitor who has
 * asked their operating system to reduce motion gets none of these effects
 * whatever the Settings switch reads, and no setting can override that.
 *
 * Guarded so it can be imported (and unit-tested) where there is no window. */

const QUERY = "(prefers-reduced-motion: reduce)";

function query() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY)
      : null;
  } catch {
    return null;
  }
}

export function prefersReducedMotion() {
  return Boolean(query()?.matches);
}

/* Motion is allowed only when the visitor has not switched it off AND the
   device has not asked for less of it. */
export function animationsAllowed(enabled) {
  return Boolean(enabled) && !prefersReducedMotion();
}

/* Calls `handler` when the device preference flips at runtime (a visitor can
   change it while the page is open). Returns the unsubscribe function. */
export function watchReducedMotion(handler) {
  const mq = query();
  if (!mq) return () => {};
  const listener = () => handler(mq.matches);
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }
  /* very old Safari */
  mq.addListener?.(listener);
  return () => mq.removeListener?.(listener);
}

export function isPageHidden() {
  return typeof document !== "undefined" && document.hidden === true;
}

/* A phone-sized or touch-first device gets the smaller particle budget. */
export function isConstrainedDevice() {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return (
      window.matchMedia("(max-width: 820px)").matches ||
      window.matchMedia("(pointer: coarse)").matches
    );
  } catch {
    return false;
  }
}
