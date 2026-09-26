import { loadMapLibre } from "./map-sdk.js";
import { MAPS } from "./map-registry.js";

/* ── "You are here" overlay (Google-Maps-style blue dot + accuracy circle) ──
   Rendered as its own layer set per map instance, independent of the search
   pin, so recentering never blinks the pin. userPos is the last known fix so a
   map opened later still shows the dot. */
let userPos = null; // { lat, lon, acc }

/* Approximate a geographic circle of `meters` radius as a 64-gon polygon so the
   accuracy ring scales correctly with zoom (MapLibre circle radii are pixels). */
export function circlePolygon(lon, lat, meters, steps = 64) {
  const R = 6378137,
    rad = Math.PI / 180;
  const dLat = meters / R / rad;
  const dLon = meters / (R * Math.cos(lat * rad)) / rad;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    ring.push([lon + dLon * Math.cos(th), lat + dLat * Math.sin(th)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
}

function setUserLocationOn(inst, lat, lon, acc) {
  const map = inst.map;
  const apply = () => {
    const poly = circlePolygon(lon, lat, Math.max(acc || 0, 20));
    const src = map.getSource("userAcc");
    if (src) {
      src.setData(poly);
    } else {
      map.addSource("userAcc", { type: "geojson", data: poly });
      map.addLayer({
        id: "userAccFill",
        type: "fill",
        source: "userAcc",
        paint: { "fill-color": "#4285F4", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "userAccLine",
        type: "line",
        source: "userAcc",
        paint: { "line-color": "#4285F4", "line-opacity": 0.4, "line-width": 1 },
      });
    }
    if (!inst.userMarker) {
      const dot = document.createElement("div");
      dot.className = "user-loc-dot";
      dot.innerHTML = '<span class="uld-halo"></span><span class="uld-core"></span>';
      loadMapLibre().then((maplibregl) => {
        inst.userMarker = new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(map);
      });
    } else {
      inst.userMarker.setLngLat([lon, lat]);
    }
  };
  /* addSource/addLayer need a loaded style. "idle" is more reliable than a late
     once("load") (which never fires if load already happened before we listened). */
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}

/* Draws the remembered fix on a map created after it was reported. */
export function applyRememberedUserLocation(inst) {
  if (userPos) setUserLocationOn(inst, userPos.lat, userPos.lon, userPos.acc);
}

export function showUserLocation(lat, lon, acc) {
  userPos = { lat, lon, acc };
  Object.values(MAPS).forEach((inst) => setUserLocationOn(inst, lat, lon, acc));
}
