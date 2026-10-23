/**
 * Spotting a connection that is alive but unusable - the "one bar" case - without crying wolf
 * on fast Wi-Fi or LTE when an API endpoint takes a few seconds.
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
 * ⚠️ WHY A FIXED 3s THRESHOLD MISFIRED ON 50 Mbps WI-FI / 30 Mbps LTE:
 * Measured cold request to the live API is ~1.02–1.33s (~0.78s of which is TLS setup). Bandwidth
 * does not shorten a TLS handshake or server processing time. At 3,000ms a multi-request screen
 * or a single heavy endpoint crossed the threshold routinely.
 *
 * Instead of a narrow fixed constant, `InFlightTracker` learns the device's own baseline from a
 * rolling window of completed request durations (`p50 * 6`, clamped between a 6s floor and a
 * 20s ceiling), ignores long-running server endpoints while other requests are actively
 * completing on the same link, and requires `SLOW_CHECKS_BEFORE_WARN` (2) consecutive stall
 * signals before warning.
 */

/**
 * Cold-start default and minimum floor before a request's elapsed time is treated as slow.
 * ~6x the measured ~1.0s cold TLS handshake, and fits inside the 15s axios timeout with two
 * stall probes (`6_000 + 4_000 * 2 = 14_000 < 15_000`).
 */
export const SLOW_REQUEST_MS = 6_000;

/** Floor and ceiling for the adaptive threshold (`p50 * BASELINE_MULTIPLIER`). */
export const MIN_SLOW_REQUEST_MS = 6_000;
export const MAX_SLOW_REQUEST_MS = 20_000;

/**
 * Ceiling specifically for the in-flight stall watcher so at least two stall checks (`watchMs +
 * PROBE_STALL_INTERVAL_MS * 2`) always fit inside the 15s axios request timeout.
 */
export const MAX_STALL_WATCH_MS = 6_500;

/** Multiplier applied to the observed median (`p50`) request duration. */
export const BASELINE_MULTIPLIER = 6;

/** Rolling window of recent completed request durations kept per device/session. */
export const BASELINE_WINDOW_SIZE = 20;

/** Minimum completed samples required before adapting away from `SLOW_REQUEST_MS`. */
export const MIN_BASELINE_SAMPLES = 3;

/** Consecutive slow/stall checks required before raising a "Weak connection" probe. */
export const SLOW_CHECKS_BEFORE_WARN = 2;

/**
 * How long the UI waits before telling the rep anything.
 *
 * Deliberately longer than SLOW_REQUEST_MS: by the time this fires the probe has had a chance
 * to resolve, so the message can say which of "slow" or "offline" it is rather than guessing.
 */
export const SLOW_UI_HINT_MS = 7_000;

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

