/* Contract tests for the Xweather lightning proxy: the Vercel function
 * (api/xweather-lightning.js) and the Vite dev middleware that serves the
 * same route locally (vite.config.js). Both run lightningResponse(), so the
 * shared core is tested once and each entry point is tested for its wiring.
 *
 * `fetch` is stubbed, so nothing here touches the network or spends quota.
 * The upstream payloads use Xweather's real /lightning/closest shape. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import handler, { lightningResponse, toStrike } from "../../../api/xweather-lightning.js";
import { xweatherLightningDevProxy } from "../../../vite.config.js";

const CLIENT_ID = "test-client-id-0123456789";
const CLIENT_SECRET = "test-client-secret-9876543210abcdef";
const CREDS = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
const AT_MCKINLEY = { lat: "34.9969", lon: "-108.8866" };

afterEach(() => vi.restoreAllMocks());

/* One result in Xweather's own shape — position in `loc`, flash in `ob.pulse`. */
const upstreamStrike = (over = {}) => ({
  id: "abc",
  loc: { long: -108.8, lat: 35.01 },
  ob: {
    timestamp: 1790000000,
    age: 120,
    pulse: { type: "cg", peakamp: -15000, numSensors: 9 },
  },
  relativeTo: { distanceKM: 8.1 },
  ...over,
});

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const ok = (response, error = null) => jsonResponse(200, { success: true, error, response });
const failed = (code) =>
  jsonResponse(200, { success: false, error: { code, description: code }, response: [] });

function stubFetch(impl) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return impl(String(url), init);
  });
  return { fetchImpl, calls };
}

async function respond(upstream, query = AT_MCKINLEY, creds = CREDS) {
  const { fetchImpl, calls } = stubFetch(upstream);
  const result = await lightningResponse(query, { ...creds, fetchImpl });
  return { result, calls };
}

describe("lightningResponse — the request sent to Xweather", () => {
  it("asks /lightning/closest with the location in p=, an explicit km radius and a limit", async () => {
    const { calls } = await respond(() => ok([]));
    const url = calls[0].url;
    expect(url.origin + url.pathname).toBe("https://data.api.xweather.com/lightning/closest");
    expect(url.searchParams.get("p")).toBe("34.9969,-108.8866");
    expect(url.searchParams.get("radius")).toBe("40km");
    expect(url.searchParams.get("limit")).toBe("1000");
  });

  it("keeps a caller radius within Xweather's 100 km maximum", async () => {
    const asked = async (radius) =>
      (await respond(() => ok([]), { ...AT_MCKINLEY, radius })).calls[0].url.searchParams.get(
        "radius",
      );
    expect(await asked("75")).toBe("75km");
    expect(await asked("500")).toBe("40km");
    expect(await asked("-3")).toBe("40km");
  });

  it("rejects invalid coordinates without calling Xweather", async () => {
    for (const query of [
      {},
      { lat: "91", lon: "0" },
      { lat: "0", lon: "181" },
      { lat: "abc", lon: "1" },
      { lat: "", lon: "" },
    ]) {
      const { result, calls } = await respond(() => ok([]), query);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: "invalid_coordinates" });
      expect(calls).toHaveLength(0);
    }
  });

  it("answers 'unavailable' without calling Xweather when a credential is missing", async () => {
    for (const creds of [{}, { clientId: CLIENT_ID }, { clientSecret: CLIENT_SECRET }]) {
      const { result, calls } = await respond(() => ok([]), AT_MCKINLEY, creds);
      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "unavailable" });
      expect(calls).toHaveLength(0);
    }
  });
});

