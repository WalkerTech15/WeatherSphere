/* The live map instances, and read-only accessors over them. A leaf module
   (no imports), so anything that has to reach a map — layers, camera, user
   location — can share the one registry without importing map-instance.js. */
export const MAPS = {}; // containerId → { map, marker, popup, lastKey }

/* Current camera of the map page's map, for URL serialization. */
export function getMapCamera() {
  const inst = MAPS.worldMap;
  if (!inst) return null;
  try {
    const center = inst.map.getCenter();
    return { lat: center.lat, lon: center.lng, zoom: inst.map.getZoom() };
  } catch {
    return null; /* map removed mid-call */
  }
}

export function resizeMaps() {
  Object.values(MAPS).forEach((m) => {
    try {
      m.map.resize();
    } catch {
      /* map not fully initialized yet — ignore */
    }
  });
}

/* Bearing/pitch are rendered into the WebGL canvas itself — unlike center,
   zoom or the selected layer, nothing about them is ever reflected in the
   DOM or the URL, so there is no way for a Playwright test to observe (or, to
   set up a "what if it were tilted?" case for the reset button) without some
   accessor. `import.meta.env.DEV` is Vite's own build-time flag: this whole
   block is dead code eliminated from `npm run build`'s output (verified by
   scripts/verify-no-secrets.mjs scanning dist/), so it only ever exists
   under `vite dev`/`vite preview`, which is what Playwright drives. */
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__mapOrientationForTests = {
    get: (id = "worldMap") => {
      const inst = MAPS[id];
      if (!inst) return null;
      return {
        bearing: inst.map.getBearing(),
        pitch: inst.map.getPitch(),
        dragRotateEnabled: inst.map.dragRotate.isEnabled(),
        touchPitchEnabled: inst.map.touchPitch.isEnabled(),
        /* MapLibre has no public getter for "is JUST the rotate half of this
           handler disabled" (only the enable/disable pair below) — reading
           the handler's own internal flag is fine here since this whole
           block never reaches production (see the DEV guard above). */
        touchRotateDisabled: inst.map.touchZoomRotate._rotationDisabled === true,
        keyboardRotateDisabled: inst.map.keyboard._rotationDisabled === true,
        /* the handlers this fix deliberately leaves untouched — pan and
           zoom must stay on, on both desktop and touch */
        dragPanEnabled: inst.map.dragPan.isEnabled(),
        scrollZoomEnabled: inst.map.scrollZoom.isEnabled(),
        touchZoomRotateEnabled: inst.map.touchZoomRotate.isEnabled(),
      };
    },
    /* test setup only, to exercise the reset control — the app itself never
       calls setBearing/setPitch anywhere */
    set: (id = "worldMap", bearing, pitch) => {
      const inst = MAPS[id];
      if (!inst) return false;
      inst.map.setBearing(bearing);
      inst.map.setPitch(pitch);
      return true;
    },
  };
}
