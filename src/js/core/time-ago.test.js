/* Which timestamps may be shown, and how. The absurd "29840290 min" of the
 * Favorites page came from an unset timestamp (0); every way a timestamp can be
 * unusable is pinned here. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "./state.js";
import {
  ageMinutes,
  formatAgo,
  agoOrNotUpdated,
  updatedPhrase,
  MAX_AGE_MS,
  FUTURE_TOLERANCE_MS,
} from "./time-ago.js";

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const minutesAgo = (m) => NOW - m * 60_000;

beforeEach(() => {
  state.lang = "en";
});

describe("ageMinutes", () => {
  it("counts whole minutes for a valid timestamp", () => {
    expect(ageMinutes(NOW, NOW)).toBe(0);
    expect(ageMinutes(minutesAgo(5), NOW)).toBe(5);
    expect(ageMinutes(minutesAgo(90), NOW)).toBe(90);
  });

  it("rounds to the nearest minute, as the page always has", () => {
    expect(ageMinutes(NOW - 29_000, NOW)).toBe(0);
    expect(ageMinutes(NOW - 31_000, NOW)).toBe(1);
  });

  it("accepts a Date", () => {
    expect(ageMinutes(new Date(minutesAgo(7)), NOW)).toBe(7);
  });

  it.each([
    ["never set (0)", 0],
    ["negative", -5],
    ["negative and huge", -1e15],
    ["seconds, not milliseconds", 1_790_000_000],
    ["before the year 2000", Date.UTC(1999, 11, 31)],
    ["not a number", NaN],
    ["infinite", Infinity],
    ["missing", undefined],
    ["null", null],
    ["a numeric string", "1790000000000"],
    ["an ISO string", "2026-09-26T11:55:00Z"],
    ["an object", {}],
    ["an invalid Date", new Date("nope")],
  ])("is null for %s", (_name, value) => {
    expect(ageMinutes(value, NOW)).toBeNull();
  });

  it("is null for a timestamp in the future beyond clock skew", () => {
    expect(ageMinutes(NOW + FUTURE_TOLERANCE_MS + 1, NOW)).toBeNull();
    expect(ageMinutes(NOW + 3_600_000, NOW)).toBeNull();
  });

  it("treats a little clock skew as 'just now', never a negative age", () => {
    expect(ageMinutes(NOW + 30_000, NOW)).toBe(0);
    expect(ageMinutes(NOW + FUTURE_TOLERANCE_MS, NOW)).toBe(0);
  });

  it("is null for a reading older than a week — it is not current, whatever the number", () => {
    expect(ageMinutes(NOW - MAX_AGE_MS, NOW)).not.toBeNull();
    expect(ageMinutes(NOW - MAX_AGE_MS - 60_000, NOW)).toBeNull();
    expect(ageMinutes(NOW - 400 * 86_400_000, NOW)).toBeNull();
  });

  it("never returns an absurd number for the epoch-zero mistake", () => {
    expect(ageMinutes(0, Date.now())).toBeNull();
  });
});

describe("formatAgo", () => {
  it("formats minutes, hours and days, in English", () => {
    expect(formatAgo(NOW, NOW)).toBe("just now");
    expect(formatAgo(minutesAgo(1), NOW)).toBe("1 min ago");
    expect(formatAgo(minutesAgo(59), NOW)).toBe("59 min ago");
    expect(formatAgo(minutesAgo(60), NOW)).toBe("1 h ago");
    expect(formatAgo(minutesAgo(23 * 60 + 59), NOW)).toBe("23 h ago");
    expect(formatAgo(minutesAgo(24 * 60), NOW)).toBe("1 d ago");
    expect(formatAgo(minutesAgo(6 * 24 * 60), NOW)).toBe("6 d ago");
  });

  it("formats them in French", () => {
    state.lang = "fr";
    expect(formatAgo(NOW, NOW)).toBe("à l'instant");
    expect(formatAgo(minutesAgo(12), NOW)).toBe("il y a 12 min");
    expect(formatAgo(minutesAgo(180), NOW)).toBe("il y a 3 h");
    expect(formatAgo(minutesAgo(2 * 24 * 60), NOW)).toBe("il y a 2 j");
  });

  it("never shows a minute count of an hour or more", () => {
    for (let m = 60; m < 60 * 24 * 7; m += 37) {
      expect(formatAgo(minutesAgo(m), NOW)).not.toMatch(/\d{3,} min/);
    }
  });

  it("is null, not text, for an unusable timestamp", () => {
    expect(formatAgo(0, NOW)).toBeNull();
    expect(formatAgo(undefined, NOW)).toBeNull();
    expect(formatAgo(NOW + 86_400_000, NOW)).toBeNull();
  });
});

describe("the translated fallback", () => {
  it("says 'Not updated' in English and 'Données non actualisées' in French", () => {
    expect(agoOrNotUpdated(0, NOW)).toBe("Not updated");
    state.lang = "fr";
    expect(agoOrNotUpdated(0, NOW)).toBe("Données non actualisées");
  });

  it("agoOrNotUpdated keeps a valid time as it is", () => {
    expect(agoOrNotUpdated(minutesAgo(4), NOW)).toBe("4 min ago");
  });

  it("updatedPhrase reads as a sentence either way", () => {
    expect(updatedPhrase(minutesAgo(4), NOW)).toBe("Updated 4 min ago");
    expect(updatedPhrase(NOW, NOW)).toBe("Updated just now");
    expect(updatedPhrase(0, NOW)).toBe("Not updated");
    state.lang = "fr";
    expect(updatedPhrase(minutesAgo(4), NOW)).toBe("Mis à jour il y a 4 min");
    expect(updatedPhrase(NOW + 3_600_000, NOW)).toBe("Données non actualisées");
  });

  it("never lets a raw number of millions reach the text", () => {
    for (const bad of [0, -1, NaN, undefined, "x", 1e3]) {
      expect(updatedPhrase(bad, Date.now())).not.toMatch(/\d{5,}/);
    }
  });
});
