/* The forecast-time control. The single most important fact encoded here is
 * that MapTiler weather layers speak UNIX SECONDS, not milliseconds — the
 * fake layer below asserts on exactly what setAnimationTime() receives. */
import { describe, it, expect, vi } from "vitest";
import {
  TIME_OFFSETS,
  normalizeOffset,
  isSupportedOffset,
  layerTimeRange,
  applyLayerTime,
  availableOffsets,
  offsetTargetMs,
  hourlyIndexForOffset,
  hourlyEntryAtOffset,
  availableHourlyOffsets,
} from "./map-timeline.js";

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

/* Minimal stand-in for a TimeFrameAnimation-derived weather layer. `startMs`
   and `endMs` are given in ms for readability and exposed in seconds, exactly
   as the SDK does. */
function fakeLayer({ startMs = NOW - 3 * HOUR, endMs = NOW + 9 * HOUR, frames = true } = {}) {
  return {
    setAnimationTime: vi.fn(),
    getAnimationStart: () => (frames ? startMs / 1000 : Number.POSITIVE_INFINITY),
    getAnimationEnd: () => (frames ? endMs / 1000 : Number.NEGATIVE_INFINITY),
  };
}

describe("offsets", () => {
  it("offers exactly now, +3 h, +6 h, +12 h and +24 h", () => {
    expect(TIME_OFFSETS).toEqual([0, 3, 6, 12, 24]);
  });

  it.each([12, 24])("accepts +%i h", (hours) => {
    expect(isSupportedOffset(hours)).toBe(true);
    expect(normalizeOffset(hours)).toBe(hours);
  });

  it.each([1, 9, 18, 48])("does not offer %i h", (hours) => {
    expect(isSupportedOffset(hours)).toBe(false);
  });

  it.each([99, -3, 1.5, "abc", null, undefined])("resolves the unsupported %o to now", (value) => {
    expect(isSupportedOffset(value)).toBe(false);
    expect(normalizeOffset(value)).toBe(0);
  });

  it("accepts a numeric string, as a URL parameter would supply", () => {
    expect(normalizeOffset("3")).toBe(3);
  });
});

describe("offsetTargetMs", () => {
  it.each(TIME_OFFSETS)("is now + %i h", (hours) => {
    expect(offsetTargetMs(hours, NOW)).toBe(NOW + hours * HOUR);
  });

  it("resolves an unsupported offset to now, like every other consumer", () => {
    expect(offsetTargetMs(5, NOW)).toBe(NOW);
    expect(offsetTargetMs(undefined, NOW)).toBe(NOW);
  });
});

describe("layerTimeRange", () => {
  it("converts the layer's seconds to milliseconds", () => {
    expect(layerTimeRange(fakeLayer())).toEqual({
      startMs: NOW - 3 * HOUR,
      endMs: NOW + 9 * HOUR,
    });
  });

  it("is null while the layer has no frames", () => {
    expect(layerTimeRange(fakeLayer({ frames: false }))).toBeNull();
    expect(layerTimeRange(null)).toBeNull();
    expect(layerTimeRange({})).toBeNull();
  });
});

describe("applyLayerTime", () => {
  it("sets now + offset, in seconds", () => {
    const layer = fakeLayer();
    const result = applyLayerTime(layer, 3, NOW);
    expect(layer.setAnimationTime).toHaveBeenCalledWith((NOW + 3 * HOUR) / 1000);
    expect(result).toMatchObject({ available: true, offset: 3, clamped: false });
    expect(result.timeMs).toBe(NOW + 3 * HOUR);
  });

  it("handles 'now' with no offset", () => {
    const layer = fakeLayer();
    applyLayerTime(layer, 0, NOW);
    expect(layer.setAnimationTime).toHaveBeenCalledWith(NOW / 1000);
  });

  it("clamps to the last available frame and says so", () => {
    /* provider forecast only reaches +4 h, user asked for +6 h */
    const layer = fakeLayer({ endMs: NOW + 4 * HOUR });
    const result = applyLayerTime(layer, 6, NOW);
    expect(layer.setAnimationTime).toHaveBeenCalledWith((NOW + 4 * HOUR) / 1000);
    expect(result.clamped).toBe(true);
    expect(result.offset).toBe(6); /* the user's choice stays highlighted */
  });

  it("reports unavailable — and touches nothing — while frames are missing", () => {
    const layer = fakeLayer({ frames: false });
    const result = applyLayerTime(layer, 3, NOW);
    expect(result.available).toBe(false);
    expect(result.timeMs).toBeNull();
    expect(layer.setAnimationTime).not.toHaveBeenCalled();
  });

  it("never throws on a layer that is not a time-frame animation", () => {
    expect(applyLayerTime(null, 3, NOW).available).toBe(false);
    expect(applyLayerTime({}, 3, NOW).available).toBe(false);
  });

  it("normalizes an unsupported offset instead of jumping somewhere arbitrary", () => {
    const layer = fakeLayer();
    const result = applyLayerTime(layer, 42, NOW);
    expect(result.offset).toBe(0);
    expect(layer.setAnimationTime).toHaveBeenCalledWith(NOW / 1000);
  });
});

