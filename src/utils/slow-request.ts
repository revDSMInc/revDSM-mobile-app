/**
 * Spotting a connection that is alive but unusable - the "one bar" case.
 *
 * Reported with a video: a rep on 1 bar of 5G sat on "Loading calculator..." indefinitely. The
 * app considered itself fully online the whole time, because it is: NetInfo reports
 * `isConnected: true`, the phone really is attached to a tower, and the request really did
 * open a socket. It just never finishes.
 *
 * ⚠️ ONE BAR IS WORSE THAN NO BARS, and that is the whole bug. With no signal a request fails
 * at once, the app sees `transportError`, probes `/health`, flips to offline and serves the
 * cached copy. With one bar nothing ever fails, so no signal is ever reported, so the probe
 * that would have rescued the rep cannot run. Every offline path we have is reached THROUGH
 * failure, and this connection never fails - it just stalls.
 *
 * The fix is to stop waiting for the end of a request before judging it. A request still in
 * flight after `SLOW_REQUEST_MS` is itself the evidence.
 */

/** How long a single request may run before we treat its slowness as evidence. */
export const SLOW_REQUEST_MS = 3_000;

/**
 * How long the UI waits before telling the rep anything.
 *
 * Deliberately longer than SLOW_REQUEST_MS: by the time this fires the probe has had a chance
 * to resolve, so the message can say which of "slow" or "offline" it is rather than guessing.
 */
export const SLOW_UI_HINT_MS = 4_000;

/** Requests the probe must ignore, or it measures itself and recurses. */
export const isProbeUrl = (url: string | null | undefined): boolean =>
  typeof url === 'string' && /\/health\/?($|\?)/.test(url);

/**
 * Is a request that started at `startedAt` now slow enough to judge?
 *
 * Pure so the threshold is testable without a socket; the caller owns the clock.
 */
export const isRequestSlow = (
  startedAt: number,
  now: number,
  thresholdMs: number = SLOW_REQUEST_MS
): boolean => now - startedAt >= thresholdMs;

/**
 * Track in-flight requests so a stall can be noticed WHILE it happens.
 *
 * Deliberately tiny and synchronous: it runs in the axios interceptors on every request in the
 * app, so it must not allocate per tick or hold anything after a request settles.
 */
export class InFlightTracker {
  private started = new Map<number, number>();
  private seq = 0;

  begin(now: number): number {
    this.seq += 1;
    this.started.set(this.seq, now);
    return this.seq;
  }

  end(id: number): void {
    this.started.delete(id);
  }

  /** The age of the request that has been waiting longest, or null when idle. */
  oldestAge(now: number): number | null {
    let oldest: number | null = null;
    for (const startedAt of this.started.values()) {
      const age = now - startedAt;
      if (oldest === null || age > oldest) oldest = age;
    }
    return oldest;
  }

  /** Is anything stalled right now? The signal that replaces "wait for it to fail". */
  hasSlowRequest(now: number, thresholdMs: number = SLOW_REQUEST_MS): boolean {
    const oldest = this.oldestAge(now);
    return oldest !== null && oldest >= thresholdMs;
  }

  get size(): number {
    return this.started.size;
  }

  clear(): void {
    this.started.clear();
  }
}
