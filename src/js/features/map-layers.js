/* Switching the map's layer. Air Quality, Humidity, Alerts, Lightning and
   Clouds have no MapTiler weather layer (WEATHER_LAYER_IDS deliberately
   excludes them — see weather-layers.js) and each follows its own flow; every
   other choice is a ramp layer, or Satellite, handled by map-overlay.js. */
import { setRampLayer } from "./map-overlay.js";
import { setAirQualityLayer } from "./map-layer-air-quality.js";
import { setHumidityLayer } from "./map-layer-humidity.js";
import { setAlertsLayer } from "./map-layer-alerts.js";
import { setLightningLayer } from "./map-layer-lightning.js";
import { setCloudsLayer } from "./map-layer-clouds.js";

export const OWN_FLOW_LAYERS = {
  airQuality: setAirQualityLayer,
  humidity: setHumidityLayer,
  alerts: setAlertsLayer,
  lightning: setLightningLayer,
  clouds: setCloudsLayer,
};

export async function setMapLayer(type, options) {
  const setOwnLayer = Object.hasOwn(OWN_FLOW_LAYERS, type) ? OWN_FLOW_LAYERS[type] : null;
  return setOwnLayer ? setOwnLayer() : setRampLayer(type, options);
}