describe("availableOffsets", () => {
  it("lists every offset the loaded frames can satisfy", () => {
    expect(availableOffsets(fakeLayer(), NOW)).toEqual([0, 3, 6]);
  });

  it("drops offsets past the end of the forecast", () => {
    expect(availableOffsets(fakeLayer({ endMs: NOW + 4 * HOUR }), NOW)).toEqual([0, 3]);
  });

  it("is empty with no frames", () => {
    expect(availableOffsets(fakeLayer({ frames: false }), NOW)).toEqual([]);
  });

  it("offers +12 h and +24 h only when the frames reach them", () => {
    expect(availableOffsets(fakeLayer({ endMs: NOW + 12 * HOUR }), NOW)).toEqual([0, 3, 6, 12]);
    expect(availableOffsets(fakeLayer({ endMs: NOW + 30 * HOUR }), NOW)).toEqual(TIME_OFFSETS);
  });

  it("points the layer at +24 h in seconds, and clamps a shorter forecast", () => {
    const long = fakeLayer({ endMs: NOW + 48 * HOUR });
    applyLayerTime(long, 24, NOW);
    expect(long.setAnimationTime).toHaveBeenCalledWith((NOW + 24 * HOUR) / 1000);

    const short = fakeLayer({ endMs: NOW + 9 * HOUR });
    const result = applyLayerTime(short, 24, NOW);
    expect(short.setAnimationTime).toHaveBeenCalledWith((NOW + 9 * HOUR) / 1000);
    expect(result).toMatchObject({ offset: 24, clamped: true });
  });
});

/* wx.hourly starts at the CURRENT hour, one entry per hour. */
const hourly = (count, field = "humidity") =>
  Array.from({ length: count }, (_, hour) => ({ time: `h${hour}`, [field]: 40 + hour }));

describe("hourlyIndexForOffset", () => {
  it.each([
    [0, 25, 0],
    [3, 25, 3],
    [12, 25, 12],
    [24, 25, 24],
  ])("offset %i in %i entries is entry %i", (offset, length, index) => {
    expect(hourlyIndexForOffset(offset, length)).toBe(index);
  });

  it("is null when the forecast stops short of the hour", () => {
    expect(hourlyIndexForOffset(24, 24)).toBeNull();
    expect(hourlyIndexForOffset(12, 12)).toBeNull();
    expect(hourlyIndexForOffset(0, 0)).toBeNull();
  });

  it("is null for a missing length", () => {
    expect(hourlyIndexForOffset(3, undefined)).toBeNull();
    expect(hourlyIndexForOffset(3, "25")).toBeNull();
  });

  it("resolves an unsupported offset to now", () => {
    expect(hourlyIndexForOffset(5, 25)).toBe(0);
  });
});

describe("hourlyEntryAtOffset", () => {
  it("returns the entry for the hour, never a neighbour", () => {
    expect(hourlyEntryAtOffset(hourly(25), 6)).toEqual({ time: "h6", humidity: 46 });
    expect(hourlyEntryAtOffset(hourly(25), 24)).toEqual({ time: "h24", humidity: 64 });
  });

  it("is null past the end, and for anything that is not an array", () => {
    expect(hourlyEntryAtOffset(hourly(12), 12)).toBeNull();
    expect(hourlyEntryAtOffset(undefined, 3)).toBeNull();
    expect(hourlyEntryAtOffset({ length: 25 }, 3)).toBeNull();
  });
});

describe("availableHourlyOffsets", () => {
  it("lists every offset when the hourly data reaches +24 h", () => {
    expect(availableHourlyOffsets(hourly(25), "humidity")).toEqual(TIME_OFFSETS);
  });

  it("drops the hours a short forecast does not reach", () => {
    expect(availableHourlyOffsets(hourly(13), "humidity")).toEqual([0, 3, 6, 12]);
    expect(availableHourlyOffsets(hourly(4), "humidity")).toEqual([0, 3]);
  });

  it("drops an hour whose own value is missing or not a number", () => {
    const data = hourly(25);
    data[6].humidity = null;
    data[12].humidity = NaN;
    expect(availableHourlyOffsets(data, "humidity")).toEqual([0, 3, 24]);
  });

  it("is empty when the field is absent everywhere, or there is no data", () => {
    expect(availableHourlyOffsets(hourly(25, "temp"), "humidity")).toEqual([]);
    expect(availableHourlyOffsets(null, "humidity")).toEqual([]);
  });
});
