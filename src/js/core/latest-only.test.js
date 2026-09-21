/* The race guard behind "rapid map clicks always end on the latest one". */
import { describe, it, expect, vi } from "vitest";
import { createLatestOnly } from "./latest-only.js";

const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("createLatestOnly", () => {
  it("returns the result when nothing supersedes it", async () => {
    const run = createLatestOnly();
    await expect(run(async () => "paris")).resolves.toBe("paris");
  });

  it("discards a slow earlier run in favour of a fast later one", async () => {
    const run = createLatestOnly();
    const slow = run(() => after(30, "atlantic")); /* clicked first, resolves last */
    const fast = run(() => after(5, "paris"));
    expect(await fast).toBe("paris");
    expect(await slow).toBeNull();
  });

  it("tells the task it is stale so it can bail before doing more work", async () => {
    const run = createLatestOnly();
    const afterFirstAwait = vi.fn();
    const first = run(async (isStale) => {
      await after(20);
      if (isStale()) return null;
      afterFirstAwait();
      return "stale-work";
    });
    const second = run(async () => "winner");
    expect(await second).toBe("winner");
    expect(await first).toBeNull();
    expect(afterFirstAwait).not.toHaveBeenCalled();
  });

  it("keeps the LAST of several overlapping runs, whatever order they resolve in", async () => {
    const run = createLatestOnly();
    const results = await Promise.all([
      run(() => after(25, "a")),
      run(() => after(2, "b")),
      run(() => after(12, "c")),
    ]);
    expect(results).toEqual([null, null, "c"]);
  });

  it("counts runs and can invalidate the in-flight one without starting another", async () => {
    const run = createLatestOnly();
    const pending = run(() => after(15, "gone"));
    run.cancel();
    expect(await pending).toBeNull();
    expect(run.count()).toBe(2);
  });

  it("separate runners do not invalidate each other", async () => {
    const a = createLatestOnly();
    const b = createLatestOnly();
    const first = a(() => after(20, "a"));
    const second = b(() => after(2, "b"));
    expect(await second).toBe("b");
    expect(await first).toBe("a");
  });
});

describe("createLatestOnly cancellation signal", () => {
  it("gives each run a signal that aborts when a newer run starts", async () => {
    const run = createLatestOnly();
    let firstSignal;
    const first = run(async (isStale, signal) => {
      firstSignal = signal;
      await after(10);
      return "a";
    });
    expect(firstSignal.aborted).toBe(false);
    const second = run(async (isStale, signal) => {
      expect(signal.aborted).toBe(false);
      return "b";
    });
    expect(firstSignal.aborted).toBe(true);
    expect(await second).toBe("b");
    expect(await first).toBeNull();
  });

  it("aborts the run in flight on cancel()", async () => {
    const run = createLatestOnly();
    let signal;
    const pending = run(async (isStale, s) => {
      signal = s;
      await after(5);
      return "x";
    });
    run.cancel();
    expect(signal.aborted).toBe(true);
    expect(await pending).toBeNull();
  });

  it("does not abort a run that has already finished", async () => {
    const run = createLatestOnly();
    let signal;
    await run(async (isStale, s) => {
      signal = s;
      return "done";
    });
    await run(async () => "next");
    expect(signal.aborted).toBe(false);
  });
});
