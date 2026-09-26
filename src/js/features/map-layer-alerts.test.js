/* The Alerts layer: the warning areas it draws, and how each outcome is
 * reported — a failure is never shown as "no alerts". */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeGeoMap, stubLayerDocument, PARIS, TARBES } from "./map-layer-harness.js";

const mocks = vi.hoisted(() => ({
  updateMap: vi.fn(async () => {}),
  fetchAlerts: vi.fn(),
  computeState: vi.fn(),
  paint: vi.fn(),
}));

vi.mock("./map-instance.js", () => ({ updateMap: mocks.updateMap }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/render-map-weather.js", () => ({
  renderWeatherOverlayUI: vi.fn(),
  updateTimeStatus: vi.fn(),
}));
vi.mock("../services/alert-provider.js", () => ({ fetchOfficialAlerts: mocks.fetchAlerts }));
vi.mock("./alerts-state.js", () => ({ computeAlertsState: mocks.computeState }));
vi.mock("../ui/render-map-alerts.js", () => ({
  renderAlertsUI: mocks.paint,
  alertsAnnouncement: (state) => `alerts ${state.status}`,
}));

let harness;

async function load() {
  vi.resetModules();
  const registry = await import("./map-registry.js");
  const bus = await import("../core/app-bus.js");
  const state = (await import("../core/state.js")).state;
  const overlay = await import("./map-overlay.js");
  const alerts = await import("./map-layer-alerts.js");
  const map = fakeGeoMap();
  registry.MAPS.worldMap = { map };
  return { map, state, emit: bus.emit, ...overlay, ...alerts };
}

const shown = () => mocks.paint.mock.lastCall?.[0];
const square = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
const alert = (over = {}) => ({ type: "flood", event: "Flood Warning", geometry: square, ...over });

beforeEach(() => {
  mocks.updateMap.mockReset().mockResolvedValue();
  mocks.fetchAlerts.mockReset().mockResolvedValue({ status: "ok", alerts: [], sources: [] });
  mocks.computeState.mockReset();
  mocks.paint.mockClear();
  harness = stubLayerDocument("alerts");
});

afterEach(() => vi.unstubAllGlobals());

describe("alertAreaData", () => {
  it("draws only the alerts that came with a real polygon", async () => {
    const { alertAreaData } = await load();
    const data = alertAreaData([alert(), alert({ geometry: null }), alert({ type: "tornado" })]);
    expect(data.features).toHaveLength(2);
    expect(data.features[0]).toEqual({
      type: "Feature",
      geometry: square,
      properties: { type: "flood", event: "Flood Warning" },
    });
  });

  it("is empty for no alerts at all", async () => {
    const { alertAreaData } = await load();
    expect(alertAreaData().features).toEqual([]);
    expect(alertAreaData([]).features).toEqual([]);
  });
});

describe("choosing the layer", () => {
  it("draws the issuer's own area under the labels and reports the alert", async () => {
    const { map, state, setAlertsLayer, getMapOverlayState } = await load();
    state.loc = PARIS;
    mocks.computeState.mockReturnValue({ status: "active", alerts: [alert()], errorKind: null });
    await setAlertsLayer();
    expect(mocks.fetchAlerts).toHaveBeenCalledWith(PARIS, expect.any(Object));
    expect(shown()).toMatchObject({ status: "active" });
    expect(map.layers).toEqual(["official-alert-fill", "official-alert-line"]);
    expect(getMapOverlayState().type).toBe("alerts");
    expect(harness.region.textContent).toBe("alerts active");
  });

  it("adds nothing to the map for an alert that has no polygon (the panel still says it in words)", async () => {
    const { map, state, setAlertsLayer } = await load();
    state.loc = PARIS;
    mocks.computeState.mockReturnValue({
      status: "active",
      alerts: [alert({ geometry: null })],
      errorKind: null,
    });
    await setAlertsLayer();
    expect(map.layers).toEqual([]);
    expect(shown().status).toBe("active");
  });

  it("keeps 'clear' and 'unsupported' apart from a failure", async () => {
    const { state, setAlertsLayer } = await load();
    state.loc = PARIS;
    for (const status of ["clear", "unsupported"]) {
      mocks.computeState.mockReturnValue({ status, alerts: [], errorKind: null });
      await setAlertsLayer();
      expect(shown().status).toBe(status);
    }
  });

  it("reports a failed request as an error, clearing what was drawn", async () => {
    const { map, state, setAlertsLayer } = await load();
    state.loc = PARIS;
    mocks.computeState.mockReturnValueOnce({
      status: "active",
      alerts: [alert()],
      errorKind: null,
    });
    await setAlertsLayer();
    mocks.fetchAlerts.mockRejectedValue(new Error("down"));
    await setAlertsLayer();
    expect(shown()).toMatchObject({ status: "error", errorKind: "network" });
    expect(map.getSource("official-alert-areas").data.features).toEqual([]);
  });

  it("has no place to ask about when nothing is selected", async () => {
    const { state, setAlertsLayer } = await load();
    state.loc = null;
    await setAlertsLayer();
    expect(shown().status).toBe("unsupported");
    expect(mocks.fetchAlerts).not.toHaveBeenCalled();
  });

  it("clears the drawn areas and the reading when another layer is chosen", async () => {
    const { map, state, setAlertsLayer, resetOverlay } = await load();
    state.loc = PARIS;
    mocks.computeState.mockReturnValue({ status: "active", alerts: [alert()], errorKind: null });
    await setAlertsLayer();
    resetOverlay("rain");
    expect(map.getSource("official-alert-areas").data.features).toEqual([]);
    expect(shown()).toMatchObject({ status: "idle", alerts: [] });
  });
});

describe("a new place while the layer is open", () => {
  it("clears the old warning at once, so it never lingers over the new place", async () => {
    const { map, state, emit, bindAlerts, setAlertsLayer } = await load();
    bindAlerts();
    state.loc = PARIS;
    mocks.computeState.mockReturnValue({ status: "active", alerts: [alert()], errorKind: null });
    await setAlertsLayer();
    mocks.fetchAlerts.mockImplementationOnce(() => new Promise(() => {}));
    emit("location:selecting", TARBES);
    expect(shown()).toMatchObject({ status: "loading", alerts: [] });
    expect(map.getSource("official-alert-areas").data.features).toEqual([]);
    expect(harness.region.textContent).toBe("alerts loading");
    expect(mocks.fetchAlerts).toHaveBeenLastCalledWith(TARBES, expect.any(Object));
  });

  it("does nothing while another layer is active", async () => {
    const { emit, bindAlerts } = await load();
    bindAlerts();
    emit("location:selecting", TARBES);
    expect(mocks.fetchAlerts).not.toHaveBeenCalled();
  });
});
