import { describe, it, expect, vi } from "vitest";

vi.mock("../core/i18n.js", () => ({ t: (key) => key }));

import { classifyHumidity } from "./humidity.js";

describe("classifyHumidity", () => {
  it("bands relative humidity the same way the metric card does", () => {
    expect(classifyHumidity(0)).toEqual({ label: "dry", cls: "is-warn" });
    expect(classifyHumidity(34)).toEqual({ label: "dry", cls: "is-warn" });
    expect(classifyHumidity(35)).toEqual({ label: "comfortable", cls: "is-good" });
    expect(classifyHumidity(70)).toEqual({ label: "comfortable", cls: "is-good" });
    expect(classifyHumidity(71)).toEqual({ label: "humid", cls: "is-warn" });
    expect(classifyHumidity(100)).toEqual({ label: "humid", cls: "is-warn" });
  });

  it("has no category for an unknown value", () => {
    expect(classifyHumidity(null)).toEqual({ label: "—", cls: "" });
    expect(classifyHumidity(undefined)).toEqual({ label: "—", cls: "" });
    expect(classifyHumidity(NaN)).toEqual({ label: "—", cls: "" });
  });
});
