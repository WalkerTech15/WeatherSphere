/* Provider-independent weather shapes.
 *
 * Providers translate their own payloads into two app-level shapes:
 *
 *   - a full forecast (`{ current, hourly, daily, updatedAt, timezone, _aqi }`)
 *     for the selected place — see providers/open-meteo.js;
 *   - a "snapshot" per place for the batched lists (favorites, popular,
 *     nearby, comparison): `{ temp, feels, humidity, windSpeed, code, isDay,
 *     hi, lo, rainProb, rainProbMax, uvMax, timezone }`. Fields are copied
 *     as-is, so a value the provider omitted stays `undefined` and each
 *     consumer below keeps applying its own default.
 *
 * The per-consumer functions reproduce exactly what each list stored before
 * the weather layer existed; they are the only place those shapes are built,
 * whether the snapshot came from the network or from demo data. */

/* Index of the hourly slot containing `currentTime`, matched on the
   "YYYY-MM-DDTHH" prefix. Hourly series are in each place's own local time
   (timezone=auto), so "now" is looked up rather than assumed to be index 0.
   Falls back to 0 when nothing matches. */
export function currentHourIndex(times, currentTime) {
  const nowIso = typeof currentTime === "string" ? currentTime.slice(0, 13) : null;
  const idx =
    nowIso && Array.isArray(times) ? times.findIndex((x) => x.slice(0, 13) === nowIso) : -1;
  return idx < 0 ? 0 : idx;
}

/* Snapshot built from a full forecast — used for demo data, so the offline
   fallback goes through the same per-consumer shapes as live data. */
export function snapshotFromForecast(wx) {
  const today = wx.daily[0];
  return {
    temp: wx.current.temp,
    feels: wx.current.feels,
    humidity: wx.current.humidity,
    windSpeed: wx.current.windSpeed,
    code: wx.current.code,
    isDay: wx.current.isDay,
    hi: today.hi,
    lo: today.lo,
    rainProb: wx.current.rainProb,
    rainProbMax: today.rainProb,
    uvMax: today.uvMax,
    timezone: wx.timezone,
  };
}

/* A missing snapshot means the provider's answer for that place was
   unusable. Favorites and popular treat that as a failed batch (they fall
   back to demo data for every place), so these throw. */
function requireSnapshot(snapshot) {
  if (!snapshot) throw new TypeError("Missing weather for a requested place");
  return snapshot;
}

export function toFavoriteWeather(snapshot) {
  const s = requireSnapshot(snapshot);
  return {
    temp: s.temp,
    code: s.code,
    isDay: s.isDay,
    humidity: s.humidity,
    wind: s.windSpeed,
    hi: s.hi,
    lo: s.lo,
  };
}

export function toPopularWeather(snapshot) {
  const s = requireSnapshot(snapshot);
  return { temp: s.temp, code: s.code, isDay: s.isDay };
}

/* Nearby lists a place even when its weather is missing. */
export function toNearbyWeather(snapshot) {
  if (!snapshot) return null;
  return {
    temp: snapshot.temp,
    windSpeed: snapshot.windSpeed,
    code: snapshot.code,
    isDay: snapshot.isDay,
    rainProb: snapshot.rainProb ?? 0,
  };
}

/* Comparison prints "—" for anything missing, so every metric is null
   rather than undefined. `aqi` is filled in separately. */
export function toComparisonWeather(snapshot) {
  return {
    temp: snapshot?.temp ?? null,
    feelsLike: snapshot?.feels ?? null,
    humidity: snapshot?.humidity ?? null,
    wind: snapshot?.windSpeed ?? null,
    code: snapshot?.code ?? null,
    isDay: snapshot?.isDay ?? 1,
    precipitation: snapshot?.rainProbMax ?? null,
    uv: snapshot?.uvMax ?? null,
    timezone: snapshot?.timezone || null,
    aqi: null,
  };
}
