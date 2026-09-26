/* Lazy loading of the MapTiler SDK, and the two waits that decide WHEN the
   Home preview map is allowed to start loading it. Nothing here touches a map
   instance — it only hands out the SDK (see map-instance.js). */
import { MAPTILER_KEY } from "../core/config.js";

/* The SDK's stylesheet is imported HERE, inside the dynamic import, rather
   than statically at the top of this module. features/map.js is reachable
   from main.js through ui/navigation.js, so a static CSS import put
   maptiler-sdk.css (~101 KB, 409 selectors — over half the whole stylesheet)
   into the render-blocking bundle for every visitor, including those who
   never open a map. Awaited together with the SDK itself, so the controls it
   styles cannot paint before it lands; Vite emits it as the SDK chunk's own
   async stylesheet. */
let maplibreglPromise = null;
export function loadMapLibre() {
  if (!maplibreglPromise)
    maplibreglPromise = Promise.all([
      import("@maptiler/sdk"),
      import("@maptiler/sdk/dist/maptiler-sdk.css"),
    ]).then(([sdk]) => {
      sdk.config.apiKey = MAPTILER_KEY;
      return sdk;
    });
  return maplibreglPromise;
}

/* Resolves once `el` is within HOME_MAP_LEAD_PX of being scrolled into view.
   Used once, below, for the Home mini-map: its first creation pulls in the
   whole MapTiler SDK chunk (~320 KB gzipped, ~1.2 MB to parse) and ~20
   style/tile/glyph requests (~1.1 MB), and it starts 540–1100px below the
   fold on phones and tablets — so a visitor who never scrolls that far never
   pays for it, and one who does finds it already on its way. 400px is about
   half a phone screen: a full screen would already cover the map at first
   load on most phones and defer nothing. A fixed lead rather than a viewport
   percentage, for the reason given in photo-api.js's whenPhotoNearViewport().
   An explicit visit to the full Map page is never delayed by this (see the
   `id === "homeMap"` check at the call site). Resolves immediately where
   IntersectionObserver is unavailable, so eager creation is the fallback. */
const HOME_MAP_LEAD_PX = 400;
export function whenMapNearViewport(el) {
  if (typeof IntersectionObserver !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        resolve();
      },
      { rootMargin: `${HOME_MAP_LEAD_PX}px 0px` },
    );
    observer.observe(el);
  });
}

/* Resolves on the next idle moment (or after `timeout`, whichever comes
   first) — Safari has no requestIdleCallback, so it just resolves on the next
   tick there instead. Chained after whenMapNearViewport(): on a wide screen
   the preview is near the fold from the start, and creating it on the first
   frame would put the SDK's download and ~1.2 MB parse inside the window
   where the hero photo and first forecast are still landing. */
export function idle(timeout = 300) {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 0);
  });
}
