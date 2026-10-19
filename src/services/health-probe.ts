import { ENV } from '../config/env';

/**
 * The one definition of "is our backend up". Exported so NetInfo's own reachability check uses
 * the SAME url - two different health targets would disagree about being online.
 */
export const HEALTH_URL = `${ENV.API_URL.replace(/\/+$/, '')}/health`;

/**
 * ⚠️ Was 2 s, then 6 s. Measured cold TLS to the live API is ~1.0 s on a good WIRED line and
 * the handshake is ~0.75 s of it; on one bar, or on congested Wi-Fi, it routinely multiplies.
 * A probe that aborts reports `false`, and two of those force-settle straight to OFFLINE past
 * the dwell - which is how a rep on a working line was told they had none.
 *
 * ⚠️ This is a FALSE-OFFLINE budget, not a latency target. Being slow to notice a real outage
 * costs a few seconds of queued work that drains anyway; being wrong about it strands the rep.
 * Spend the time.
 */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * Past this, the server answered but the line is too slow to work on normally.
 * Distinguishes "slow" from "dead", which the old boolean could not.
 *
 * ⚠️ MEASURE BEFORE CHANGING THIS. It was 1,500 ms, which reported "Weak connection" on a
 * wired line and on strong Wi-Fi. Measured against the live API from a good connection:
 *
 *   cold request (new TLS handshake) ... ~1.00 s   <- what a probe almost always costs
 *     of which TLS alone ............... ~0.75 s
 *   warm request (connection reused) ... ~0.25 s
 *   server processing .................. ~0.23 s
 *
 * The probe uses `fetch`, which does not share axios's connection pool, so nearly every probe
 * pays the full handshake. At 1,500 ms a perfectly healthy app sat ~500 ms from the warning,
 * and ordinary jitter crossed it. **The probe was measuring TLS setup, not link health.**
 *
 * 4,000 ms is ~4x the measured cold cost - comfortably clear of a healthy handshake, still
 * well inside PROBE_TIMEOUT_MS, and still catching a line that is genuinely crawling.
 */
export const PROBE_SLOW_MS = 4_000;

/**
 * Idle throttle: with nothing stuck, one probe per 20 s is plenty.
 */
export const PROBE_MIN_INTERVAL_MS = 20_000;

/**
 * Throttle while a request is ACTIVELY stalled.
 *
 * ⚠️ Must be well under the axios timeout (15 s) or the re-probe never happens: the idle
 * 20 s window outlives the whole stall, so the first probe would be the only one - and on a
 * weak radio the first probe is the one most likely to be lost.
 */
export const PROBE_STALL_INTERVAL_MS = 4_000;

let lastProbeAt = 0;
let inFlight: Promise<ProbeResult> | null = null;

/**
 * Diagnostics only - never used to decide anything.
 *
 * A rep saying "it showed offline" is unanswerable without these: we cannot tell a dead API from
 * one lost packet on a weak cell. Reading them out turns the report into a fact.
 */
let lastSuccessAt: number | null = null;
let lastDurationMs: number | null = null;

export const getLastHealthSuccessAt = (): number | null => lastSuccessAt;
export const getLastHealthDurationMs = (): number | null => lastDurationMs;

let clockSkewMs: number | null = null;

export const getClockSkewMs = (): number | null => clockSkewMs;

export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

export const isClockSkewed = (): boolean =>
  clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS;

/** `true` reachable and quick, `'slow'` reachable but crawling, `false` unreachable. */
export type ProbeResult = boolean | 'slow';

/**
 * How many probes in a row must come back empty before we believe the network is GONE.
 *
 * ⚠️ One lost probe is not evidence of an offline phone. On a weak radio a single GET is
 * dropped routinely while the link still works - that is exactly how a rep on LTE with two
 * bars was shown "Offline - showing saved data". `false` force-settles past the dwell, so it
 * must mean "we looked more than once and found nothing", never "one packet went missing".
 */
export const PROBE_FAILURES_BEFORE_OFFLINE = 2;

/** Gap between the attempts inside one probe. Short: the caller is waiting on this. */
export const PROBE_RETRY_GAP_MS = 400;

const attemptProbe = async (): Promise<ProbeResult> => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    });
    if (res.status !== 200) return false;

    const body = await res.json().catch(() => null);
    if (body?.ok !== true) return false; // captive portal, or something else answering

    if (typeof body.ts === 'number') clockSkewMs = body.ts - Date.now();
    const elapsed = Date.now() - startedAt;
    lastSuccessAt = Date.now();
    lastDurationMs = elapsed;
    // Reachable - but say HOW reachable, so a crawling line is not called offline.
    return elapsed >= PROBE_SLOW_MS ? 'slow' : true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const probeHealth = async (): Promise<ProbeResult> => {
  if (inFlight) return inFlight;

  const run = (async (): Promise<ProbeResult> => {
    try {
      for (let attempt = 1; attempt <= PROBE_FAILURES_BEFORE_OFFLINE; attempt += 1) {
        const result = await attemptProbe();
        // Any answer at all settles it immediately - only emptiness needs a second opinion.
        if (result !== false) return result;
        if (attempt < PROBE_FAILURES_BEFORE_OFFLINE) {
          await new Promise<void>((r) => setTimeout(() => r(), PROBE_RETRY_GAP_MS));
        }
      }
      return false;
    } finally {
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
};

export const probeHealthThrottled = async (
  now: number = Date.now(),
  minIntervalMs: number = PROBE_MIN_INTERVAL_MS
): Promise<ProbeResult | null> => {
  if (now - lastProbeAt < minIntervalMs) return null;
  lastProbeAt = now;
  return probeHealth();
};

export const probeHealthNow = async (): Promise<ProbeResult> => {
  lastProbeAt = Date.now();
  return probeHealth();
};

export const __resetHealthProbe = (): void => {
  lastProbeAt = 0;
  inFlight = null;
  clockSkewMs = null;
  lastSuccessAt = null;
  lastDurationMs = null;
};
