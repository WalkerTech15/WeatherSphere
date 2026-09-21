/* "Only the newest request may finish" — a request-token race guard.
 *
 * Rapid map clicks are the motivating case: click A over the Atlantic, then
 * click B over Paris a moment later. If A's reverse geocoding is slower than
 * B's, A must not land afterwards and repaint the panel with the ocean. A
 * token taken before the first await, rechecked after every one, is what makes
 * "the last thing you clicked is what you see" true regardless of network
 * timing.
 *
 * The task receives `isStale` so it can also bail early — between two awaits —
 * instead of doing the rest of the work and having its result discarded. It
 * also receives an AbortSignal that fires the moment the run is superseded,
 * so a task that passes it to fetch() stops downloading an answer nobody
 * will use. Tasks that ignore it behave exactly as before.
 *
 * No DOM, no timers, no globals: one runner per concurrent activity. */

export function createLatestOnly() {
  let token = 0;
  let controller = null;

  function supersede() {
    token++;
    controller?.abort();
    controller = null;
  }

  /**
   * @param {(isStale: () => boolean, signal: AbortSignal) => Promise<any>} task
   * @returns {Promise<any|null>} the task's result, or null if superseded
   */
  async function run(task) {
    supersede();
    const mine = token;
    const own = new AbortController();
    controller = own;
    const isStale = () => mine !== token;
    try {
      const result = await task(isStale, own.signal);
      return isStale() ? null : result;
    } finally {
      if (controller === own) controller = null;
    }
  }

  /** How many runs have been started — useful for assertions and diagnostics. */
  run.count = () => token;
  /** Invalidate (and abort) anything in flight without starting a new run. */
  run.cancel = supersede;

  return run;
}