/** Compute the median (`p50`) of a list of duration samples, or `null` when empty. */
export const computeMedian = (values: readonly number[]): number | null => {
  const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export interface AdaptiveThresholdOptions {
  floorMs?: number;
  ceilingMs?: number;
  multiplier?: number;
  defaultMs?: number;
  minSamples?: number;
}

/**
 * Compute the adaptive slow-request threshold from observed completion durations.
 * Falls back to `defaultMs` (`SLOW_REQUEST_MS`) until `minSamples` have been collected.
 */
export const computeAdaptiveThreshold = (
  samples: readonly number[],
  opts: AdaptiveThresholdOptions = {}
): number => {
  const {
    floorMs = MIN_SLOW_REQUEST_MS,
    ceilingMs = MAX_SLOW_REQUEST_MS,
    multiplier = BASELINE_MULTIPLIER,
    defaultMs = SLOW_REQUEST_MS,
    minSamples = MIN_BASELINE_SAMPLES,
  } = opts;
  const valid = samples.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (valid.length < minSamples) {
    return Math.min(Math.max(defaultMs, floorMs), ceilingMs);
  }
  const p50 = computeMedian(valid);
  if (p50 === null) return Math.min(Math.max(defaultMs, floorMs), ceilingMs);
  const raw = Math.round(p50 * multiplier);
  return Math.min(Math.max(raw, floorMs), ceilingMs);
};

/**
 * Track in-flight requests AND rolling completion durations so a genuine stall can be noticed
 * while it happens without mistaking a heavy backend endpoint on a fast link for a weak radio.
 *
 * Deliberately tiny and synchronous: it runs in the axios interceptors on every request in the
 * app, so it must not allocate per tick or hold anything after a request settles.
 */
export class InFlightTracker {
  private started = new Map<number, number>();
  private seq = 0;
  private samples: number[] = [];
  private lastCompletedAt: number | null = null;
  private consecutiveSlowChecks = 0;

  begin(now: number): number {
    this.seq += 1;
    this.started.set(this.seq, now);
    return this.seq;
  }

  /**
   * Mark request `id` finished. When `now` is supplied and `recordSample` is true (the server
   * actually answered), records the elapsed duration in the rolling baseline window, stamps
   * `lastCompletedAt`, and clears any consecutive stall count.
   */
  end(id: number, now?: number, recordSample: boolean = true): number | null {
    const startedAt = this.started.get(id);
    this.started.delete(id);
    if (this.started.size === 0) {
      this.consecutiveSlowChecks = 0;
    }
    if (startedAt === undefined || typeof now !== 'number' || !Number.isFinite(now)) {
      return null;
    }
    const duration = Math.max(0, now - startedAt);
    if (recordSample) {
      this.samples.push(duration);
      if (this.samples.length > BASELINE_WINDOW_SIZE) {
        this.samples.shift();
      }
      this.lastCompletedAt = now;
      this.consecutiveSlowChecks = 0;
    }
    return duration;
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

  /** Observed median (`p50`) completion time in ms, or `null` when no samples exist yet. */
  get baselineMedianMs(): number | null {
    return computeMedian(this.samples);
  }

  /** Number of completion samples currently in the rolling window. */
  get sampleCount(): number {
    return this.samples.length;
  }

  /** Consecutive stall checks observed without a completion in between. */
  get slowCheckCount(): number {
    return this.consecutiveSlowChecks;
  }

  /** Adaptive threshold (`p50 * 6`, clamped to `[MIN_SLOW_REQUEST_MS, ceilingMs]`). */
  adaptiveThresholdMs(ceilingMs: number = MAX_SLOW_REQUEST_MS): number {
    return computeAdaptiveThreshold(this.samples, {
      floorMs: MIN_SLOW_REQUEST_MS,
      ceilingMs,
    });
  }

  /** Adaptive stall-watcher delay that still guarantees two probes inside the 15s timeout. */
  stallWatchMs(): number {
    return this.adaptiveThresholdMs(MAX_STALL_WATCH_MS);
  }

  /** Is anything in flight past `thresholdMs` right now? */
  hasSlowRequest(now: number, thresholdMs: number = SLOW_REQUEST_MS): boolean {
    const oldest = this.oldestAge(now);
    return oldest !== null && oldest >= thresholdMs;
  }

  /**
   * Is the CHANNEL itself stalled (as opposed to one slow server endpoint while other requests
   * on the same connection are completing normally)?
   */
  isChannelStalled(now: number, thresholdMs: number = this.stallWatchMs()): boolean {
    if (!this.hasSlowRequest(now, thresholdMs)) return false;
    if (this.lastCompletedAt !== null && now - this.lastCompletedAt < thresholdMs) {
      return false;
    }
    return true;
  }

  /**
   * Record one periodic stall check. Returns `true` only once `SLOW_CHECKS_BEFORE_WARN` (2)
   * consecutive checks find the channel stalled without any request completing in between.
   */
  recordSlowCheck(now: number, thresholdMs: number = this.stallWatchMs()): boolean {
    if (!this.isChannelStalled(now, thresholdMs)) {
      this.consecutiveSlowChecks = 0;
      return false;
    }
    this.consecutiveSlowChecks += 1;
    return this.consecutiveSlowChecks >= SLOW_CHECKS_BEFORE_WARN;
  }

  get size(): number {
    return this.started.size;
  }

  clear(): void {
    this.started.clear();
    this.samples = [];
    this.lastCompletedAt = null;
    this.consecutiveSlowChecks = 0;
  }
}

