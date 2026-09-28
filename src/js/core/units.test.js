import { describe, it, expect, afterEach } from "vitest";
import { state } from "./state.js";
import {
  toF,
  toMph,
  compassIndex,
  compassAbbr,
  toMiles,
  fmtDistance,
  distanceUnit,
  toInHg,
  convPressure,
  fmtPressure,
  pressureUnit,
  toInPerHour,
  convPrecip,
  precipUnit,
  convVisibility,
  fmtVisibility,
  visibilityUnit,
} from "./units.js";

describe("toF", () => {
  it("converts 0°C to 32°F", () => {
    expect(toF(0)).toBe(32);
  });
  it("converts 100°C to 212°F", () => {
    expect(toF(100)).toBe(212);
  });
  it("converts a negative temperature", () => {
    expect(toF(-40)).toBe(-40);
  });
});

describe("toMph", () => {
  it("converts km/h to mph", () => {
    expect(toMph(1.609)).toBeCloseTo(1, 5);
  });
  it("converts 0 km/h to 0 mph", () => {
    expect(toMph(0)).toBe(0);
  });
});

describe("compass", () => {
  it("maps 0deg to N", () => {
    expect(compassAbbr(0)).toBe("N");
  });
  it("maps 90deg to E", () => {
    expect(compassAbbr(90)).toBe("E");
  });
  it("maps 180deg to S", () => {
    expect(compassAbbr(180)).toBe("S");
  });
  it("maps 270deg to W", () => {
    expect(compassAbbr(270)).toBe("W");
  });
  it("wraps past 360deg", () => {
    expect(compassAbbr(360)).toBe("N");
    expect(compassAbbr(361)).toBe("N");
  });
  it("rounds to the nearest of the 8 compass points", () => {
    expect(compassAbbr(40)).toBe("NE"); // 40 rounds toward 45 (NE), not 0 (N)
    expect(compassAbbr(20)).toBe("N"); // 20 rounds toward 0 (N)
  });
  it("compassIndex stays within 0-7", () => {
    for (let deg = 0; deg <= 720; deg += 13) {
      const i = compassIndex(deg);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(7);
    }
  });
});

describe("distance (nearby places)", () => {
  const originalUnitTemp = state.unitTemp;
  afterEach(() => {
    state.unitTemp = originalUnitTemp;
  });

  it("toMiles converts km to miles", () => {
    expect(toMiles(1.60934)).toBeCloseTo(1, 5);
    expect(toMiles(0)).toBe(0);
  });

  it("follows the temperature unit — metric shows km, imperial shows mi", () => {
    state.unitTemp = "c";
    expect(distanceUnit()).toBe("km");
    state.unitTemp = "f";
    expect(distanceUnit()).toBe("mi");
  });

  it("fmtDistance keeps one decimal under 10 units, rounds to a whole number at/above 10", () => {
    state.unitTemp = "c";
    expect(fmtDistance(4.26)).toBe(4.3);
    expect(fmtDistance(9.96)).toBe(10);
    expect(fmtDistance(23.4)).toBe(23);
  });

  it("fmtDistance converts to miles under an imperial setting", () => {
    state.unitTemp = "f";
    expect(fmtDistance(16.0934)).toBe(10); // 10 mi, whole-number branch
  });
});

describe("pressure — its own setting, independent of temperature and wind", () => {
  const original = state.unitPressure;
  afterEach(() => {
    state.unitPressure = original;
  });

  it("toInHg converts standard atmospheric pressure to the textbook 29.92 inHg", () => {
    expect(Number(toInHg(1013.25).toFixed(2))).toBe(29.92);
  });

  it("toInHg converts 0 hPa to 0 inHg", () => {
    expect(toInHg(0)).toBe(0);
  });

  it("pressureUnit reflects the setting, defaulting to hPa", () => {
    state.unitPressure = "hpa";
    expect(pressureUnit()).toBe("hPa");
    state.unitPressure = "inhg";
    expect(pressureUnit()).toBe("inHg");
  });

  it("convPressure passes hPa through unchanged, converts only under inHg", () => {
    state.unitPressure = "hpa";
    expect(convPressure(1013.25)).toBe(1013.25);
    state.unitPressure = "inhg";
    expect(convPressure(1013.25)).toBeCloseTo(29.92, 2);
  });

  it("fmtPressure rounds hPa to a whole number, and inHg to two decimals", () => {
    state.unitPressure = "hpa";
    expect(fmtPressure(1013.6)).toBe("1014");
    state.unitPressure = "inhg";
    expect(fmtPressure(1013.25)).toBe("29.92");
    expect(fmtPressure(900)).toBe("26.58");
  });

  it("changing wind or temperature units never changes the pressure unit", () => {
    state.unitPressure = "hpa";
    state.unitTemp = "f";
    state.unitWind = "mph";
    expect(pressureUnit()).toBe("hPa");
    state.unitTemp = "c";
    state.unitWind = "kmh";
  });
});

describe("precipitation intensity — its own setting, independent of temperature", () => {
  const original = state.unitPrecip;
  afterEach(() => {
    state.unitPrecip = original;
  });

  it("toInPerHour converts mm/h to in/h using the standard 25.4mm-per-inch factor", () => {
    expect(toInPerHour(25.4)).toBe(1);
    expect(toInPerHour(0)).toBe(0);
  });

  it("precipUnit and convPrecip follow unitPrecip, not unitTemp", () => {
    state.unitPrecip = "mm";
    state.unitTemp = "f"; // deliberately mismatched — must have no effect
    expect(precipUnit()).toBe("mm/h");
    expect(convPrecip(10)).toBe(10);

    state.unitPrecip = "in";
    state.unitTemp = "c"; // deliberately mismatched the other way
    expect(precipUnit()).toBe("in/h");
    expect(convPrecip(25.4)).toBe(1);
    state.unitTemp = "c";
  });
});

describe("visibility — its own setting, independent of temperature", () => {
  const original = state.unitVisibility;
  afterEach(() => {
    state.unitVisibility = original;
  });

  it("visibilityUnit and convVisibility follow unitVisibility, not unitTemp", () => {
    state.unitVisibility = "km";
    state.unitTemp = "f"; // deliberately mismatched — must have no effect
    expect(visibilityUnit()).toBe("km");
    expect(convVisibility(10)).toBe(10);

    state.unitVisibility = "mi";
    state.unitTemp = "c";
    expect(visibilityUnit()).toBe("mi");
    expect(convVisibility(1.60934)).toBeCloseTo(1, 5);
    state.unitTemp = "c";
  });

  it("fmtVisibility keeps one decimal under 10 units, rounds at/above 10 — same shape as fmtDistance", () => {
    state.unitVisibility = "km";
    expect(fmtVisibility(4.26)).toBe(4.3);
    expect(fmtVisibility(23.4)).toBe(23);

    state.unitVisibility = "mi";
    expect(fmtVisibility(16.0934)).toBe(10); // 10 mi, whole-number branch
  });
});
