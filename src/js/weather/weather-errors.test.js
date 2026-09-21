/* Shared request transport: timeout, status, JSON, and failure classification. */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  WeatherError,
  WEATHER_ERROR_KINDS,
  isWeatherError,
  classifyFetchError,
  requestJson,
  malformed,
  unavailable,
} from "./weather-errors.js";

const originalFetch = globalThis.fetch;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function setOnline(onLine) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
});

const named = (name) => Object.assign(new Error(name), { name });

describe("WeatherError", () => {
  it("carries a kind, status and cause", () => {
    const cause = new Error("root");
    const err = new WeatherError("http", "HTTP 500", { status: 500, cause });
    expect(err).toBeInstanceOf(Error);
    expect(isWeatherError(err)).toBe(true);
    expect(err.kind).toBe("http");
    expect(err.status).toBe(500);
    expect(err.cause).toBe(cause);
    expect(isWeatherError(new Error("x"))).toBe(false);
  });

  it("has helpers for the malformed and unavailable kinds", () => {
    expect(malformed()).toMatchObject({ kind: "malformed", message: "Malformed response" });
    expect(unavailable("school-api")).toMatchObject({ kind: "unavailable" });
  });
});

describe("classifyFetchError", () => {
  it("classifies timeout and abort errors as timeout", () => {
    expect(classifyFetchError(named("TimeoutError")).kind).toBe("timeout");
    expect(classifyFetchError(named("AbortError")).kind).toBe("timeout");
  });

  it("classifies other failures as offline when the browser reports offline", () => {
    setOnline(false);
    expect(classifyFetchError(new TypeError("Failed to fetch")).kind).toBe("offline");
  });

  it("classifies other failures as network when online", () => {
    setOnline(true);
    expect(classifyFetchError(new TypeError("Failed to fetch")).kind).toBe("network");
  });

  it("does not re-wrap a WeatherError", () => {
    const err = malformed();
    expect(classifyFetchError(err)).toBe(err);
  });

  it("checks timeout before offline", () => {
    setOnline(false);
    expect(classifyFetchError(named("TimeoutError")).kind).toBe("timeout");
  });
});

describe("requestJson", () => {
  it("returns the parsed body on success", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) }));
    await expect(requestJson("https://example.test/x")).resolves.toEqual({ a: 1 });
  });

  it("passes a fresh timeout signal by default", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await requestJson("https://example.test/x");
    expect(globalThis.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the caller's signal through unchanged", async () => {
    const signal = new AbortController().signal;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await requestJson("https://example.test/x", { signal });
    expect(globalThis.fetch.mock.calls[0][1].signal).toBe(signal);
  });

  it("rejects non-2xx responses with kind http, the status and the legacy message", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(requestJson("u")).rejects.toMatchObject({
      kind: WEATHER_ERROR_KINDS.http,
      status: 429,
      message: "HTTP 429",
    });
  });

  it("classifies a timeout from fetch", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw named("TimeoutError");
    });
    await expect(requestJson("u")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("classifies a network failure", async () => {
    setOnline(true);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(requestJson("u")).rejects.toMatchObject({ kind: "network" });
  });

  it("classifies a failure while offline", async () => {
    setOnline(false);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(requestJson("u")).rejects.toMatchObject({ kind: "offline" });
  });

  it("classifies an unparseable body as malformed", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    await expect(requestJson("u")).rejects.toMatchObject({ kind: "malformed" });
  });

  it("classifies a timeout while reading the body as timeout", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw named("TimeoutError");
      },
    }));
    await expect(requestJson("u")).rejects.toMatchObject({ kind: "timeout" });
  });
});
