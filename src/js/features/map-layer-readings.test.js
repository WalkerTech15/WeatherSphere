/* Air Quality and Humidity: the two point readings. Neither draws anything on
 * the map; the satellite basemap stays underneath. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeGeoMap, stubLayerDocument, PARIS, TARBES } from "./map-layer-harness.js";

const mocks = vi.hoisted(() => ({
  updateMap: vi.fn(async () => {}),
  fetchAirQuality: vi.fn(),
  paintAir: vi.fn(),
  paintHumidity: vi.fn(),
  offline: false,
}));

vi.mock("./map-instance.js", () => ({ updateMap: mocks.updateMap }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-map-weather.js", () => ({
  renderWeatherOverlayUI: vi.fn(),
  updateTimeStatus: vi.fn(),
}));
vi.mock("../services/offline.js", () => ({ isOffline: () => mocks.offline }));
vi.mock("../weather/weather-provider.js", () => ({
  fetchAirQualityDetail: mocks.fetchAirQuality,
}));
vi.mock("../ui/render-map-airquality.js", () => ({
  renderAirQualityUI: mocks.paintAir,
  airQualityAnnouncement: (state) => `air ${state.status} ${state.errorKind ?? ""}`.trim(),
}));
vi.mock("../ui/render-map-humidity.js", () => ({
  renderHumidityUI: mocks.paintHumidity,
  humidityAnnouncement: (state) => `humidity ${state.status} ${state.errorKind ?? ""}`.trim(),
}));

let harness;

async function load(name) {
  vi.resetModules();
  const registry = await import("./map-registry.js");
  const bus = await import("../core/app-bus.js");
  const state = (await import("../core/state.js")).state;
  const overlay = await import("./map-overlay.js");
  const layer = await import(`./map-layer-${name}.js`);
  registry.MAPS.worldMap = { map: fakeGeoMap() };
  return { state, emit: bus.emit, ...overlay, ...layer };
}

const air = () => mocks.paintAir.mock.lastCall?.[0];
const humidity = () => mocks.paintHumidity.mock.lastCall?.[0];

beforeEach(() => {
  mocks.updateMap.mockReset().mockResolvedValue();
  mocks.fetchAirQuality.mockReset();
  mocks.paintAir.mockClear();
  mocks.paintHumidity.mockClear();
  mocks.offline = false;
});

afterEach(() => vi.unstubAllGlobals());

describe("Air Quality", () => {
  beforeEach(() => {
    harness = stubLayerDocument("airQuality");
  });

  it("shows loading first, then the reading for the selected place", async () => {
    const { state, setAirQualityLayer, getMapOverlayState } = await load("air-quality");
    state.loc = PARIS;
    mocks.fetchAirQuality.mockResolvedValue({ aqi: 46 });
    await setAirQualityLayer();
    expect(mocks.fetchAirQuality).toHaveBeenCalledWith(PARIS, expect.any(Object));
    expect(air()).toMatchObject({ status: "ready", data: { aqi: 46 }, errorKind: null });
    expect(getMapOverlayState().type).toBe("airQuality");
    expect(harness.button.attrs["aria-checked"]).toBe("true");
    expect(harness.region.textContent).toBe("air ready");
  });

  it("keeps the layer selected and explains a failed reading, never falling back to satellite", async () => {
    const { state, setAirQualityLayer, getMapOverlayState } = await load("air-quality");
    const { WeatherError } = await import("../weather/weather-errors.js");
    state.loc = PARIS;
    mocks.fetchAirQuality.mockRejectedValue(new WeatherError("timeout", "slow"));
    await setAirQualityLayer();
    expect(air()).toMatchObject({ status: "error", data: null, errorKind: "timeout" });
    expect(getMapOverlayState().type).toBe("airQuality");
  });

  it("reports an unclassified failure as a network one", async () => {
    const { state, setAirQualityLayer } = await load("air-quality");
    state.loc = PARIS;
    mocks.fetchAirQuality.mockRejectedValue(new Error("boom"));
    await setAirQualityLayer();
    expect(air().errorKind).toBe("network");
  });

  it("is unavailable when there is no place to read", async () => {
    const { state, setAirQualityLayer } = await load("air-quality");
    state.loc = null;
    await setAirQualityLayer();
    expect(air()).toMatchObject({ status: "error", errorKind: "unavailable" });
    expect(mocks.fetchAirQuality).not.toHaveBeenCalled();
  });

  it("drops the reading when another layer is chosen", async () => {
    const { state, setAirQualityLayer, resetOverlay } = await load("air-quality");
    state.loc = PARIS;
    mocks.fetchAirQuality.mockResolvedValue({ aqi: 46 });
    await setAirQualityLayer();
    resetOverlay("rain");
    expect(air()).toMatchObject({ status: "idle", data: null });
  });

  it("swaps to the new place's reading, and cancels the request for the old one", async () => {
    const { state, emit, bindAirQuality, setAirQualityLayer } = await load("air-quality");
    bindAirQuality();
    state.loc = PARIS;
    mocks.fetchAirQuality.mockResolvedValueOnce({ aqi: 46 });
    await setAirQualityLayer();
    let signalOfOld;
    mocks.fetchAirQuality.mockImplementationOnce((loc, { signal }) => {
      signalOfOld = signal;
      return new Promise(() => {});
    });
    emit("location:selecting", TARBES);
    expect(air()).toMatchObject({ status: "loading", data: null });
    mocks.fetchAirQuality.mockResolvedValueOnce({ aqi: 12 });
    emit("location:selecting", PARIS);
    expect(signalOfOld.aborted).toBe(true);
    await vi.waitFor(() => expect(air().status).toBe("ready"));
    expect(air().data).toEqual({ aqi: 12 });
  });

  it("does nothing on a new place while another layer is active", async () => {
    const { emit, bindAirQuality } = await load("air-quality");
    bindAirQuality();
    emit("location:selecting", TARBES);
    expect(mocks.fetchAirQuality).not.toHaveBeenCalled();
  });
});

describe("Humidity", () => {
  const forecast = (humidityValue) => ({ current: { humidity: humidityValue }, updatedAt: 1 });

  beforeEach(() => {
    harness = stubLayerDocument("humidity");
  });

  it("reads the forecast already fetched, without a request of its own", async () => {
    const { state, setHumidityLayer, getMapOverlayState } = await load("humidity");
    state.loc = PARIS;
    state.wx = forecast(38);
    state.isDemo = false;
    await setHumidityLayer();
    expect(humidity()).toMatchObject({ status: "ready", data: { humidity: 38 } });
    expect(getMapOverlayState().type).toBe("humidity");
    expect(harness.region.textContent).toBe("humidity ready");
  });

  it("reports demo data as a failure — never a made-up number as a reading", async () => {
    const { state, setHumidityLayer } = await load("humidity");
    state.loc = PARIS;
    state.wx = forecast(38);
    state.isDemo = true;
    await setHumidityLayer();
    expect(humidity()).toMatchObject({ status: "error", errorKind: "error" });
    mocks.offline = true;
    await setHumidityLayer();
    expect(humidity()).toMatchObject({ status: "error", errorKind: "offline" });
  });

  it("holds off while the forecast belongs to the place just left", async () => {
    const { state, emit, bindHumidity, setHumidityLayer } = await load("humidity");
    bindHumidity();
    const parisForecast = forecast(38);
    state.loc = PARIS;
    state.wx = parisForecast;
    state.isDemo = false;
    await setHumidityLayer();
    /* the place changes; state.wx still holds Paris's forecast */
    state.loc = TARBES;
    emit("location:selecting", TARBES);
    expect(humidity().status).toBe("loading");
    /* an unrelated repaint in that gap must not show Paris's number for Tarbes */
    const { renderWeatherOverlay } = await import("./map-overlay.js");
    renderWeatherOverlay();
    expect(humidity().status).toBe("loading");
    /* once Tarbes's own forecast lands, the reading returns */
    state.wx = forecast(71);
    renderWeatherOverlay();
    expect(humidity()).toMatchObject({ status: "ready", data: { humidity: 71 } });
  });

  it("drops the reading when another layer is chosen", async () => {
    const { state, setHumidityLayer, resetOverlay } = await load("humidity");
    state.loc = PARIS;
    state.wx = forecast(38);
    state.isDemo = false;
    await setHumidityLayer();
    resetOverlay("rain");
    expect(humidity()).toMatchObject({ status: "idle", data: null });
  });
});
