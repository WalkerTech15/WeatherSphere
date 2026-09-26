/* Restoring a shared link, and a forecast hour clicked while it is still
 * loading. Writes to the URL are suppressed during a restore (the app must not
 * overwrite the link it is opening), so an hour chosen in that window used to
 * leave the address bar on the old hour. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  overlay: { type: "satellite", offset: 0 },
  onUrlChange: vi.fn(),
  writeUrlState: vi.fn(),
  setMapLayer: vi.fn(),
}));

vi.mock("../core/i18n.js", () => ({ t: (key) => key }));
vi.mock("../ui/notifications.js", () => ({ showToast: vi.fn() }));
vi.mock("../ui/navigation.js", () => ({ switchView: vi.fn() }));
vi.mock("../ui/render-map.js", () => ({
  isMapPanelOpen: () => true,
  showMapPanel: vi.fn(),
  hideMapPanel: vi.fn(),
}));
vi.mock("./map.js", () => ({
  getMapCamera: () => null,
  getMapOverlayState: () => ({ ...mocks.overlay }),
  setMapLayer: (...args) => mocks.setMapLayer(...args),
  jumpTo: vi.fn(),
}));
vi.mock("./map-click.js", () => ({ selectCoordinate: vi.fn() }));
vi.mock("./map-url.js", () => ({
  readUrlState: () => ({}),
  writeUrlState: (...args) => mocks.writeUrlState(...args),
  onUrlChange: (handler) => mocks.onUrlChange(handler),
  cancelPendingUrlState: vi.fn(),
  URL_REPLACE_DEBOUNCE_MS: 400,
}));

const url = (over = {}) => ({
  view: "map",
  sel: null,
  center: null,
  zoom: null,
  layer: "temperature",
  offset: 12,
  panel: null,
  ...over,
});

let restore;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.overlay.type = "satellite";
  mocks.overlay.offset = 0;
  const { initUrlSync } = await import("./map-url-sync.js");
  initUrlSync();
  restore = mocks.onUrlChange.mock.calls.at(-1)[0];
  mocks.writeUrlState.mockClear();
});

/* setMapLayer stands in for the real one: it lands the layer, and `during`
   lets a test change the hour while it is still "loading" */
function layerLands(during = () => {}) {
  mocks.setMapLayer.mockImplementation(async (type, { offset }) => {
    mocks.overlay.type = type;
    mocks.overlay.offset = offset;
    during();
  });
}

describe("restoring a link with a forecast hour", () => {
  it("does not rewrite the link it is opening", async () => {
    layerLands();
    await restore(url());
    expect(mocks.writeUrlState).not.toHaveBeenCalled();
  });

  it("writes an hour chosen while the layer was loading, in place", async () => {
    layerLands(() => {
      mocks.overlay.offset = 24; /* clicked +24 h before the layer landed */
    });
    await restore(url());
    expect(mocks.writeUrlState).toHaveBeenCalledTimes(1);
    const [snapshot, options] = mocks.writeUrlState.mock.calls[0];
    expect(snapshot).toMatchObject({ layer: "temperature", offset: 24 });
    expect(options).toMatchObject({ replace: true });
  });

  it("does the same for Humidity, which also has an hour", async () => {
    layerLands(() => {
      mocks.overlay.offset = 6;
    });
    await restore(url({ layer: "humidity", offset: 0 }));
    expect(mocks.writeUrlState).toHaveBeenCalledTimes(1);
  });

  it.each(["airQuality", "alerts", "lightning", "clouds"])(
    "never writes an hour for %s, which has none",
    async (layer) => {
      layerLands(() => {
        mocks.overlay.offset = 6;
      });
      await restore(url({ layer, offset: 0 }));
      expect(mocks.writeUrlState).not.toHaveBeenCalled();
    },
  );

  it("leaves the link alone when the layer the user chose is a different one", async () => {
    layerLands(() => {
      mocks.overlay.type = "wind"; /* the user moved on; that has its own write */
      mocks.overlay.offset = 3;
    });
    await restore(url());
    expect(mocks.writeUrlState).not.toHaveBeenCalled();
  });
});
