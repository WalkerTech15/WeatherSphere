/* WMO weather codes → icon type + labels. */
export const WMO = {
  0: { icon: "clear", en: "Clear sky", fr: "Ciel dégagé", es: "Cielo despejado", vi: "Trời quang" },
  1: {
    icon: "clear",
    en: "Mainly clear",
    fr: "Plutôt dégagé",
    es: "Mayormente despejado",
    vi: "Quang đãng, ít mây",
  },
  2: {
    icon: "partly",
    en: "Partly cloudy",
    fr: "Partiellement nuageux",
    es: "Parcialmente nublado",
    vi: "Có mây rải rác",
  },
  3: { icon: "cloudy", en: "Overcast", fr: "Couvert", es: "Cubierto", vi: "U ám" },
  45: { icon: "fog", en: "Fog", fr: "Brouillard", es: "Niebla", vi: "Sương mù" },
  48: {
    icon: "fog",
    en: "Rime fog",
    fr: "Brouillard givrant",
    es: "Niebla con escarcha",
    vi: "Sương mù đóng băng",
  },
  51: {
    icon: "rain",
    en: "Light drizzle",
    fr: "Bruine légère",
    es: "Llovizna ligera",
    vi: "Mưa phùn nhẹ",
  },
  53: { icon: "rain", en: "Drizzle", fr: "Bruine", es: "Llovizna", vi: "Mưa phùn" },
  55: {
    icon: "rain",
    en: "Heavy drizzle",
    fr: "Bruine dense",
    es: "Llovizna intensa",
    vi: "Mưa phùn nặng hạt",
  },
  56: {
    icon: "rain",
    en: "Freezing drizzle",
    fr: "Bruine verglaçante",
    es: "Llovizna helada",
    vi: "Mưa phùn đóng băng",
  },
  57: {
    icon: "rain",
    en: "Freezing drizzle",
    fr: "Bruine verglaçante",
    es: "Llovizna helada",
    vi: "Mưa phùn đóng băng",
  },
  61: {
    icon: "rain",
    en: "Light rain",
    fr: "Pluie légère",
    es: "Lluvia ligera",
    vi: "Mưa nhẹ",
  },
  63: { icon: "rain", en: "Rain", fr: "Pluie", es: "Lluvia", vi: "Mưa" },
  65: {
    icon: "rain",
    en: "Heavy rain",
    fr: "Pluie forte",
    es: "Lluvia intensa",
    vi: "Mưa to",
  },
  66: {
    icon: "rain",
    en: "Freezing rain",
    fr: "Pluie verglaçante",
    es: "Lluvia helada",
    vi: "Mưa đóng băng",
  },
  67: {
    icon: "rain",
    en: "Freezing rain",
    fr: "Pluie verglaçante",
    es: "Lluvia helada",
    vi: "Mưa đóng băng",
  },
  71: {
    icon: "snow",
    en: "Light snow",
    fr: "Neige légère",
    es: "Nevada ligera",
    vi: "Tuyết nhẹ",
  },
  73: { icon: "snow", en: "Snow", fr: "Neige", es: "Nieve", vi: "Tuyết" },
  75: {
    icon: "snow",
    en: "Heavy snow",
    fr: "Neige forte",
    es: "Nevada intensa",
    vi: "Tuyết rơi dày",
  },
  77: {
    icon: "snow",
    en: "Snow grains",
    fr: "Neige en grains",
    es: "Cristales de nieve",
    vi: "Hạt tuyết",
  },
  80: {
    icon: "rain",
    en: "Light showers",
    fr: "Averses légères",
    es: "Chubascos ligeros",
    vi: "Mưa rào nhẹ",
  },
  81: { icon: "rain", en: "Showers", fr: "Averses", es: "Chubascos", vi: "Mưa rào" },
  82: {
    icon: "rain",
    en: "Violent showers",
    fr: "Averses violentes",
    es: "Chubascos violentos",
    vi: "Mưa rào dữ dội",
  },
  85: {
    icon: "snow",
    en: "Snow showers",
    fr: "Averses de neige",
    es: "Chubascos de nieve",
    vi: "Mưa tuyết rào",
  },
  86: {
    icon: "snow",
    en: "Snow showers",
    fr: "Averses de neige",
    es: "Chubascos de nieve",
    vi: "Mưa tuyết rào",
  },
  95: { icon: "storm", en: "Thunderstorm", fr: "Orage", es: "Tormenta", vi: "Dông" },
  96: {
    icon: "storm",
    en: "Thunderstorm with hail",
    fr: "Orage avec grêle",
    es: "Tormenta con granizo",
    vi: "Dông kèm mưa đá",
  },
  99: {
    icon: "storm",
    en: "Thunderstorm with hail",
    fr: "Orage avec grêle",
    es: "Tormenta con granizo",
    vi: "Dông kèm mưa đá",
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
