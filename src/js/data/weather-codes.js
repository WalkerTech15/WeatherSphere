/* WMO weather codes → icon type + labels. */
export const WMO = {
  0: { icon: "clear", en: "Clear sky", fr: "Ciel dégagé", es: "Cielo despejado" },
  1: { icon: "clear", en: "Mainly clear", fr: "Plutôt dégagé", es: "Mayormente despejado" },
  2: {
    icon: "partly",
    en: "Partly cloudy",
    fr: "Partiellement nuageux",
    es: "Parcialmente nublado",
  },
  3: { icon: "cloudy", en: "Overcast", fr: "Couvert", es: "Cubierto" },
  45: { icon: "fog", en: "Fog", fr: "Brouillard", es: "Niebla" },
  48: { icon: "fog", en: "Rime fog", fr: "Brouillard givrant", es: "Niebla con escarcha" },
  51: { icon: "rain", en: "Light drizzle", fr: "Bruine légère", es: "Llovizna ligera" },
  53: { icon: "rain", en: "Drizzle", fr: "Bruine", es: "Llovizna" },
  55: { icon: "rain", en: "Heavy drizzle", fr: "Bruine dense", es: "Llovizna intensa" },
  56: { icon: "rain", en: "Freezing drizzle", fr: "Bruine verglaçante", es: "Llovizna helada" },
  57: { icon: "rain", en: "Freezing drizzle", fr: "Bruine verglaçante", es: "Llovizna helada" },
  61: { icon: "rain", en: "Light rain", fr: "Pluie légère", es: "Lluvia ligera" },
  63: { icon: "rain", en: "Rain", fr: "Pluie", es: "Lluvia" },
  65: { icon: "rain", en: "Heavy rain", fr: "Pluie forte", es: "Lluvia intensa" },
  66: { icon: "rain", en: "Freezing rain", fr: "Pluie verglaçante", es: "Lluvia helada" },
  67: { icon: "rain", en: "Freezing rain", fr: "Pluie verglaçante", es: "Lluvia helada" },
  71: { icon: "snow", en: "Light snow", fr: "Neige légère", es: "Nevada ligera" },
  73: { icon: "snow", en: "Snow", fr: "Neige", es: "Nieve" },
  75: { icon: "snow", en: "Heavy snow", fr: "Neige forte", es: "Nevada intensa" },
  77: { icon: "snow", en: "Snow grains", fr: "Neige en grains", es: "Cristales de nieve" },
  80: { icon: "rain", en: "Light showers", fr: "Averses légères", es: "Chubascos ligeros" },
  81: { icon: "rain", en: "Showers", fr: "Averses", es: "Chubascos" },
  82: { icon: "rain", en: "Violent showers", fr: "Averses violentes", es: "Chubascos violentos" },
  85: { icon: "snow", en: "Snow showers", fr: "Averses de neige", es: "Chubascos de nieve" },
  86: { icon: "snow", en: "Snow showers", fr: "Averses de neige", es: "Chubascos de nieve" },
  95: { icon: "storm", en: "Thunderstorm", fr: "Orage", es: "Tormenta" },
  96: {
    icon: "storm",
    en: "Thunderstorm with hail",
    fr: "Orage avec grêle",
    es: "Tormenta con granizo",
  },
  99: {
    icon: "storm",
    en: "Thunderstorm with hail",
    fr: "Orage avec grêle",
    es: "Tormenta con granizo",
  },
};

export function wmo(code) {
  return WMO[code] || WMO[0];
}

export function wxDesc(code, lang) {
  const entry = wmo(code);
  return entry[lang] ?? entry.en;
}

/* clear/cloudy icon key, day/night-aware — used to pick the hero gradient */
export function skyKey(code, isDay) {
  const icon = wmo(code).icon;
  if (icon === "clear" || icon === "partly") return isDay ? "clear-day" : "clear-night";
  if (icon === "cloudy") return isDay ? "cloudy-day" : "cloudy-night";
  return icon; // rain / snow / storm / fog
}
