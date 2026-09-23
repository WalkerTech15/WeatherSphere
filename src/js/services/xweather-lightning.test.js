import { describe, expect, it, vi } from "vitest";
import { fetchXweatherLightning } from "./xweather-lightning.js";

describe("Xweather lightning service", () => {
  it("uses the server proxy and accepts verified strike data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ strikes: [] }) }));
    const result = await fetchXweatherLightning({ lat: 43, lon: 0 });
    expect(result.strikes).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/xweather-lightning?lat=43&lon=0&radius=40",
      expect.anything(),
    );
  });
});
