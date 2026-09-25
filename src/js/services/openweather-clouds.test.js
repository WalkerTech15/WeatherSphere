/* The browser side of the Clouds layer: where its tiles come from, whether the
 * layer may be offered, and what a failed tile means. */
import { describe, it, expect, vi } from "vitest";
import {
  CLOUDS_ENDPOINT,
  CLOUDS_SOURCE_MAX_ZOOM,
  cloudsErrorKind,
  cloudsTileTemplate,
  fetchCloudsAvailable,
} from "./openweather-clouds.js";

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body instanceof Error) throw body;
    return body;
  },
});

describe("cloudsTileTemplate", () => {
  it("is an absolute same-origin URL with the map's own z/x/y placeholders", () => {
    expect(cloudsTileTemplate("https://weathersphere.example")).toBe(
      "https://weathersphere.example/api/openweather-clouds?z={z}&x={x}&y={y}",
    );
  });

  it("never points at OpenWeatherMap directly and carries no credential", () => {
    const url = cloudsTileTemplate("http://localhost:5173");
    expect(url).not.toMatch(/openweathermap/i);
    expect(url).not.toMatch(/appid|key|token/i);
    expect(url.startsWith(`http://localhost:5173${CLOUDS_ENDPOINT}`)).toBe(true);
  });

  it("stays within the zoom the proxy accepts", () => {
    expect(CLOUDS_SOURCE_MAX_ZOOM).toBeLessThanOrEqual(12);
  });
});

describe("fetchCloudsAvailable", () => {
  it("is true only when the proxy says a key is configured", async () => {
    const fetchImpl = vi.fn(async () => reply(200, { available: true }));
    expect(await fetchCloudsAvailable({ fetchImpl })).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/openweather-clouds?status=1");
  });

  it.each([
    ["no key configured", () => reply(200, { available: false })],
    ["a truthy non-boolean", () => reply(200, { available: "yes" })],
    ["a server error", () => reply(500, { available: true })],
    ["a missing route answered by an HTML page", () => reply(200, new SyntaxError("not json"))],
    ["an empty body", () => reply(200, null)],
    [
      "a network failure",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("is false for %s", async (_name, impl) => {
    expect(await fetchCloudsAvailable({ fetchImpl: vi.fn(async () => impl()) })).toBe(false);
  });
});

describe("cloudsErrorKind — the proxy's statuses, as the panel explains them", () => {
  it("names a rejected or missing key 'unavailable'", () => {
    expect(cloudsErrorKind(401)).toBe("unavailable");
    expect(cloudsErrorKind(403)).toBe("unavailable");
    expect(cloudsErrorKind(503)).toBe("unavailable");
  });

  it("names a rate limit and a timeout", () => {
    expect(cloudsErrorKind(429)).toBe("rate_limited");
    expect(cloudsErrorKind(504)).toBe("timeout");
    expect(cloudsErrorKind(408)).toBe("timeout");
  });

  it("keeps every other failure distinct from those, and never returns nothing", () => {
    expect(cloudsErrorKind(502)).toBe("http");
    expect(cloudsErrorKind(500)).toBe("http");
    expect(cloudsErrorKind(undefined)).toBe("network");
    expect(cloudsErrorKind(0)).toBe("network");
  });
});
