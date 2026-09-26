/* Humidity: a point reading derived from the forecast already fetched. */
import { $ } from "../core/dom.js";
import { state } from "../core/state.js";
import { emit, on } from "../core/app-bus.js";
import { removeWeatherLayer } from "./weather-layers.js";
import { MAPS } from "./map-registry.js";
import { updateMap } from "./map-instance.js";
import {
  overlay,
  getMapOverlayState,
  setLayerButtonState,
  renderWeatherOverlay,
  announceLayerStatus,
  detachOverlayAnimation,
  resetOverlay,
  startLayerRequest,
  registerOverlayLayer,
} from "./map-overlay.js";
import { isOffline } from "../services/offline.js";
import { computeHumidityState } from "./humidity-state.js";
import { renderHumidityUI, humidityAnnouncement } from "../ui/render-map-humidity.js";

/* The Humidity layer's own state — also a POINT reading for the selected
 * place (MapTiler's weather SDK has no humidity layer), but unlike Air
 * Quality it needs no network request of its own: relative humidity is
 * already part of the ordinary forecast every place fetches on selection
 * (state.wx — see features/location.js), so this is derived from that,
 * synchronously, by computeHumidityState() (features/humidity-state.js). */
const humidityState = {
  status: "idle" /* idle | loading | ready | error */,
  data: null,
  errorKind: null /* "offline" | "unavailable" | "error", set only when status is "error" */,
};

/* Set by bindHumidity() the instant a new place is chosen, to the wx object
 * that was current just before that choice — i.e. the wrong one for the
 * place now in state.loc. features/location.js reassigns state.loc
 * synchronously, well before its forecast fetch resolves and state.wx
 * catches up (see selectLocation()); in that gap, state.loc and state.wx
 * describe two DIFFERENT places. Ordinarily that gap is harmless here — but
 * navigating away while it's open (e.g. the explore carousel's card click
 * calls selectLocation() then switchView("home"), and switchView() calls
 * renderMap() synchronously for the home view too) makes
 * renderWeatherOverlay() run in exactly that window, which would otherwise
 * repaint the OLD wx's humidity number as if it were the new place's
 * reading. null once state.wx has actually moved on (a new object — see
 * refreshHumidityState() below), so this never blocks a legitimate later
 * refresh (language switch, a layer click, unrelated re-renders). */
let humidityPendingWx = null;

/* Recomputes humidityState from whatever state.wx currently holds, unless
   state.wx has not yet caught up with the place a selection already moved
   state.loc to (see humidityPendingWx above) — in that case this is a
   deliberate no-op, leaving whatever was already painted (the "loading"
   state bindHumidity() set) alone rather than showing the previous
   place's number under the new place's name. */
function refreshHumidityState() {
  if (humidityPendingWx && state.wx === humidityPendingWx) return;
  humidityPendingWx = null;
  Object.assign(
    humidityState,
    computeHumidityState({
      loc: state.loc,
      wx: state.wx,
      isDemo: state.isDemo,
      offline: isOffline(),
    }),
  );
}

/* Selecting the Humidity layer: like Air Quality, no spatial layer exists
 * for it, so the satellite basemap simply stays on screen (any previous
 * weather ramp layer is removed) while the reading for the currently
 * selected place is shown. Unlike Air Quality, there is no network request
 * of its own to await here — the reading comes straight from state.wx,
 * already fetched by ordinary location selection — so this is
 * synchronous once the (possibly still-loading) basemap settles. */
export async function setHumidityLayer() {
  const isStale = startLayerRequest();
  const button = $('.map-layer[data-map-layer="humidity"]');
  button?.classList.add("is-loading");
  detachOverlayAnimation();

  resetOverlay("humidity");
  renderWeatherOverlay();

  try {
    await updateMap("worldMap");
    if (isStale()) return;
    removeWeatherLayer(MAPS.worldMap);
  } catch {
    /* the map/basemap failing to load is reported by the map's own
       offline state elsewhere; still attempt the reading below */
  }
  if (isStale()) {
    button?.classList.remove("is-loading");
    return;
  }
  setLayerButtonState("humidity"); /* also clears "is-loading" on every button */
  renderWeatherOverlay();
  emit("map:layer", getMapOverlayState());
}

/* One-time wiring, called once from main.js alongside bindAirQuality(). A
 * location change must never leave the previous place's humidity number on
 * screen: the panel drops back to "loading" the instant a new place is
 * chosen — synchronously, before the new forecast even starts — and only
 * renderWeatherOverlay()'s next call (once state.wx belongs to the new
 * place — see features/location.js's renderAllWeather()) is allowed to
 * show a reading again. Fires on every selection, but only acts while
 * Humidity is the active layer. */
export function bindHumidity() {
  on("location:selecting", () => {
    /* set unconditionally, not just while Humidity is the active layer:
       selecting it LATER, before this place's forecast has landed, must
       still see the gap and hold off rather than trust a wx that turns
       out to belong to an even earlier place. */
    humidityPendingWx = state.wx;
    if (overlay.type !== "humidity") return;
    humidityState.status = "loading";
    humidityState.data = null;
    humidityState.errorKind = null;
    renderHumidityUI(humidityState);
    announceLayerStatus(humidityAnnouncement(humidityState));
  });
}

registerOverlayLayer("humidity", {
  render() {
    refreshHumidityState();
    renderHumidityUI(humidityState);
  },
  announcement: () => humidityAnnouncement(humidityState),
  reset() {
    humidityState.status = "idle";
    humidityState.data = null;
    humidityState.errorKind = null;
  },
});
