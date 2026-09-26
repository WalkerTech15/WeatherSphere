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
 * The forecast time (now / +3 h / +6 h / +12 h / +24 h) reads the SAME
 * `wx.hourly` array — see features/map-timeline.js's hourlyEntryAtOffset —
 * so choosing a later hour costs no request. An hour the forecast does not
 * reach is reported as unavailable (and its button disabled), never replaced
 * by a neighbouring hour or an invented value.
 *
 * Kept here as a pure function of explicit arguments — rather than reading
 * core/state.js or services/offline.js directly — so the whole state
 * machine is unit-testable with plain objects, no module mocking, the same
 * way map-legend.js's buildLegend() is. features/map.js supplies the real
 * arguments and owns the render/DOM side. */
import { availableHourlyOffsets, hourlyEntryAtOffset, offsetTargetMs } from "./map-timeline.js";

/* The offsets this place's forecast can answer: "now" comes from the current
   reading, every later one from an hourly entry that really has a humidity. */
function humidityOffsets(wx) {
  const later = availableHourlyOffsets(wx.hourly, "humidity").filter((offset) => offset > 0);
  return Number.isFinite(wx.current?.humidity) ? [0, ...later] : later;
}

function humidityAt(wx, offset) {
  return offset === 0 ? wx.current?.humidity : hourlyEntryAtOffset(wx.hourly, offset)?.humidity;
}

export function computeHumidityState({ loc, wx, isDemo, offline, offset = 0, nowMs }) {
  if (!loc) return { status: "error", data: null, errorKind: "unavailable", offsets: [] };
  if (!wx) return { status: "loading", data: null, errorKind: null, offsets: [] };
  /* The app's shared forecast pipeline already falls back to deterministic
     demo data on any fetch failure (features/location.js) so the rest of
     the page always has SOMETHING to show. This panel is an honest point
     reading, though, so it reports the failure instead of quietly
     displaying a fabricated number as if it were real — `offline` when the
     browser itself is offline, `error` for any other cause (timeout, HTTP
     error, malformed response — the shared pipeline does not preserve
     which). */
  if (isDemo) {
    return { status: "error", data: null, errorKind: offline ? "offline" : "error", offsets: [] };
  }
  const offsets = humidityOffsets(wx);
  const value = humidityAt(wx, offset);
  if (!Number.isFinite(value)) {
    return { status: "error", data: null, errorKind: "unavailable", offsets };
  }
  return {
    status: "ready",
    data: {
      humidity: value,
      updatedAt: wx.updatedAt,
      offset,
      timeMs: offsetTargetMs(offset, nowMs),
    },
    errorKind: null,
    offsets,
  };
}
