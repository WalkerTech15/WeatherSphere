import { describe, it, expect } from "vitest";
import { computeAlertsState, sortAlerts, hasTornadoAlert } from "./alerts-state.js";

const NOW = Date.UTC(2026, 8, 22, 18, 0, 0);
const HOUR = 3600 * 1000;

const alert = (over = {}) => ({
  type: "tornado",
  event: "Tornado Warning",
  severity: "Extreme",
  urgency: "Immediate",
  certainty: "Observed",
  area: "Cleveland County, OK",
  authority: "NWS Norman OK",
  starts: NOW - HOUR,
  expires: NOW + HOUR,
  source: { name: "National Weather Service", url: "https://api.weather.gov/alerts/x" },
  ...over,
});

const ok = (alerts) => ({ status: "ok", alerts, sources: [{ id: "nws-us", name: "NWS" }] });

describe("computeAlertsState", () => {
  it("reports an active tornado warning", () => {
    const state = computeAlertsState(ok([alert()]), NOW);
    expect(state.status).toBe("active");
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].event).toBe("Tornado Warning");
  });

  it("reports a tornado watch the same way — it is a published alert too", () => {
    const state = computeAlertsState(
      ok([alert({ event: "Tornado Watch", severity: "Severe", urgency: "Future" })]),
      NOW,
    );
    expect(state.status).toBe("active");
    expect(state.alerts[0].event).toBe("Tornado Watch");
  });

  it("says 'clear' ONLY when a covering issuer actually answered with none", () => {
    expect(computeAlertsState(ok([]), NOW).status).toBe("clear");
  });

  it("says 'unsupported' where no issuer covers the place — never 'clear'", () => {
    const state = computeAlertsState({ status: "unavailable", alerts: [], sources: [] }, NOW);
    expect(state.status).toBe("unsupported");
    expect(state.status).not.toBe("clear");
    expect(state.alerts).toEqual([]);
  });

  it("says 'error' when the issuer could not be reached — never 'clear'", () => {
    const state = computeAlertsState({ status: "error", alerts: [], sources: [] }, NOW);
    expect(state.status).toBe("error");
    expect(state.status).not.toBe("clear");
  });

  it("keeps WHY it failed, so the panel can name offline or a timeout", () => {
    for (const kind of ["offline", "timeout", "http", "malformed"]) {
      expect(
        computeAlertsState({ status: "error", errorKind: kind, alerts: [], sources: [] }, NOW)
          .errorKind,
      ).toBe(kind);
    }
    /* an unlabelled failure is still a failure, never an all-clear */
    expect(computeAlertsState({ status: "error", alerts: [] }, NOW).errorKind).toBe("network");
  });

  it("treats a missing answer as unsupported rather than reassuring", () => {
    expect(computeAlertsState(undefined, NOW).status).toBe("unsupported");
    expect(computeAlertsState(null, NOW).status).toBe("unsupported");
  });

  it("drops an expired alert, and reports 'clear' when that was the only one", () => {
    const expired = alert({ starts: NOW - 3 * HOUR, expires: NOW - HOUR });
    const state = computeAlertsState(ok([expired]), NOW);
    expect(state.alerts).toEqual([]);
    expect(state.status).toBe("clear");
  });

  it("drops an alert that has not started yet", () => {
    const future = alert({ starts: NOW + HOUR, expires: NOW + 2 * HOUR });
    expect(computeAlertsState(ok([future]), NOW).alerts).toEqual([]);
  });

  it("keeps an alert right up to, but not including, its expiry", () => {
    const ending = alert({ starts: NOW - HOUR, expires: NOW + 1 });
    expect(computeAlertsState(ok([ending]), NOW).alerts).toHaveLength(1);
    expect(computeAlertsState(ok([ending]), NOW + 1).alerts).toEqual([]);
  });
});

describe("severity ordering", () => {
  it("puts the issuer's most severe alert first", () => {
    const list = [
      alert({ event: "Flood Advisory", severity: "Minor", type: "flood-advisory" }),
      alert({ event: "Severe Thunderstorm Warning", severity: "Severe", type: "severe-storm" }),
      alert({ event: "Tornado Warning", severity: "Extreme" }),
    ];
    expect(sortAlerts(list).map((a) => a.severity)).toEqual(["Extreme", "Severe", "Minor"]);
  });

  it("breaks a severity tie on the issuer's own urgency", () => {
    const list = [
      alert({ event: "A", urgency: "Future" }),
      alert({ event: "B", urgency: "Immediate" }),
      alert({ event: "C", urgency: "Expected" }),
    ];
    expect(sortAlerts(list).map((a) => a.event)).toEqual(["B", "C", "A"]);
  });

  it("sorts an unknown severity or urgency last instead of guessing", () => {
    const list = [
      alert({ event: "odd", severity: "Bizarre" }),
      alert({ event: "real", severity: "Severe" }),
    ];
    expect(sortAlerts(list)[0].event).toBe("real");
  });

  it("orders several live alerts through computeAlertsState", () => {
    const state = computeAlertsState(
      ok([
        alert({ event: "Flash Flood Warning", severity: "Severe", type: "flash-flood" }),
        alert({ event: "Tornado Warning", severity: "Extreme" }),
      ]),
      NOW,
    );
    expect(state.alerts.map((a) => a.event)).toEqual(["Tornado Warning", "Flash Flood Warning"]);
  });

  it("does not mutate the list it was given", () => {
    const list = [alert({ severity: "Minor" }), alert({ severity: "Extreme" })];
    const copy = [...list];
    sortAlerts(list);
    expect(list).toEqual(copy);
  });
});

describe("hasTornadoAlert", () => {
  it("is true only for an alert the issuer typed as a tornado", () => {
    expect(hasTornadoAlert([alert()])).toBe(true);
    expect(hasTornadoAlert([alert({ type: "severe-thunderstorm-warning" })])).toBe(false);
    expect(hasTornadoAlert([])).toBe(false);
    expect(hasTornadoAlert(null)).toBe(false);
  });
});
