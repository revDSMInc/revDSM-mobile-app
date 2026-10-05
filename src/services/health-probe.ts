/**
 * health-probe.ts — `GET /health`, the only thing allowed to judge reachability.
 *
 * Unauthenticated, no database, ~40 ms server-side. Spec and rationale:
 * `docs/claude/health-probe-mobile-guide.md`.
 *
 * ⚠️ **Never polled.** It runs only after a real request has already failed at the transport
 * layer. A healthy session calls it zero times. A timer here would spend the rep's battery and
 * data confirming what the next genuine request answers for free.
 *
 * ⚠️ **Uses `fetch`, NOT the axios instance.** The instance attaches `Authorization`, runs the
 * 401 interceptor and records request outcomes — all three are wrong for a probe. A stale token
 * would turn a reachability check into a `401`, and feeding the probe's own result back into the
 * state machine would be circular.
 */

import { ENV } from '../config/env';

/** `ENV.API_URL` ends in `/`; the endpoint is at the root, with no version segment. */
const HEALTH_URL = `${ENV.API_URL.replace(/\/+$/, '')}/health`;

/** It does no work, so anything slower than this is the connection, not the server. */
export const PROBE_TIMEOUT_MS = 2_000;

/** Floor between probes while the link looks bad. */
export const PROBE_MIN_INTERVAL_MS = 20_000;

let lastProbeAt = 0;
let inFlight: Promise<boolean> | null = null;

/** Server clock minus device clock, in ms, from the last successful probe. */
let clockSkewMs: number | null = null;

/**
 * How far the device clock is from the server's.
 *
 * ⚠️ Diagnostic only — never a health signal. A phone's clock can be badly wrong (manually set,
 * dead battery, wrong timezone), and under last-write-wins "which edit was newer" is meaningless
 * if the two sides disagree about the time. Worth logging alongside a sync conflict.
 */
export const getClockSkewMs = (): number | null => clockSkewMs;

/** More than this and device timestamps should not be trusted for ordering. */
export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

export const isClockSkewed = (): boolean =>
  clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS;

/**
 * Did we reach the API? False on timeout, DNS/TLS failure, or a captive portal.
 *
 * ⚠️ **The BODY is checked, not just the status.** Hotel and airport Wi-Fi intercepts requests
 * and answers `200` with an HTML login page; a status-only check reads that as healthy and
 * strands the rep in online mode. This is also why the endpoint is fetched with GET rather than
 * the marginally cheaper HEAD — HEAD gives no body to verify.
 */
export const probeHealth = async (): Promise<boolean> => {
  // Share one in-flight probe: several requests can fail together in a burst, and they should
  // cost one probe between them, not one each.
  if (inFlight) return inFlight;

  const run = (async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: controller.signal,
        // No Authorization header — the endpoint takes none, and a stale token must not turn a
        // reachability check into a 401.
        // ⚠️ `cache: 'no-store'` is not in RN's `RequestInit` type (and RN's fetch ignores it),
        // so freshness is asked for with the header instead. The endpoint also sends
        // `Cache-Control: no-store` itself, so a cached 200 should never be served here.
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      });
      if (res.status !== 200) return false;

      const body = await res.json().catch(() => null);
      if (body?.ok !== true) return false; // captive portal, or something else answering

      if (typeof body.ts === 'number') clockSkewMs = body.ts - Date.now();
      return true;
    } catch {
      // Abort (timeout), DNS failure, TLS failure, connection refused.
      return false;
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
};

/**
 * Probe, unless one ran recently.
 *
 * Returns `null` when it is too soon — the caller keeps its current state rather than guessing.
 */
export const probeHealthThrottled = async (
  now: number = Date.now()
): Promise<boolean | null> => {
  if (now - lastProbeAt < PROBE_MIN_INTERVAL_MS) return null;
  lastProbeAt = now;
  return probeHealth();
};

/** Let a deliberate user action (pull-to-refresh, a Retry button) skip the throttle. */
export const probeHealthNow = async (): Promise<boolean> => {
  lastProbeAt = Date.now();
  return probeHealth();
};

/** Test seam. */
export const __resetHealthProbe = (): void => {
  lastProbeAt = 0;
  inFlight = null;
  clockSkewMs = null;
};
