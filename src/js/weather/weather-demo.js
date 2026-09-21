/* Deterministic demo weather — the offline / provider-failure fallback.
   No network: everything is derived from the place itself, so the same place
   always gets the same "weather" (apart from the current date and hour). */

/* Fixed-offset zone string ("Etc/GMT-9") from longitude — offline/demo fallback
   only, no DST. Etc/GMT signs are inverted vs normal tz convention (POSIX). */
export function tzFromLon(lon) {
  const off = Math.round(lon / 15);
  if (off === 0) return "UTC";
  return `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

/* Deterministic demo data (offline fallback) */
export function demoWeather(loc) {
  let seed = 0;
  for (const ch of loc.id || loc.name.en) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const month = new Date().getMonth();
  const north = loc.lat >= 0;
  const summer = north ? [5, 6, 7].includes(month) : [11, 0, 1].includes(month);
  const base = 26 - Math.abs(loc.lat) * 0.45 + (summer ? 8 : -4) + rnd() * 4;
  const hour = new Date().getHours();
  const codes = [0, 1, 2, 3, 61, 2, 1, 0, 80, 3];
  const code = codes[Math.floor(rnd() * codes.length)];

  const hourly = [];
  for (let i = 0; i <= 24; i++) {
    const h = (hour + i) % 24;
    const diurnal = Math.sin(((h - 9) / 24) * Math.PI * 2) * 5;
    hourly.push({
      time: new Date(Date.now() + i * 36e5).toISOString().slice(0, 16),
      temp: base + diurnal + rnd() * 1.4,
      feels: base + diurnal - 1 + rnd() * 3,
      humidity: Math.min(96, Math.max(28, 62 - diurnal * 3 + rnd() * 10)),
      wind: 8 + rnd() * 14 + Math.sin(i / 4) * 4,
      gust: (8 + rnd() * 14 + Math.sin(i / 4) * 4) * 1.45,
      vis: 8 + rnd() * 14,
      pressure: 1013 + Math.sin(i / 7 + seed) * 6 + rnd() * 2,
      rainProb: code >= 61 ? 40 + rnd() * 45 : rnd() * 22,
      code,
      isDay: h >= 7 && h <= 20 ? 1 : 0,
    });
  }
  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const c = codes[Math.floor(rnd() * codes.length)];
    daily.push({
      date: d.toISOString().slice(0, 10),
      code: c,
      hi: base + 4 + rnd() * 3,
      lo: base - 5 - rnd() * 3,
      sunrise: d.toISOString().slice(0, 10) + "T06:42",
      sunset: d.toISOString().slice(0, 10) + "T20:12",
      rainProb: c >= 61 ? 55 + rnd() * 30 : rnd() * 25,
      uvMax: 2 + rnd() * 7,
      windMax: 12 + rnd() * 20,
    });
  }
  const cur = hourly[0];
  return {
    current: {
      temp: cur.temp,
      feels: cur.temp - 1.5 + rnd() * 3,
      humidity: cur.humidity,
      windSpeed: cur.wind,
      gust: cur.gust,
      windDir: rnd() * 360,
      pressure: cur.pressure,
      code,
      isDay: cur.isDay,
      uv: daily[0].uvMax * (cur.isDay ? 0.8 : 0),
      visibility: 8 + rnd() * 14,
      dewPoint: cur.temp - 4 - rnd() * 4,
      rainProb: cur.rainProb,
      aqi: Math.round(25 + rnd() * 40),
    },
    hourly,
    daily,
    updatedAt: new Date(),
    timezone: tzFromLon(loc.lon) /* no network in demo mode — offset-only estimate */,
  };
}