describe("lightningResponse — real observations and valid empty answers", () => {
  it("returns strikes read from loc.lat / loc.long and ob.pulse", async () => {
    const { result } = await respond(() =>
      ok([upstreamStrike(), upstreamStrike({ ob: { pulse: { type: "IC", peakamp: 4200 } } })]),
    );
    expect(result.status).toBe(200);
    expect(result.body.provider).toBe("Xweather");
    expect(result.body.radiusKm).toBe(40);
    expect(result.body.strikes).toEqual([
      { lat: 35.01, lon: -108.8, type: "cg", amperage: -15000 },
      { lat: 35.01, lon: -108.8, type: "ic", amperage: 4200 },
    ]);
  });

  it("drops a result with no usable position instead of inventing one", () => {
    expect(toStrike({ ob: { pulse: { type: "cg" } } })).toBeNull();
    expect(toStrike({ loc: { lat: 95, long: 0 } })).toBeNull();
    expect(toStrike({ loc: { lat: "", long: "" } })).toBeNull();
    /* the old, wrong reading (ob.lat / ob.lon) never produces a strike */
    expect(toStrike({ ob: { lat: 35, lon: -108 } })).toBeNull();
  });

  it("treats warn_no_data as a valid empty answer, not an error", async () => {
    const { result } = await respond(() =>
      ok([], { code: "warn_no_data", description: "Valid request. No results available." }),
    );
    expect(result.status).toBe(200);
    expect(result.body.strikes).toEqual([]);
  });
});

