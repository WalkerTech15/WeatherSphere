/* The two waits that decide when the Home preview map may start loading the
 * SDK. (loadMapLibre itself is a pair of dynamic imports; the app's own build
 * check is that its chunk stays out of the entry bundle.) */
import { describe, it, expect, vi, afterEach } from "vitest";
import { whenMapNearViewport, idle } from "./map-sdk.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("whenMapNearViewport", () => {
  it("resolves at once where IntersectionObserver does not exist", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await expect(whenMapNearViewport({})).resolves.toBeUndefined();
  });

  it("waits until the element is within 400px of the screen, then stops watching", async () => {
    let callback;
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    let options;
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function (cb, opts) {
        callback = cb;
        options = opts;
        return observer;
      }),
    );
    const el = {};
    let done = false;
    const wait = whenMapNearViewport(el).then(() => (done = true));
    expect(observer.observe).toHaveBeenCalledWith(el);
    expect(options.rootMargin).toBe("400px 0px");
    callback([{ isIntersecting: false }]);
    await Promise.resolve();
    expect(done).toBe(false);
    callback([{ isIntersecting: true }]);
    await wait;
    expect(done).toBe(true);
    expect(observer.disconnect).toHaveBeenCalled();
  });
});

describe("idle", () => {
  it("uses the browser's idle callback with a timeout when there is one", async () => {
    const requestIdleCallback = vi.fn((fn) => fn());
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    await idle(250);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 250 });
  });

  it("falls back to the next tick where there is no idle callback (Safari)", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    let done = false;
    idle().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});
