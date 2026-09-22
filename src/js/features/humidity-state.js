/* Pure classification of the Humidity map-layer's point reading.
 *
 * Open-Meteo's `relative_humidity_2m` is already part of the ordinary
 * forecast request every place fetches on selection (see
 * providers/open-meteo.js's FORECAST_PARAMS and features/location.js) — a
 * humidity reading for the selected place is therefore read straight from
 * the app's already-fetched forecast (`state.wx`), never fetched again on
 * its own. There is also no spatial/tile product for it (MapTiler's weather
 * SDK offers only temperature, rain, wind and pressure layers — see
 * features/weather-layers.js's WEATHER_LAYER_IDS), so, like Air Quality,
 * this is a point reading for the selected place, not a map-wide colour
 * layer.
 *
 * Kept here as a pure function of explicit arguments — rather than reading
 * core/state.js or services/offline.js directly — so the whole state
 * machine is unit-testable with plain objects, no module mocking, the same
 * way map-legend.js's buildLegend() is. features/map.js supplies the real
 * arguments and owns the render/DOM side. */
export function computeHumidityState({ loc, wx, isDemo, offline }) {
  if (!loc) return { status: "error", data: null, errorKind: "unavailable" };
  if (!wx) return { status: "loading", data: null, errorKind: null };
  /* The app's shared forecast pipeline already falls back to deterministic
     demo data on any fetch failure (features/location.js) so the rest of
     the page always has SOMETHING to show. This panel is an honest point
     reading, though, so it reports the failure instead of quietly
     displaying a fabricated number as if it were real — `offline` when the
     browser itself is offline, `error` for any other cause (timeout, HTTP
     error, malformed response — the shared pipeline does not preserve
     which). */
  if (isDemo) return { status: "error", data: null, errorKind: offline ? "offline" : "error" };
  const value = wx.current?.humidity;
  if (!Number.isFinite(value)) return { status: "error", data: null, errorKind: "unavailable" };
  return {
    status: "ready",
    data: { humidity: value, updatedAt: wx.updatedAt },
    errorKind: null,
  };
}
