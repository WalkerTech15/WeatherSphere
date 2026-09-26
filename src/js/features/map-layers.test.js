/* Choosing a layer: the five layers with their own flow go to it, everything
 * else is a ramp layer (or Satellite). */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = vi.hoisted(() => []);

vi.mock("./map-overlay.js", () => ({
  setRampLayer: (...args) => calls.push(["ramp", ...args]),
}));
vi.mock("./map-layer-air-quality.js", () => ({
  setAirQualityLayer: () => calls.push(["airQuality"]),
}));
vi.mock("./map-layer-humidity.js", () => ({
  setHumidityLayer: (...args) => calls.push(["humidity", ...args]),
}));
vi.mock("./map-layer-alerts.js", () => ({ setAlertsLayer: () => calls.push(["alerts"]) }));
vi.mock("./map-layer-lightning.js", () => ({
  setLightningLayer: () => calls.push(["lightning"]),
}));
vi.mock("./map-layer-clouds.js", () => ({ setCloudsLayer: () => calls.push(["clouds"]) }));

import { setMapLayer, OWN_FLOW_LAYERS } from "./map-layers.js";

beforeEach(() => {
  calls.length = 0;
});

describe("setMapLayer", () => {
  it.each(["airQuality", "humidity", "alerts", "lightning", "clouds"])(
    "sends %s to its own flow, and never to the ramp",
    async (type) => {
      await setMapLayer(type);
      expect(calls.map(([name]) => name)).toEqual([type]);
    },
  );

  it("hands a shared link's forecast hour to Humidity, the own-flow layer that reads one", async () => {
    await setMapLayer("humidity", { offset: 12 });
    expect(calls).toEqual([["humidity", { offset: 12 }]]);
  });

  it.each(["temperature", "rain", "wind", "pressure", "satellite"])(
    "sends %s to the ramp flow, with its options",
    async (type) => {
      await setMapLayer(type, { offset: 3 });
      expect(calls).toEqual([["ramp", type, { offset: 3 }]]);
    },
  );

  it("leaves an unknown layer to the ramp flow, which treats it as satellite", async () => {
    await setMapLayer("sunshine");
    expect(calls).toEqual([["ramp", "sunshine", undefined]]);
  });

  it("is not fooled by names every object has", async () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      await setMapLayer(name);
    }
    expect(calls.map(([kind]) => kind)).toEqual(["ramp", "ramp", "ramp", "ramp"]);
  });

  it("covers exactly the layers that have no MapTiler weather layer", () => {
    expect(Object.keys(OWN_FLOW_LAYERS).sort()).toEqual(
      ["airQuality", "alerts", "clouds", "humidity", "lightning"].sort(),
    );
  });
});
