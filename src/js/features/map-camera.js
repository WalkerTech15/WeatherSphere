/* Moving the map page's camera: flying to a view, holding one until the map
   exists, and the country-jump chips above the map. */
import { $$ } from "../core/dom.js";
import { COUNTRY_JUMPS } from "../data/country-jumps.js";
import { MAPS } from "./map-registry.js";

/* A camera asked for before the map exists — restoring a shared link opens
   the map page and sets its view in the same breath, and the map itself is
   created lazily one frame later. Held here and applied by updateMap(). */
let pendingCamera = null;

/* duration 0 = jump with no flight, used when restoring a shared/bookmarked
   camera on page load: the view should already BE there, not fly there. */
export function jumpTo(center, zoom, { duration = 1200 } = {}) {
  if (!MAPS.worldMap) {
    pendingCamera = { center, zoom, duration };
    return;
  }
  /* bearing/pitch are always explicit here: this is also the camera-restore
     path for a shared/bookmarked URL (see map-url-sync.js), and a link saved
     before this map became permanently flat must still open flat rather than
     replaying a stale tilt/rotation. */
  MAPS.worldMap.map.flyTo({ center, zoom, bearing: 0, pitch: 0, duration });
}

export function applyPendingCamera(id) {
  if (id !== "worldMap" || !pendingCamera || !MAPS.worldMap) return;
  const { center, zoom, duration } = pendingCamera;
  pendingCamera = null;
  MAPS.worldMap.map.flyTo({ center, zoom, bearing: 0, pitch: 0, duration });
}

/* Country-jump chips above the map card ("Monde"/France/États-Unis/Canada).
   Target data lives in data/country-jumps.js (see its own test) so a wrong
   center/zoom pair is caught without needing to render an actual map. */
export function bindCountryFilters() {
  $$(".map-filters .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      $$(".map-filters .chip").forEach((c) => {
        const on = c === chip;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", String(on));
      });
      const jump = COUNTRY_JUMPS[chip.dataset.jump];
      if (jump) jumpTo(jump.center, jump.zoom);
    }),
  );
}
