const ENDPOINT = "https://data.api.xweather.com/lightning/closest";
const TIMEOUT_MS = 8000;

function number(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const lat = number(req.query?.lat, -90, 90);
  const lon = number(req.query?.lon, -180, 180);
  const radius = number(req.query?.radius, 1, 100) || 40;
  const clientId = process.env.XWEATHER_CLIENT_ID;
  const clientSecret = process.env.XWEATHER_CLIENT_SECRET;
  if (lat === null || lon === null) return res.status(400).json({ error: "invalid_coordinates" });
  if (!clientId || !clientSecret) return res.status(503).json({ error: "unavailable" });

  const url = new URL(`${ENDPOINT}/${lat},${lon}`);
  url.search = new URLSearchParams({
    radius: String(radius),
    client_id: clientId,
    client_secret: clientSecret,
  });
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!upstream.ok) {
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: "upstream_error" });
    }
    const payload = await upstream.json();
    const strikes = Array.isArray(payload?.response)
      ? payload.response.map((item) => item?.ob).filter((item) => Number.isFinite(item?.lat) && Number.isFinite(item?.lon))
      : [];
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.status(200).json({
      provider: "Xweather",
      source: "https://www.xweather.com/docs/weather-api/endpoints/lightning",
      updatedAt: new Date().toISOString(),
      strikes: strikes.slice(0, 1000).map((item) => ({
        lat: item.lat,
        lon: item.lon,
        type: typeof item.type === "string" ? item.type : "",
        amperage: Number.isFinite(item.amperage) ? item.amperage : null,
      })),
    });
  } catch (error) {
    const status = error?.name === "TimeoutError" ? 504 : 502;
    return res.status(status).json({ error: "upstream_error" });
  }
}
