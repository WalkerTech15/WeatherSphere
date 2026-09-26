/* The layer switcher: a radio group with one Tab stop, arrow-key movement that
 * skips disabled layers, and edge fades on the scrolling rows. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const chosen = vi.hoisted(() => []);
vi.mock("./map-layers.js", () => ({ setMapLayer: (type) => chosen.push(type) }));

import { bindMapLayerControls, updateMapLayerFades } from "./map-layer-controls.js";

function fakeButton(name, { disabled = false, checked = false } = {}) {
  const listeners = {};
  return {
    dataset: { mapLayer: name },
    disabled,
    tabIndex: 0,
    attrs: { "aria-checked": String(checked) },
    getAttribute(key) {
      return this.attrs[key];
    },
    addEventListener: (event, handler) => (listeners[event] = handler),
    click: () => listeners.click(),
    focus() {
      document.activeElement = this;
    },
  };
}

function fakeRow(scroll) {
  const left = { on: false };
  const right = { on: false };
  return {
    ...scroll,
    left,
    right,
    addEventListener: vi.fn(),
    querySelector: (selector) => {
      const target = selector.includes("left") ? left : right;
      return { classList: { toggle: (_c, on) => (target.on = on) } };
    },
  };
}

let buttons;
let rows;
let switcher;

function press(key) {
  const event = {
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  switcher.keydown(event);
  return event;
}

beforeEach(() => {
  chosen.length = 0;
  buttons = [
    fakeButton("satellite", { checked: true }),
    fakeButton("temperature"),
    fakeButton("rain"),
    fakeButton("clouds", { disabled: true }),
    fakeButton("wind"),
  ];
  rows = [fakeRow({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 })];
  switcher = { keydown: null, addEventListener: (event, handler) => (switcher[event] = handler) };
  vi.stubGlobal("document", {
    activeElement: null,
    querySelector: (selector) => (selector === ".map-layer-switcher" ? switcher : null),
    querySelectorAll: (selector) => {
      if (selector === ".map-layer") return buttons;
      if (selector === ".map-layer-row") return rows;
      return [];
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("bindMapLayerControls", () => {
  it("chooses a layer when its button is clicked", () => {
    bindMapLayerControls();
    buttons[2].click();
    expect(chosen).toEqual(["rain"]);
  });

  it("gives the checked layer the group's only Tab stop, and leaves a disabled one out", () => {
    buttons[3].tabIndex = 5;
    bindMapLayerControls();
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[0]]);
    expect(buttons[1].tabIndex).toBe(-1);
    expect(buttons[3].tabIndex).toBe(5);
  });

  it("falls back to the first usable layer when none is checked", () => {
    buttons[0].attrs["aria-checked"] = "false";
    bindMapLayerControls();
    expect(buttons[0].tabIndex).toBe(0);
  });

  it("moves to the next layer with ArrowRight or ArrowDown, and chooses it", () => {
    bindMapLayerControls();
    buttons[0].focus();
    const event = press("ArrowRight");
    expect(event.prevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    expect(chosen).toEqual(["temperature"]);
    expect(buttons[1].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);
    press("ArrowDown");
    expect(chosen).toEqual(["temperature", "rain"]);
  });

  it("skips a disabled layer", () => {
    bindMapLayerControls();
    buttons[2].focus();
    press("ArrowRight");
    expect(chosen).toEqual(["wind"]);
    press("ArrowLeft");
    expect(chosen).toEqual(["wind", "rain"]);
  });

  it("wraps at both ends, and Home and End jump to them", () => {
    bindMapLayerControls();
    buttons[4].focus();
    press("ArrowRight");
    expect(chosen.at(-1)).toBe("satellite");
    press("ArrowUp");
    expect(chosen.at(-1)).toBe("wind");
    press("Home");
    expect(chosen.at(-1)).toBe("satellite");
    press("End");
    expect(chosen.at(-1)).toBe("wind");
  });

  it("leaves every other key, and focus outside the group, alone", () => {
    bindMapLayerControls();
    buttons[0].focus();
    expect(press("a").prevented).toBe(false);
    expect(press("Tab").prevented).toBe(false);
    document.activeElement = { other: true };
    expect(press("ArrowRight").prevented).toBe(false);
    expect(chosen).toEqual([]);
  });

  it("refreshes the edge fades whenever a row scrolls", () => {
    bindMapLayerControls();
    expect(rows[0].addEventListener).toHaveBeenCalledWith("scroll", updateMapLayerFades, {
      passive: true,
    });
  });
});

describe("updateMapLayerFades", () => {
  it("shows the right fade while there is more to the right, and neither when nothing overflows", () => {
    updateMapLayerFades();
    expect(rows[0].right.on).toBe(true);
    expect(rows[0].left.on).toBe(false);
    rows[0].scrollWidth = 300;
    updateMapLayerFades();
    expect(rows[0].right.on).toBe(false);
  });

  it("shows the left fade once scrolled away from the start", () => {
    rows[0].scrollLeft = 120;
    updateMapLayerFades();
    expect(rows[0].left.on).toBe(true);
  });
});
