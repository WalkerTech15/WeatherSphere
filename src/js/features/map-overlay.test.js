/* What the map's overlay is showing, the registry the other layers plug into,
 * and the ramp weather layers (Temperature, Rain, Wind, Pressure, Satellite).
 * The map itself, the toast and the panel painter are stand-ins; what is
 * checked is the overlay's own bookkeeping. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMap: vi.fn(async () => {}),
  showToast: vi.fn(),
  paintPanel: vi.fn(),
  applyWeatherLayer: vi.fn(),
  setWeatherLayerTime: vi.fn(),
  removeWeatherLayer: vi.fn(),
}));

vi.mock("./map-instance.js", () => ({ updateMap: mocks.updateMap }));
vi.mock("../ui/notifications.js", () => ({ showToast: mocks.showToast }));
vi.mock("../ui/render-map-weather.js", () => ({
  renderWeatherOverlayUI: mocks.paintPanel,
  updateTimeStatus: vi.fn(),
}));
vi.mock("./weather-layers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  applyWeatherLayer: mocks.applyWeatherLayer,
  setWeatherLayerTime: mocks.setWeatherLayerTime,
  removeWeatherLayer: mocks.removeWeatherLayer,
}));

/* a layer button, with just the DOM surface the overlay touches */
function fakeButton(name, { disabled = false } = {}) {
  const classes = new Set();
  return {
    dataset: { mapLayer: name },
    disabled,
    tabIndex: 0,
    attrs: {},
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
  };
}

let buttons;
let region;

async function load() {
  vi.resetModules();
  const registry = await import("./map-registry.js");
  const overlay = await import("./map-overlay.js");
  return { MAPS: registry.MAPS, ...overlay };
}

