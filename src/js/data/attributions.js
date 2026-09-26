/* Every third-party provider the app actually uses, in one list.
 *
 * Two places read it: the footer's one-line credit (only providers marked
 * `footer`, so the main UI carries no attribution clutter) and the "Data
 * sources" card on the About page (all of them, with a link to each). Credit
 * that belongs to particular content stays with that content — each photo names
 * its own provider, the Clouds and Lightning panels name theirs, the map's
 * attribution control names the tiles' — and is not repeated here.
 *
 * Only providers that are wired up belong in this list. `blurb` is a
 * translation key. `host` is the short label on the link. Pure data: no
 * imports, so translations.js can build the footer text from it. */
export const DATA_PROVIDERS = [
  {
    id: "open-meteo",
    name: "Open-Meteo",
    url: "https://open-meteo.com",
    host: "open-meteo.com",
    logo: "OM",
    tone: "primary",
    blurb: "srcOm",
    footer: true,
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    host: "openstreetmap.org",
    logo: "OSM",
    tone: "emerald",
    blurb: "srcOsm",
    footer: true,
  },
  {
    id: "maptiler",
    name: "MapTiler",
    url: "https://www.maptiler.com",
    host: "maptiler.com",
    logo: "MT",
    tone: "sky",
    blurb: "srcMaptiler",
    footer: true,
  },
  {
    id: "pexels",
    name: "Pexels",
    url: "https://www.pexels.com",
    host: "pexels.com",
    logo: "Px",
    tone: "emerald",
    blurb: "srcPexels",
  },
  {
    id: "bigdatacloud",
    name: "BigDataCloud",
    url: "https://www.bigdatacloud.com",
    host: "bigdatacloud.com",
    logo: "BDC",
    tone: "amber",
    blurb: "srcBigdatacloud",
  },
  {
    id: "wikimedia",
    name: "Wikimedia Commons",
    url: "https://commons.wikimedia.org",
    host: "commons.wikimedia.org",
    logo: "WM",
    tone: "violet",
    blurb: "srcWikimedia",
  },
  {
    id: "openweathermap",
    name: "OpenWeatherMap",
    url: "https://openweathermap.org",
    host: "openweathermap.org",
    logo: "OWM",
    tone: "rose",
    blurb: "srcOpenWeather",
  },
  {
    id: "xweather",
    name: "Xweather",
    url: "https://www.xweather.com",
    host: "xweather.com",
    logo: "XW",
    tone: "primary",
    blurb: "srcXweather",
  },
  {
    id: "nws",
    name: "National Weather Service",
    url: "https://www.weather.gov",
    host: "weather.gov",
    logo: "NWS",
    tone: "sky",
    blurb: "srcNws",
  },
  {
    id: "google-places",
    name: "Google Places",
    url: "https://developers.google.com/maps/documentation/places/web-service",
    host: "developers.google.com",
    logo: "G",
    tone: "amber",
    blurb: "srcGoogle",
  },
  {
    id: "mapillary",
    name: "Mapillary",
    url: "https://www.mapillary.com",
    host: "mapillary.com",
    logo: "Mly",
    tone: "emerald",
    blurb: "srcMapillary",
  },
];

export function providerById(id) {
  return DATA_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/* "Open-Meteo · OpenStreetMap · MapTiler" — the footer's credit line. */
export function footerProviderNames() {
  return DATA_PROVIDERS.filter((provider) => provider.footer)
    .map((provider) => provider.name)
    .join(" · ");
}
