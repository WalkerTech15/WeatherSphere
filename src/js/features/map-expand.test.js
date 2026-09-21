/* Unit tests for the expanded-map state machine (features/map-expand.js).
 *
 * The layout itself is CSS and is measured in e2e/map-expand.spec.js; what is
 * pinned here is the logic around it that a browser test can only observe
 * indirectly: which exits restore the page's scroll position, which do not,
 * and that asking for the state the mode is already in is a true no-op. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./map.js", () => ({ resizeMaps: vi.fn() }));

/* Just enough of a document for the module: a body with a class list, and
   the two buttons it reads and writes. */
function fakeButton() {
  const attrs = {};
  return {
    hidden: false,
    focus: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: (k, v) => (attrs[k] = v),
    getAttribute: (k) => attrs[k],
  };
}

let buttons;
let bodyClasses;

beforeEach(() => {
  vi.resetModules();
  /* the mocked resizeMaps outlives resetModules, so its call count would
     otherwise accumulate across tests */
  vi.clearAllMocks();
  bodyClasses = new Set();
  buttons = { "#mapExpandBtn": fakeButton(), "#mapExitExpandBtn": fakeButton() };
  vi.stubGlobal("document", {
    body: {
      classList: {
        toggle: (name, on) => (on ? bodyClasses.add(name) : bodyClasses.delete(name)),
        contains: (name) => bodyClasses.has(name),
      },
    },
    querySelector: (sel) => buttons[sel] || null,
  });
  vi.stubGlobal("window", { scrollY: 0, scrollTo: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", (fn) => fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* The module keeps its state at module level, so every test imports a fresh
   copy. The bus has to come from the same fresh module graph: a bus imported
   once at the top of this file would be a different instance from the one
   the re-imported module subscribes to, and its events would never arrive. */
async function load() {
  const bus = await import("../core/app-bus.js");
  bus.clearBus();
  const mod = await import("./map-expand.js");
  mod.bindMapExpand();
  return { ...mod, emit: bus.emit };
}

describe("entering and leaving", () => {
  it("mirrors the state onto <body> and onto both controls", async () => {
    const { setMapExpanded, isMapExpanded } = await load();
    expect(setMapExpanded(true)).toBe(true);
    expect(isMapExpanded()).toBe(true);
    expect(bodyClasses.has("map-expanded")).toBe(true);
    expect(buttons["#mapExpandBtn"].getAttribute("aria-pressed")).toBe("true");
    expect(buttons["#mapExitExpandBtn"].hidden).toBe(false);

    setMapExpanded(false);
    expect(bodyClasses.has("map-expanded")).toBe(false);
    expect(buttons["#mapExpandBtn"].getAttribute("aria-pressed")).toBe("false");
    expect(buttons["#mapExitExpandBtn"].hidden).toBe(true);
  });

  it("asking for the state it is already in does nothing at all", async () => {
    const { setMapExpanded } = await load();
    expect(setMapExpanded(false)).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();

    setMapExpanded(true);
    window.scrollY = 999;
    /* a second "enter" must not overwrite the offset saved by the first */
    expect(setMapExpanded(true)).toBe(false);
    setMapExpanded(false);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("moves focus only on a real activation", async () => {
    const { setMapExpanded, toggleMapExpanded } = await load();
    setMapExpanded(true);
    expect(buttons["#mapExitExpandBtn"].focus).not.toHaveBeenCalled();
    setMapExpanded(false);

    toggleMapExpanded();
    expect(buttons["#mapExitExpandBtn"].focus).toHaveBeenCalledOnce();
    toggleMapExpanded();
    expect(buttons["#mapExpandBtn"].focus).toHaveBeenCalledOnce();
  });
});

describe("the page's scroll position", () => {
  it("is restored, instantly, when the mode is left in place", async () => {
    const { setMapExpanded, exitMapExpanded } = await load();
    window.scrollY = 140;
    setMapExpanded(true);
    /* hiding the page's other content lets the browser clamp the offset */
    window.scrollY = 0;

    exitMapExpanded();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 140);
  });

  it("is not restored when the mode ends because another view opened", async () => {
    const { setMapExpanded, isMapExpanded, emit } = await load();
    window.scrollY = 140;
    setMapExpanded(true);

    emit("view:changed", "forecast");
    expect(isMapExpanded()).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("is untouched by entering the mode", async () => {
    const { setMapExpanded } = await load();
    window.scrollY = 140;
    setMapExpanded(true);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe("the mode never outlives the Map view", () => {
  it("re-announcing the Map view keeps it", async () => {
    const { setMapExpanded, isMapExpanded, emit } = await load();
    setMapExpanded(true);
    emit("view:changed", "map");
    expect(isMapExpanded()).toBe(true);
  });

  it("asks the map to re-measure after every change", async () => {
    const { setMapExpanded } = await load();
    const { resizeMaps } = await import("./map.js");
    setMapExpanded(true);
    setMapExpanded(false);
    expect(resizeMaps).toHaveBeenCalledTimes(2);
  });
});