const report = (over = {}) => ({
  colorRamp: [],
  time: { timeMs: 1000, available: true, clamped: false },
  sourceReady: true,
  layer: { getAnimationStart: () => 0, getAnimationEnd: () => 3600 * 12 },
  ...over,
});

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockClear());
  mocks.updateMap.mockImplementation(async () => {});
  buttons = ["satellite", "temperature", "rain", "wind"].map((name) => fakeButton(name));
  buttons.push(fakeButton("clouds", { disabled: true }));
  region = { textContent: "" };
  vi.stubGlobal("document", {
    querySelector: (selector) => {
      if (selector === "#mapLayerStatus") return region;
      const name = /data-map-layer="(\w+)"/.exec(selector)?.[1];
      return buttons.find((button) => button.dataset.mapLayer === name) || null;
    },
    querySelectorAll: (selector) => (selector === ".map-layer" ? buttons : []),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("the overlay description", () => {
  it("starts on the plain satellite basemap", async () => {
    const { getMapOverlayState } = await load();
    expect(getMapOverlayState()).toEqual({ type: "satellite", offset: 0, status: "idle" });
  });

  it("is the one thing the legend, the timeline and the URL all read", async () => {
    const { overlay, getMapOverlayState } = await load();
    overlay.type = "rain";
    overlay.offset = 3;
    overlay.status = "ready";
    expect(getMapOverlayState()).toEqual({ type: "rain", offset: 3, status: "ready" });
  });
});

describe("setLayerButtonState", () => {
  it("checks one layer, clears every spinner, and keeps a single Tab stop", async () => {
    const { setLayerButtonState } = await load();
    buttons[2].classes.add("is-loading");
    setLayerButtonState("rain");
    const rain = buttons[2];
    expect(rain.attrs["aria-checked"]).toBe("true");
    expect(rain.classes.has("is-active")).toBe(true);
    expect(rain.classes.has("is-loading")).toBe(false);
    expect(rain.tabIndex).toBe(0);
    for (const other of [buttons[0], buttons[1], buttons[3]]) {
      expect(other.attrs["aria-checked"]).toBe("false");
      expect(other.tabIndex).toBe(-1);
    }
  });

  it("never gives a disabled layer a Tab stop", async () => {
    const { setLayerButtonState } = await load();
    buttons[4].tabIndex = 7;
    setLayerButtonState("rain");
    expect(buttons[4].tabIndex).toBe(7);
  });
});

describe("startLayerRequest", () => {
  it("makes every earlier request stale, and only the newest current", async () => {
    const { startLayerRequest } = await load();
    const first = startLayerRequest();
    expect(first()).toBe(false);
    const second = startLayerRequest();
    expect(first()).toBe(true);
    expect(second()).toBe(false);
  });
});

describe("the registry the other layers plug into", () => {
  function hooks(name, log) {
    return {
      render: () => log.push(`render ${name}`),
      announcement: () => `${name} says hi`,
      reset: () => log.push(`reset ${name}`),
    };
  }

  it("paints the panel, then only the active layer's own part, and announces it", async () => {
    const { registerOverlayLayer, resetOverlay, renderWeatherOverlay } = await load();
    const log = [];
    registerOverlayLayer("lightning", hooks("lightning", log));
    registerOverlayLayer("alerts", hooks("alerts", log));
    resetOverlay("lightning");
    log.length = 0;
    renderWeatherOverlay();
    expect(mocks.paintPanel).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["render lightning"]);
    expect(region.textContent).toBe("lightning says hi");
  });

  it("announces nothing for a layer that is not a reading", async () => {
    const { registerOverlayLayer, resetOverlay, renderWeatherOverlay } = await load();
    registerOverlayLayer("alerts", hooks("alerts", []));
    resetOverlay("alerts");
    renderWeatherOverlay();
    expect(region.textContent).toBe("alerts says hi");
    resetOverlay("rain");
    renderWeatherOverlay();
    expect(region.textContent).toBe(""); /* so coming back announces afresh */
  });

  it("writes the live region only when its sentence changes", async () => {
    const { registerOverlayLayer, resetOverlay, renderWeatherOverlay } = await load();
    registerOverlayLayer("alerts", hooks("alerts", []));
    resetOverlay("alerts");
    renderWeatherOverlay();
    region.textContent = "changed by someone else";
    renderWeatherOverlay(); /* same sentence: not written again */
    expect(region.textContent).toBe("changed by someone else");
  });

  it("resets every OTHER layer when one is chosen, never the chosen one", async () => {
    const { registerOverlayLayer, resetOverlay } = await load();
    const log = [];
    registerOverlayLayer("lightning", hooks("lightning", log));
    registerOverlayLayer("alerts", hooks("alerts", log));
    registerOverlayLayer("clouds", hooks("clouds", log));
    resetOverlay("alerts");
    expect(log.sort()).toEqual(["reset clouds", "reset lightning"]);
  });

  it("resets every layer on the way back to satellite, and rewinds the clock", async () => {
    const { registerOverlayLayer, resetOverlay, overlay } = await load();
    const log = [];
    registerOverlayLayer("lightning", hooks("lightning", log));
    registerOverlayLayer("alerts", hooks("alerts", log));
    overlay.offset = 6;
    overlay.status = "ready";
    resetOverlay("satellite");
    expect(log.sort()).toEqual(["reset alerts", "reset lightning"]);
    expect(overlay).toMatchObject({ type: "satellite", offset: 0, status: "idle" });
  });

  it("keeps a ramp layer's own clock when choosing another ramp layer", async () => {
    const { resetOverlay, overlay } = await load();
    overlay.offset = 6;
    resetOverlay("wind");
    expect(overlay.type).toBe("wind");
    expect(overlay.offset).toBe(6);
    expect(overlay.colorRamp).toBeNull();
  });
});

describe("setRampLayer", () => {
  it("returning to satellite leaves the plain basemap, idle at now", async () => {
    const { MAPS, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    await setRampLayer("satellite");
    expect(getMapOverlayState()).toEqual({ type: "satellite", offset: 0, status: "idle" });
    expect(buttons[0].attrs["aria-checked"]).toBe("true");
  });

  it("treats a layer it does not know as satellite", async () => {
    const { MAPS, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    mocks.applyWeatherLayer.mockResolvedValue(report());
    await setRampLayer("sunshine");
    expect(getMapOverlayState().type).toBe("satellite");
    /* the same call that returns to the basemap: it removes any ramp layer */
    expect(mocks.applyWeatherLayer).toHaveBeenCalledWith(
      MAPS.worldMap,
      "satellite",
      expect.any(Object),
    );
  });

  it("loads a ramp layer, absorbs its report and becomes ready", async () => {
    const { MAPS, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {}, weatherLayer: null };
    mocks.applyWeatherLayer.mockResolvedValue(report());
    await setRampLayer("rain", { offset: 3 });
    expect(mocks.applyWeatherLayer).toHaveBeenCalledWith(
      MAPS.worldMap,
      "rain",
      expect.objectContaining({ offsetHours: 3 }),
    );
    expect(getMapOverlayState()).toEqual({ type: "rain", offset: 3, status: "ready" });
    expect(buttons[2].attrs["aria-checked"]).toBe("true");
  });

  it("reports a source that never became ready as unavailable, not as ready", async () => {
    const { MAPS, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    mocks.applyWeatherLayer.mockResolvedValue(report({ sourceReady: false }));
    await setRampLayer("wind");
    expect(getMapOverlayState().status).toBe("unavailable");
  });

  it("falls back to satellite with a toast when the layer fails to load", async () => {
    const { MAPS, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    mocks.applyWeatherLayer.mockRejectedValue(new Error("no tiles"));
    await setRampLayer("temperature");
    expect(getMapOverlayState()).toEqual({ type: "satellite", offset: 0, status: "idle" });
    expect(mocks.removeWeatherLayer).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(buttons[0].attrs["aria-checked"]).toBe("true");
  });

  it("falls back the same way when the map does not exist", async () => {
    const { setRampLayer, getMapOverlayState } = await load();
    await setRampLayer("rain");
    expect(getMapOverlayState().type).toBe("satellite");
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it("lets only the layer asked for last finish", async () => {
    const { MAPS, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    let releaseSlow;
    mocks.applyWeatherLayer
      .mockImplementationOnce(() => new Promise((resolve) => (releaseSlow = resolve)))
      .mockResolvedValueOnce(report());
    const slow = setRampLayer("temperature");
    await vi.waitFor(() => expect(mocks.applyWeatherLayer).toHaveBeenCalledTimes(1));
    await setRampLayer("wind");
    releaseSlow(report({ time: { timeMs: 5, available: true } }));
    await slow;
    expect(getMapOverlayState().type).toBe("wind");
    expect(buttons[3].attrs["aria-checked"]).toBe("true");
    expect(buttons[1].attrs["aria-checked"]).not.toBe("true");
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(buttons[1].classes.has("is-loading")).toBe(false); /* a stale spinner is cleared */
  });
});

describe("setMapTime", () => {
  it("has nothing to re-time on the plain basemap", async () => {
    const { setMapTime, getMapOverlayState } = await load();
    await setMapTime(6);
    expect(mocks.setWeatherLayerTime).not.toHaveBeenCalled();
    expect(getMapOverlayState().offset).toBe(0);
  });

  it("moves the active layer's clock and reports the frame it reached", async () => {
    const { MAPS, overlay, setMapTime, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    overlay.type = "rain";
    mocks.setWeatherLayerTime.mockResolvedValue(report());
    await setMapTime(6);
    expect(mocks.setWeatherLayerTime).toHaveBeenCalledWith(MAPS.worldMap, 6, expect.any(Object));
    expect(getMapOverlayState()).toEqual({ type: "rain", offset: 6, status: "ready" });
  });

  it("says so when no frame can be shown, and when the request fails", async () => {
    const { MAPS, overlay, setMapTime, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    overlay.type = "rain";
    mocks.setWeatherLayerTime.mockResolvedValueOnce(null);
    await setMapTime(3);
    expect(getMapOverlayState().status).toBe("unavailable");
    mocks.setWeatherLayerTime.mockRejectedValueOnce(new Error("boom"));
    await setMapTime(3);
    expect(getMapOverlayState().status).toBe("error");
  });

  it("does not re-apply itself to a layer chosen after it", async () => {
    const { MAPS, overlay, setMapTime, setRampLayer, getMapOverlayState } = await load();
    MAPS.worldMap = { map: {} };
    overlay.type = "rain";
    let releaseTime;
    mocks.setWeatherLayerTime.mockImplementationOnce(
      () => new Promise((resolve) => (releaseTime = resolve)),
    );
    mocks.applyWeatherLayer.mockResolvedValue(report());
    const late = setMapTime(6);
    await vi.waitFor(() => expect(mocks.setWeatherLayerTime).toHaveBeenCalled());
    await setRampLayer("wind");
    releaseTime(report({ time: { timeMs: 9, available: true } }));
    await late;
    expect(getMapOverlayState()).toEqual({ type: "wind", offset: 6, status: "ready" });
  });
});
