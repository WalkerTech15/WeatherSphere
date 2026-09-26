/* The Lightning layer: the strikes it draws, and how each outcome is reported. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeGeoMap, stubLayerDocument, PARIS, TARBES } from "./map-layer-harness.js";

const mocks = vi.hoisted(() => ({
  updateMap: vi.fn(async () => {}),
  fetchLightning: vi.fn(),
  paint: vi.fn(),
}));

vi.mock("./map-instance.js", () => ({ updateMap: mocks.updateMap }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-map-weather.js", () => ({
  renderWeatherOverlayUI: vi.fn(),
  updateTimeStatus: vi.fn(),
}));
vi.mock("../services/xweather-lightning.js", () => ({
  fetchXweatherLightning: mocks.fetchLightning,
}));
vi.mock("../ui/render-map-lightning.js", () => ({
  renderLightningUI: mocks.paint,
  lightningAnnouncement: (state) => `lightning ${state.status} ${state.errorKind ?? ""}`.trim(),
}));

let harness;

async function load() {
  vi.resetModules();
  const registry = await import("./map-registry.js");
  const bus = await import("../core/app-bus.js");
  const state = (await import("../core/state.js")).state;
  const overlay = await import("./map-overlay.js");
  const lightning = await import("./map-layer-lightning.js");
  const map = fakeGeoMap();
  registry.MAPS.worldMap = { map };
  return { map, state, emit: bus.emit, ...overlay, ...lightning };
}

const shown = () => mocks.paint.mock.lastCall?.[0];
const strike = (over = {}) => ({ lat: 48.86, lon: 2.36, type: "cg", amperage: -12000, ...over });

beforeEach(() => {
  mocks.updateMap.mockReset().mockResolvedValue();
  mocks.fetchLightning.mockReset();
  mocks.paint.mockClear();
  harness = stubLayerDocument("lightning");
});

afterEach(() => vi.unstubAllGlobals());

describe("lightningPointData", () => {
  it("makes one point per strike, in [lon, lat] order", async () => {
    const { lightningPointData } = await load();
    const data = lightningPointData([strike({ lat: 10, lon: 20 })]);
    expect(data.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [20, 10] },
        properties: { type: "cg" },
      },
    ]);
  });

  it("skips a strike without a usable position, and names an untyped one 'strike'", async () => {
    const { lightningPointData } = await load();
    const data = lightningPointData([
      strike({ lat: null }),
      strike({ lon: NaN }),
      strike({ type: "" }),
    ]);
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.type).toBe("strike");
  });

  it("is empty for no strikes at all", async () => {
    const { lightningPointData } = await load();
    expect(lightningPointData().features).toEqual([]);
    expect(lightningPointData([]).features).toEqual([]);
  });
});

describe("choosing the layer", () => {
  it("draws the strikes near the selected place, and reports them", async () => {
    const { map, state, setLightningLayer, getMapOverlayState } = await load();
    state.loc = PARIS;
    mocks.fetchLightning.mockResolvedValue({ strikes: [strike(), strike()] });
    await setLightningLayer();
    expect(mocks.fetchLightning).toHaveBeenCalledWith(PARIS, expect.any(Object));
    expect(shown().status).toBe("ready");
    expect(map.getSource("xweather-lightning-strikes").data.features).toHaveLength(2);
    expect(getMapOverlayState().type).toBe("lightning");
    expect(harness.button.attrs["aria-checked"]).toBe("true");
    expect(harness.region.textContent).toBe("lightning ready");
  });

  it("says 'empty', not 'error', when Xweather answered with no strikes", async () => {
    const { map, state, setLightningLayer } = await load();
    state.loc = PARIS;
    mocks.fetchLightning.mockResolvedValue({ strikes: [] });
    await setLightningLayer();
    expect(shown().status).toBe("empty");
    expect(map.layers).toEqual([]); /* nothing to draw, so nothing is added */
  });

  it.each(["rate_limited", "timeout", "unavailable"])(
    "reports a %s failure as itself, drawing nothing",
    async (kind) => {
      const { state, setLightningLayer, map } = await load();
      const { WeatherError } = await import("../weather/weather-errors.js");
      state.loc = PARIS;
      mocks.fetchLightning.mockRejectedValue(new WeatherError(kind, "x"));
      await setLightningLayer();
      expect(shown()).toMatchObject({ status: "error", errorKind: kind });
      expect(map.getSource("xweather-lightning-strikes")?.data.features ?? []).toEqual([]);
    },
  );

  it("reports any other failure as a network one", async () => {
    const { state, setLightningLayer } = await load();
    state.loc = PARIS;
    mocks.fetchLightning.mockRejectedValue(new Error("boom"));
    await setLightningLayer();
    expect(shown()).toMatchObject({ status: "error", errorKind: "network" });
  });

  it("has no place to look near when nothing is selected", async () => {
    const { state, setLightningLayer } = await load();
    state.loc = null;
    await setLightningLayer();
    expect(shown().status).toBe("unsupported");
    expect(mocks.fetchLightning).not.toHaveBeenCalled();
  });

  it("drops the previous layer's strikes' worth of state when another layer is chosen", async () => {
    const { map, state, setLightningLayer, resetOverlay } = await load();
    state.loc = PARIS;
    mocks.fetchLightning.mockResolvedValue({ strikes: [strike()] });
    await setLightningLayer();
    resetOverlay("rain");
    expect(map.getSource("xweather-lightning-strikes").data.features).toEqual([]);
    expect(shown().status).toBe("idle");
  });
});

describe("a new place while the layer is open", () => {
  it("shows loading at once, clears the old strikes, then the new place's own", async () => {
    const { map, state, emit, bindLightning, setLightningLayer } = await load();
    bindLightning();
    state.loc = PARIS;
    mocks.fetchLightning.mockResolvedValueOnce({ strikes: [strike()] });
    await setLightningLayer();
    let release;
    mocks.fetchLightning.mockImplementationOnce(() => new Promise((r) => (release = r)));
    emit("location:selecting", TARBES);
    expect(shown().status).toBe("loading");
    expect(map.getSource("xweather-lightning-strikes").data.features).toEqual([]);
    release({ strikes: [strike({ lat: 43.2 }), strike({ lat: 43.3 })] });
    await vi.waitFor(() => expect(shown().status).toBe("ready"));
    expect(map.getSource("xweather-lightning-strikes").data.features).toHaveLength(2);
    expect(mocks.fetchLightning).toHaveBeenLastCalledWith(TARBES, expect.any(Object));
  });

  it("lets a late answer for the place just left be ignored", async () => {
    const { state, emit, bindLightning, setLightningLayer } = await load();
    bindLightning();
    state.loc = PARIS;
    mocks.fetchLightning.mockResolvedValueOnce({ strikes: [] });
    await setLightningLayer();
    let releaseOld;
    let releaseNew;
    mocks.fetchLightning
      .mockImplementationOnce(() => new Promise((r) => (releaseOld = r)))
      .mockImplementationOnce(() => new Promise((r) => (releaseNew = r)));
    emit("location:selecting", TARBES);
    emit("location:selecting", PARIS);
    releaseNew({ strikes: [strike(), strike(), strike()] });
    await vi.waitFor(() => expect(shown().status).toBe("ready"));
    releaseOld({ strikes: [] });
    await Promise.resolve();
    expect(shown().data.strikes).toHaveLength(3);
  });

  it("does nothing while another layer is active", async () => {
    const { emit, bindLightning } = await load();
    bindLightning();
    emit("location:selecting", TARBES);
    expect(mocks.fetchLightning).not.toHaveBeenCalled();
  });
});
