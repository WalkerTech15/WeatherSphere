/* Contract tests for the OpenWeatherMap cloud-tile proxy: the Vercel function
 * (api/openweather-clouds.js) and the Vite dev middleware that serves the same
 * route locally (vite.config.js). Both run cloudsResponse(), so the shared core
 * is tested once and each entry point is tested for its wiring.
 *
 * `fetch` is stubbed, so nothing here touches the network or spends quota. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import handler, {
  cloudsResponse,
  parseTile,
  tileUrl,
  MAX_TILE_ZOOM,
} from "../../../api/openweather-clouds.js";
import { openWeatherCloudsDevProxy } from "../../../vite.config.js";

const KEY = "test-owm-key-0123456789abcdef0123";
const TILE = { z: "3", x: "4", y: "2" };

afterEach(() => vi.restoreAllMocks());

/* A minimal valid PNG: the 8-byte signature plus filler. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

const bytesResponse = (status, bytes = PNG) => ({
  ok: status >= 200 && status < 300,
  status,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
});

function stubFetch(impl) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return impl(String(url), init);
  });
  return { fetchImpl, calls };
}

describe("parseTile — z, x and y are validated before anything is requested", () => {
  it("accepts a tile inside the 2^z grid", () => {
    expect(parseTile({ z: "0", x: "0", y: "0" })).toEqual({ z: 0, x: 0, y: 0 });
    expect(parseTile(TILE)).toEqual({ z: 3, x: 4, y: 2 });
    expect(parseTile({ z: "3", x: "7", y: "7" })).toEqual({ z: 3, x: 7, y: 7 });
    const max = String(MAX_TILE_ZOOM);
    const last = String(2 ** MAX_TILE_ZOOM - 1);
    expect(parseTile({ z: max, x: last, y: last })).not.toBeNull();
  });

  it("rejects a tile outside the grid or beyond the zoom cap", () => {
    expect(parseTile({ z: "3", x: "8", y: "0" })).toBeNull();
    expect(parseTile({ z: "3", x: "0", y: "8" })).toBeNull();
    expect(parseTile({ z: "0", x: "1", y: "0" })).toBeNull();
    expect(parseTile({ z: String(MAX_TILE_ZOOM + 1), x: "0", y: "0" })).toBeNull();
  });

  it.each([
    ["negative", { z: "-1", x: "0", y: "0" }],
    ["decimal", { z: "3", x: "1.5", y: "0" }],
    ["exponent", { z: "3", x: "1e1", y: "0" }],
    ["hex", { z: "3", x: "0x1", y: "0" }],
    ["leading zero", { z: "3", x: "01", y: "0" }],
    ["padded", { z: "3", x: " 1", y: "0" }],
    ["signed", { z: "+3", x: "0", y: "0" }],
    ["empty", { z: "", x: "0", y: "0" }],
    ["text", { z: "abc", x: "0", y: "0" }],
    ["path traversal", { z: "3", x: "../etc", y: "0" }],
    ["query injection", { z: "3", x: "1&appid=evil", y: "0" }],
    ["absurdly long", { z: "3", x: "1".repeat(40), y: "0" }],
    ["a repeated parameter (array)", { z: ["3", "4"], x: "0", y: "0" }],
    ["missing y", { z: "3", x: "0" }],
    ["nothing", {}],
  ])("rejects %s", (_name, query) => {
    expect(parseTile(query)).toBeNull();
  });

  it("does not throw on a missing query object", () => {
    expect(parseTile(undefined)).toBeNull();
    expect(parseTile(null)).toBeNull();
  });
});

describe("tileUrl — the official clouds_new endpoint, built from numbers only", () => {
  it("targets tile.openweathermap.org/map/clouds_new with the key as appid", () => {
    const url = tileUrl({ z: 3, x: 4, y: 2 }, KEY);
    expect(url.origin).toBe("https://tile.openweathermap.org");
    expect(url.pathname).toBe("/map/clouds_new/3/4/2.png");
    expect(url.searchParams.get("appid")).toBe(KEY);
    expect([...url.searchParams.keys()]).toEqual(["appid"]);
  });
});

describe("cloudsResponse — the shared core", () => {
  it("relays a PNG tile with image headers and a short public cache", async () => {
    const { fetchImpl, calls } = stubFetch(() => bytesResponse(200));
    const result = await cloudsResponse(TILE, { apiKey: KEY, fetchImpl });
    expect(result.status).toBe(200);
    expect(result.json).toBe(false);
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect(result.body.equals(PNG)).toBe(true);
    expect(result.headers["Content-Type"]).toBe("image/png");
    expect(result.headers["Cache-Control"]).toMatch(/public, max-age=\d+/);
    expect(result.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/map/clouds_new/3/4/2.png");
    expect(calls[0].url.searchParams.get("appid")).toBe(KEY);
  });

  it("makes no upstream request for an invalid tile", async () => {
    const { fetchImpl } = stubFetch(() => bytesResponse(200));
    for (const query of [{}, { z: "3", x: "9", y: "0" }, { z: "3", x: "-1", y: "0" }]) {
      const result = await cloudsResponse(query, { apiKey: KEY, fetchImpl });
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: "invalid_tile" });
      expect(result.headers["Cache-Control"]).toBe("no-store");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is unavailable, without calling out, when no key is configured", async () => {
    const { fetchImpl } = stubFetch(() => bytesResponse(200));
    for (const apiKey of [undefined, ""]) {
      const result = await cloudsResponse(TILE, { apiKey, fetchImpl });
      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "unavailable" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 503, "unavailable"],
    [403, 503, "unavailable"],
    [429, 429, "rate_limited"],
    [500, 502, "upstream_error"],
    [404, 502, "upstream_error"],
  ])(
    "maps upstream HTTP %i to %i (%s), never passing the upstream body on",
    async (up, status, error) => {
      const { fetchImpl } = stubFetch(() => bytesResponse(up, Buffer.from("secret upstream text")));
      const result = await cloudsResponse(TILE, { apiKey: KEY, fetchImpl });
      expect(result.status).toBe(status);
      expect(result.body).toEqual({ error });
      expect(result.headers["Cache-Control"]).toBe("no-store");
      if (status === 429) expect(result.headers["Retry-After"]).toBe("60");
    },
  );

  it("maps a timeout to 504 and any other network failure to 502", async () => {
    const timeout = stubFetch(() => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    expect((await cloudsResponse(TILE, { apiKey: KEY, fetchImpl: timeout.fetchImpl })).status).toBe(
      504,
    );
    const aborted = stubFetch(() => {
      throw Object.assign(new Error("a"), { name: "AbortError" });
    });
    expect((await cloudsResponse(TILE, { apiKey: KEY, fetchImpl: aborted.fetchImpl })).status).toBe(
      504,
    );
    const network = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const result = await cloudsResponse(TILE, { apiKey: KEY, fetchImpl: network.fetchImpl });
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "upstream_error" });
  });

  it("passes an abort signal so a slow upstream cannot hold the function open", async () => {
    const { fetchImpl, calls } = stubFetch(() => bytesResponse(200));
    await cloudsResponse(TILE, { apiKey: KEY, fetchImpl, timeoutMs: 1234 });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses a 200 that is not a PNG (an HTML or JSON body is never relayed as an image)", async () => {
    const html = stubFetch(() => bytesResponse(200, Buffer.from("<!doctype html><html></html>")));
    const result = await cloudsResponse(TILE, { apiKey: KEY, fetchImpl: html.fetchImpl });
    expect(result.status).toBe(502);
    expect(result.json).toBe(true);
    const empty = stubFetch(() => bytesResponse(200, Buffer.alloc(0)));
    expect((await cloudsResponse(TILE, { apiKey: KEY, fetchImpl: empty.fetchImpl })).status).toBe(
      502,
    );
  });

  it("refuses an oversized body", async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    const { fetchImpl } = stubFetch(() => bytesResponse(200, huge));
    expect((await cloudsResponse(TILE, { apiKey: KEY, fetchImpl })).status).toBe(502);
  });

  it("never puts the key in any response it builds", async () => {
    const outcomes = [
      bytesResponse(200),
      bytesResponse(401),
      bytesResponse(429),
      bytesResponse(500),
      bytesResponse(200, Buffer.from("not a png")),
    ];
    for (const upstream of outcomes) {
      const { fetchImpl } = stubFetch(() => upstream);
      const result = await cloudsResponse(TILE, { apiKey: KEY, fetchImpl });
      const shown = JSON.stringify([result.headers, result.json ? result.body : ""]);
      expect(shown).not.toContain(KEY);
      expect(shown).not.toContain("appid");
    }
    const { fetchImpl } = stubFetch(() => {
      throw new Error(`boom ${KEY}`);
    });
    const thrown = await cloudsResponse(TILE, { apiKey: KEY, fetchImpl });
    expect(JSON.stringify(thrown)).not.toContain(KEY);
  });
});

describe("cloudsResponse — the availability probe", () => {
  it("says whether a key is configured, without ever calling OpenWeatherMap", async () => {
    const { fetchImpl } = stubFetch(() => bytesResponse(200));
    const on = await cloudsResponse({ status: "1" }, { apiKey: KEY, fetchImpl });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ available: true });
    const off = await cloudsResponse({ status: "1" }, { apiKey: "", fetchImpl });
    expect(off.body).toEqual({ available: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not echo the key", async () => {
    const on = await cloudsResponse({ status: "1" }, { apiKey: KEY });
    expect(JSON.stringify(on)).not.toContain(KEY);
  });

  it("only answers for status=1; any other value is an ordinary (invalid) tile request", async () => {
    const result = await cloudsResponse({ status: "0" }, { apiKey: KEY });
    expect(result.status).toBe(400);
  });
});

describe("api/openweather-clouds.js — the Vercel handler wiring", () => {
  function fakeRes() {
    const res = {
      headers: {},
      statusCode: 0,
      payload: undefined,
      sent: undefined,
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
      send(body) {
        this.sent = body;
        return this;
      },
    };
    return res;
  }

  it("reads the key from OPENWEATHER_API_KEY and streams a PNG", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", KEY);
    const { fetchImpl, calls } = stubFetch(() => bytesResponse(200));
    vi.stubGlobal("fetch", fetchImpl);
    const res = fakeRes();
    await handler({ method: "GET", query: TILE }, res);
    expect(res.statusCode).toBe(200);
    expect(Buffer.isBuffer(res.sent)).toBe(true);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(calls[0].url.searchParams.get("appid")).toBe(KEY);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is unavailable when the variable is missing", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "");
    const res = fakeRes();
    await handler({ method: "GET", query: TILE }, res);
    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ error: "unavailable" });
    vi.unstubAllEnvs();
  });

  it("answers only GET", async () => {
    const res = fakeRes();
    await handler({ method: "POST", query: TILE }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("GET");
  });
});

describe("vite.config.js — the dev middleware", () => {
  function run(middleware, { method = "GET", url }) {
    return new Promise((resolve) => {
      let nextCalled = false;
      const res = {
        headers: {},
        statusCode: 200,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        end(body) {
          resolve({ res: this, body, nextCalled });
        },
      };
      const handler = { use: (fn) => (handler.fn = fn) };
      middleware.configureServer({ middlewares: handler });
      handler.fn({ method, url }, res, () => {
        nextCalled = true;
        resolve({ res, body: undefined, nextCalled });
      });
    });
  }

  it("ignores other routes", async () => {
    const out = await run(openWeatherCloudsDevProxy(KEY), { url: "/api/pexels?q=x" });
    expect(out.nextCalled).toBe(true);
  });

  it("answers the probe as JSON without the key", async () => {
    const out = await run(openWeatherCloudsDevProxy(KEY), {
      url: "/api/openweather-clouds?status=1",
    });
    expect(out.res.statusCode).toBe(200);
    expect(out.res.headers["Content-Type"]).toMatch(/application\/json/);
    expect(JSON.parse(out.body)).toEqual({ available: true });
    expect(out.body).not.toContain(KEY);
  });

  it("reports 'not available' locally when no key is set (never an SPA HTML page)", async () => {
    const out = await run(openWeatherCloudsDevProxy(""), {
      url: "/api/openweather-clouds?status=1",
    });
    expect(JSON.parse(out.body)).toEqual({ available: false });
    const tile = await run(openWeatherCloudsDevProxy(""), {
      url: "/api/openweather-clouds?z=1&x=0&y=0",
    });
    expect(tile.res.statusCode).toBe(503);
  });

  it("rejects an invalid tile with 400 and rejects other methods", async () => {
    const bad = await run(openWeatherCloudsDevProxy(KEY), {
      url: "/api/openweather-clouds?z=2&x=9&y=0",
    });
    expect(bad.res.statusCode).toBe(400);
    const post = await run(openWeatherCloudsDevProxy(KEY), {
      method: "POST",
      url: "/api/openweather-clouds?z=1&x=0&y=0",
    });
    expect(post.res.statusCode).toBe(405);
  });
});

describe("the key stays on the server", () => {
  const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

  function sources(dir) {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(js|html|css)$/.test(entry) && !/\.test\.js$/.test(entry) ? [full] : [];
    });
  }

  it("no file under src/ names the variable, the upstream host or the appid parameter", () => {
    for (const file of sources(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/OPENWEATHER_API_KEY|VITE_OPENWEATHER/);
      expect(text, file).not.toMatch(/tile\.openweathermap\.org|api\.openweathermap\.org/);
      expect(text, file).not.toMatch(/appid=/);
    }
  });

  it("the variable is not exposed through a VITE_ name anywhere in the config or template", () => {
    expect(readFileSync(join(ROOT, "vite.config.js"), "utf8")).not.toMatch(/VITE_OPENWEATHER/);
    expect(readFileSync(join(ROOT, ".env.local.example"), "utf8")).not.toMatch(/VITE_OPENWEATHER/);
  });
});
