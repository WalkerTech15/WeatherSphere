import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchXweatherLightning } from "./xweather-lightning.js";
import { strikeTypeLabel, lightningAnnouncement } from "../ui/render-map-lightning.js";
import { state } from "../core/state.js";

const originalLang = state.lang;
afterEach(() => {
  vi.unstubAllGlobals();
  state.lang = originalLang;
});

const reply = (status, body) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

async function kindOf(fetchMock) {
  vi.stubGlobal("fetch", fetchMock);
  try {
    await fetchXweatherLightning({ lat: 43, lon: 0 });
  } catch (err) {
    return err.kind;
  }
  return "resolved";
}

describe("Xweather lightning service", () => {
  it("uses the server proxy and accepts verified strike data", async () => {
    vi.stubGlobal("fetch", reply(200, { strikes: [] }));
    const result = await fetchXweatherLightning({ lat: 43, lon: 0 });
    expect(result.strikes).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/xweather-lightning?lat=43&lon=0&radius=40",
      expect.anything(),
    );
  });

  it("keeps real strikes and drops any without a valid position", async () => {
    vi.stubGlobal(
      "fetch",
      reply(200, {
        strikes: [
          { lat: 43.1, lon: 0.2, type: "cg", amperage: -12000 },
          { lat: 120, lon: 0, type: "cg" },
          { lat: null, lon: 0 },
        ],
      }),
    );
    const { strikes } = await fetchXweatherLightning({ lat: 43, lon: 0 });
    expect(strikes).toEqual([{ lat: 43.1, lon: 0.2, type: "cg", amperage: -12000 }]);
  });

  it("reports an HTML page (a missing local route) as malformed, never as 'no lightning'", async () => {
    const html = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => JSON.parse("<!doctype html><html></html>"),
    });
    expect(await kindOf(html)).toBe("malformed");
    expect(await kindOf(reply(200, { error: "x" }))).toBe("malformed");
  });

  it("turns the proxy's failure statuses into kinds the panel can explain", async () => {
    expect(await kindOf(reply(503, { error: "unavailable" }))).toBe("unavailable");
    expect(await kindOf(reply(429, { error: "rate_limited" }))).toBe("rate_limited");
    expect(await kindOf(reply(504, { error: "timeout" }))).toBe("timeout");
    expect(await kindOf(reply(502, { error: "upstream_error" }))).toBe("http");
    expect(await kindOf(reply(400, { error: "invalid_coordinates" }))).toBe("http");
  });
});

describe("lightning panel wording", () => {
  it("names Xweather's pulse types in both languages", () => {
    state.lang = "en";
    expect(strikeTypeLabel("cg")).toBe("Cloud-to-ground");
    expect(strikeTypeLabel("IC")).toBe("In-cloud");
    expect(strikeTypeLabel("")).toBe("Lightning strike");
    state.lang = "fr";
    expect(strikeTypeLabel("cg")).toBe("Nuage-sol");
    expect(strikeTypeLabel("ic")).toBe("Intra-nuage");
  });

  it("announces a rate limit distinctly from a generic failure", () => {
    state.lang = "en";
    expect(lightningAnnouncement({ status: "error", errorKind: "rate_limited" })).toMatch(
      /Too many lightning requests/,
    );
    state.lang = "fr";
    expect(lightningAnnouncement({ status: "error", errorKind: "rate_limited" })).toMatch(
      /Trop de requêtes/,
    );
  });
});