describe("lightningResponse — failures are JSON with a clear status", () => {
  const cases = [
    ["upstream HTTP 401", () => jsonResponse(401, {}), 503, "unavailable"],
    ["upstream HTTP 403", () => jsonResponse(403, {}), 503, "unavailable"],
    ["upstream HTTP 429", () => jsonResponse(429, {}), 429, "rate_limited"],
    ["upstream HTTP 500", () => jsonResponse(500, {}), 502, "upstream_error"],
    ["invalid_client in a 200 body", () => failed("invalid_client"), 503, "unavailable"],
    [
      "unauthorized_namespace in a 200 body",
      () => failed("unauthorized_namespace"),
      503,
      "unavailable",
    ],
    ["maxhits_min in a 200 body", () => failed("maxhits_min"), 429, "rate_limited"],
    ["maxhits_daily in a 200 body", () => failed("maxhits_daily"), 429, "rate_limited"],
    /* the committed bug: a location in the path is answered like this */
    ["no_location in a 200 body", () => failed("no_location"), 502, "upstream_error"],
  ];
  for (const [label, upstream, status, error] of cases) {
    it(`${label} → ${status} ${error}`, async () => {
      const { result } = await respond(upstream);
      expect(result.status).toBe(status);
      expect(result.body).toEqual({ error });
      expect(result.headers["Cache-Control"]).toBe("no-store");
    });
  }

  it("tells the browser when to retry after a rate limit", async () => {
    const { result } = await respond(() => jsonResponse(429, {}));
    expect(result.headers["Retry-After"]).toBe("60");
  });

  it("refuses malformed upstream data rather than reporting 'no lightning'", async () => {
    const notJson = { ok: true, status: 200, json: async () => JSON.parse("<!doctype html>") };
    for (const upstream of [
      () => notJson,
      () => jsonResponse(200, null),
      () => jsonResponse(200, { response: [] }),
      () => jsonResponse(200, { success: true, response: { not: "an array" } }),
    ]) {
      const { result } = await respond(upstream);
      expect(result.status).toBe(502);
      expect(result.body).toEqual({ error: "upstream_error" });
    }
  });

  it("maps a timeout to 504, and a network failure to 502", async () => {
    const timeout = await respond(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(timeout.result.status).toBe(504);
    expect(timeout.result.body).toEqual({ error: "timeout" });

    const network = await respond(() => {
      throw new TypeError("fetch failed");
    });
    expect(network.result.status).toBe(502);
  });

  it("gives the upstream request its own timeout signal", async () => {
    const { calls } = await respond(() => ok([]));
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("lightningResponse — caching", () => {
  it("lets a successful answer be cached briefly, and never an error", async () => {
    expect((await respond(() => ok([upstreamStrike()]))).result.headers["Cache-Control"]).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    expect((await respond(() => ok([]))).result.headers["Cache-Control"]).toMatch(/max-age=30/);
    expect((await respond(() => jsonResponse(500, {}))).result.headers["Cache-Control"]).toBe(
      "no-store",
    );
    expect(
      (await respond(() => ok([]), { lat: "x", lon: "y" })).result.headers["Cache-Control"],
    ).toBe("no-store");
  });
});

describe("lightningResponse — the credentials never leave the server", () => {
  const outcomes = [
    () => ok([upstreamStrike()]),
    () => ok([], { code: "warn_no_data" }),
    () => jsonResponse(401, { error: CLIENT_SECRET }),
    () => failed("invalid_client"),
    () => jsonResponse(429, {}),
    () => {
      throw new TypeError(`fetch failed for client_secret=${CLIENT_SECRET}`);
    },
  ];

  it("appear in no response body or header, and in no log line", async () => {
    const logged = [];
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      vi.spyOn(console, level).mockImplementation((...args) => logged.push(args.join(" ")));
    }
    for (const upstream of outcomes) {
      const { result } = await respond(upstream);
      const exposed = JSON.stringify(result);
      expect(exposed).not.toContain(CLIENT_SECRET);
      expect(exposed).not.toContain(CLIENT_ID);
    }
    expect(logged.join("\n")).not.toContain(CLIENT_SECRET);
    expect(logged).toEqual([]);
  });

  it("are sent only to Xweather's own HTTPS host", async () => {
    const { calls } = await respond(() => ok([]));
    expect(calls[0].url.protocol).toBe("https:");
    expect(calls[0].url.hostname).toBe("data.api.xweather.com");
  });
});

/* ── the Vercel entry point ── */

function fakeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
  };
  return res;
}

describe("api/xweather-lightning.js — the Vercel function", () => {
  let originalFetch;
  let originalEnv;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.XWEATHER_CLIENT_ID = CLIENT_ID;
    process.env.XWEATHER_CLIENT_SECRET = CLIENT_SECRET;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const name of ["XWEATHER_CLIENT_ID", "XWEATHER_CLIENT_SECRET"]) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    vi.restoreAllMocks();
  });

  it("reads the server environment and answers with the shared contract", async () => {
    const { fetchImpl, calls } = stubFetch(() => ok([upstreamStrike()]));
    globalThis.fetch = fetchImpl;
    const res = fakeRes();
    await handler({ method: "GET", query: AT_MCKINLEY }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.strikes).toHaveLength(1);
    expect(res.headers["Cache-Control"]).toMatch(/max-age=30/);
    expect(calls[0].url.searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  it("answers 503 when the server has no credentials", async () => {
    delete process.env.XWEATHER_CLIENT_SECRET;
    const { fetchImpl } = stubFetch(() => ok([]));
    globalThis.fetch = fetchImpl;
    const res = fakeRes();
    await handler({ method: "GET", query: AT_MCKINLEY }, res);
    expect(res.statusCode).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses any method but GET", async () => {
    const res = fakeRes();
    await handler({ method: "POST", query: AT_MCKINLEY }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("GET");
  });
});

/* ── the Vite dev middleware — the route that used to fall through to index.html ── */

function nodeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    end(chunk = "") {
      res.body = String(chunk);
      res.ended = true;
    },
  };
  return res;
}

async function devRequest(path, { method = "GET", upstream = () => ok([]), creds = CREDS } = {}) {
  const middleware = [];
  const plugin = xweatherLightningDevProxy(creds.clientId, creds.clientSecret);
  plugin.configureServer({ middlewares: { use: (fn) => middleware.push(fn) } });
  const { fetchImpl } = stubFetch(upstream);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const res = nodeRes();
    const next = vi.fn();
    await middleware[0]({ url: path, method }, res, next);
    return { res, next, fetchImpl };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("vite.config.js — the local /api/xweather-lightning route", () => {
  it("is registered for both `vite dev` and `vite preview`", () => {
    const plugin = xweatherLightningDevProxy(CLIENT_ID, CLIENT_SECRET);
    expect(plugin.apply).toBe("serve");
    expect(typeof plugin.configureServer).toBe("function");
    expect(typeof plugin.configurePreviewServer).toBe("function");
  });

  it("answers JSON — never the index.html fallback", async () => {
    const { res, next } = await devRequest(
      "/api/xweather-lightning?lat=34.9969&lon=-108.8866&radius=40",
      { upstream: () => ok([upstreamStrike()]) },
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).not.toMatch(/<!doctype|<html/i);
    const body = JSON.parse(res.body);
    expect(body.strikes).toEqual([{ lat: 35.01, lon: -108.8, type: "cg", amperage: -15000 }]);
  });

  it("answers JSON for an empty result, an invalid request and every failure", async () => {
    const cases = [
      ["/api/xweather-lightning?lat=34.9&lon=-108.8", () => ok([], { code: "warn_no_data" }), 200],
      ["/api/xweather-lightning?lat=north&lon=-108.8", () => ok([]), 400],
      ["/api/xweather-lightning?lat=34.9&lon=-108.8", () => jsonResponse(401, {}), 503],
      ["/api/xweather-lightning?lat=34.9&lon=-108.8", () => jsonResponse(403, {}), 503],
      ["/api/xweather-lightning?lat=34.9&lon=-108.8", () => jsonResponse(429, {}), 429],
      [
        "/api/xweather-lightning?lat=34.9&lon=-108.8",
        () => {
          throw new DOMException("timed out", "TimeoutError");
        },
        504,
      ],
      ["/api/xweather-lightning?lat=34.9&lon=-108.8", () => jsonResponse(502, {}), 502],
    ];
    for (const [path, upstream, status] of cases) {
      const { res } = await devRequest(path, { upstream });
      expect(res.statusCode).toBe(status);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(() => JSON.parse(res.body)).not.toThrow();
    }
  });

  it("answers 503 JSON when .env.local has no Xweather credentials", async () => {
    const { res, fetchImpl } = await devRequest("/api/xweather-lightning?lat=1&lon=2", {
      creds: { clientId: "", clientSecret: "" },
    });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses any method but GET, as JSON", async () => {
    const { res } = await devRequest("/api/xweather-lightning?lat=1&lon=2", { method: "POST" });
    expect(res.statusCode).toBe(405);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
  });

  it("leaves every other path to the rest of the dev server", async () => {
    const { next, res } = await devRequest("/api/xweather-lightning-extra?lat=1&lon=2");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.ended).toBeUndefined();
  });

  it("never writes the credentials into the local response", async () => {
    const { res } = await devRequest("/api/xweather-lightning?lat=34.9&lon=-108.8", {
      upstream: () => ok([upstreamStrike()]),
    });
    const exposed = res.body + JSON.stringify(res.headers);
    expect(exposed).not.toContain(CLIENT_SECRET);
    expect(exposed).not.toContain(CLIENT_ID);
  });
});

/* ── the credentials stay out of every file the browser can load ── */

describe("Xweather credentials never reach client code", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const clientFiles = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return clientFiles(full);
      return /\.(js|html|css)$/.test(entry) && !/\.test\.js$/.test(entry) ? [full] : [];
    });

  it("no browser source file names the credentials or calls Xweather directly", () => {
    const files = clientFiles(join(root, "src"));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/XWEATHER_CLIENT_(ID|SECRET)/);
      expect(src, file).not.toMatch(/VITE_XWEATHER/);
      expect(src, file).not.toMatch(/(data|maps)\.api\.xweather\.com/);
      expect(src, file).not.toMatch(/client_secret/);
    }
  });

  it("the server entry points read them unprefixed, and the secret check guards dist/", () => {
    expect(read("api/xweather-lightning.js")).toMatch(/process\.env\.XWEATHER_CLIENT_SECRET/);
    expect(read("vite.config.js")).toMatch(/env\.XWEATHER_CLIENT_SECRET/);
    for (const rel of ["api/xweather-lightning.js", "vite.config.js", ".env.local.example"]) {
      expect(read(rel), rel).not.toMatch(/VITE_XWEATHER/);
    }
    const verify = read("scripts/verify-no-secrets.mjs");
    expect(verify).toMatch(/XWEATHER_CLIENT_SECRET/);
    expect(verify).toMatch(/data\|maps\)\\\.api\\\.xweather\\\.com/);
  });
});
