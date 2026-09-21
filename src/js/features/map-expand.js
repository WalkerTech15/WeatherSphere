/* Expanded map mode.
 *
 * One boolean, mirrored onto <body> as a class. Everything visual is CSS
 * (see the "Expanded map mode" section of styles/views/map.css): the map card
 * becomes a fixed layer covering the whole viewport, the sidebar steps out,
 * and the top navigation shrinks into a compact floating bar over the map.
 * It is still a layout mode, not the Fullscreen API: browser chrome is never
 * touched, the URL never changes, and the same header elements stay in the
 * DOM, so search, theme and language keep working without a second copy.
 *
 * Nothing here knows how to draw a map. The map's camera, layer, selection
 * and detail panel all live in features/map.js and survive a mode change
 * untouched; the only thing this module has to tell the map is "your
 * container changed size, re-measure" — MapLibre cannot detect that itself.
 */
import { $ } from "../core/dom.js";
import { on } from "../core/app-bus.js";
import { resizeMaps } from "./map.js";

export const EXPANDED_CLASS = "map-expanded";

let expanded = false;
/* Where the page was scrolled when the mode was entered. Hiding the heading,
   the recents cards and the footer shortens the document, so the browser
   clamps the scroll position — without this, leaving the mode would drop
   the visitor back at the top of the page instead of where they were. */
let savedScrollY = 0;

export function isMapExpanded() {
  return expanded;
}

/* Both controls describe the same state, so they are updated together rather
   than each toggle site remembering to touch both. The pair exists because
   expanded mode hides the block-head the chip lives in — see index.html. */
function syncControls() {
  $("#mapExpandBtn")?.setAttribute("aria-pressed", String(expanded));
  const exit = $("#mapExitExpandBtn");
  if (exit) {
    exit.hidden = !expanded;
    exit.setAttribute("aria-pressed", String(expanded));
  }
}

/* `force` lets the caller assert a state instead of flipping ("leaving the
   map view exits expanded mode" must not accidentally enter it). */
export function setMapExpanded(next, { focus = false, restoreScroll = true } = {}) {
  const target = Boolean(next);
  if (target === expanded) return false;
  if (target) savedScrollY = window.scrollY;
  expanded = target;
  document.body.classList.toggle(EXPANDED_CLASS, expanded);
  syncControls();
  /* The container's box changes in the same frame the class lands, but
     MapLibre only re-reads it when asked. Deferred one frame so the new
     layout has actually been computed before it measures — resizing against
     the pre-toggle box leaves the canvas the old size until the next
     unrelated resize. */
  requestAnimationFrame(() => {
    resizeMaps();
    /* Removing overflow:hidden can make the browser clamp the scroll
       position before the new layout is ready. Restore it after that frame,
       using the numeric overload so smooth-scroll CSS cannot interfere. */
    if (!expanded && restoreScroll) window.scrollTo(0, savedScrollY);
  });

  /* Focus has to follow the control that just disappeared, or it falls to
     <body> and a keyboard user loses their place. Only on a real activation —
     a programmatic exit (navigating away) must not steal focus from wherever
     the user actually went. */
  if (focus) {
    const successor = expanded ? $("#mapExitExpandBtn") : $("#mapExpandBtn");
    /* Moving focus must not scroll the restored normal page back to the
       control; scroll restoration is handled independently above. */
    successor?.focus({ preventScroll: true });
  }
  return true;
}

export function toggleMapExpanded() {
  return setMapExpanded(!expanded, { focus: true });
}

/* Escape, and any other "get me out of here" path. Returns whether it did
   anything, so a caller can tell if it consumed the key. */
export function exitMapExpanded({ focus = false, restoreScroll = true } = {}) {
  return setMapExpanded(false, { focus, restoreScroll });
}

export function bindMapExpand() {
  $("#mapExpandBtn")?.addEventListener("click", () => toggleMapExpanded());
  $("#mapExitExpandBtn")?.addEventListener("click", () => toggleMapExpanded());

  /* Subscribed on the bus rather than called from ui/navigation.js, so the
     navigation layer keeps no knowledge of this mode (same reasoning as
     features/map-url-sync.js — see core/app-bus.js). Leaving the map view
     with the body class still set would strand every other view inside a
     non-scrolling, footer-less shell. */
  on("view:changed", (view) => {
    /* The Map page's scroll offset means nothing on the view being opened. */
    if (view !== "map") exitMapExpanded({ restoreScroll: false });
  });

  syncControls();
}
