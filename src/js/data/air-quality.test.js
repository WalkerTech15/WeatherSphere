import { describe, it, expect, vi } from "vitest";

vi.mock("../core/i18n.js", () => ({ t: (key) => key }));

import { classifyAqi } from "./air-quality.js";

describe("classifyAqi", () => {
  it("bands the European AQI the same way the forecast page does", () => {
    expect(classifyAqi(0)).toEqual({ label: "aqGood", cls: "is-good" });
    expect(classifyAqi(50)).toEqual({ label: "aqGood", cls: "is-good" });
    expect(classifyAqi(51)).toEqual({ label: "aqModerate", cls: "is-warn" });
    expect(classifyAqi(75)).toEqual({ label: "aqModerate", cls: "is-warn" });
    expect(classifyAqi(76)).toEqual({ label: "aqPoor", cls: "is-bad" });
    expect(classifyAqi(100)).toEqual({ label: "aqPoor", cls: "is-bad" });
    expect(classifyAqi(101)).toEqual({ label: "aqVeryPoor", cls: "is-bad" });
  });

  it("has no category for an unknown value", () => {
    expect(classifyAqi(null)).toEqual({ label: "—", cls: "" });
    expect(classifyAqi(undefined)).toEqual({ label: "—", cls: "" });
    expect(classifyAqi(NaN)).toEqual({ label: "—", cls: "" });
  });
});
