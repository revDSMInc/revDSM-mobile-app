/**
 * network-status.ts — the three-state network model, as pure rules.
 *
 * `connectivity-state.ts` answers "does the OS report a link?". This answers the harder question
 * the client's requirement actually needs: **can the app depend on the network right now?**
 *
 * ⚠️ **A slow API is NOT a bad network, and conflating them is the trap this file exists to
 * avoid.** revDSM has endpoints that are legitimately slow — `POST /rev-render/v1/batches` is
 * ~30 s of image generation, `PUT lead/v1/{id}/images` is a multi-MB upload. An earlier attempt
 * inferred link health from business-request timeouts and was reverted for exactly this reason: a
 * rep on good Wi-Fi triggering a render must not have the app conclude the network is broken.
 *
 * The evidence is instead a dedicated `GET /health` probe (unauthenticated, no DB, ~40 ms) that
 * runs ONLY after a request has already failed. Nothing polls. See
 * `docs/claude/health-probe-mobile-guide.md`.
 *
 * Pure and RN-free so the transitions can be tested without NetInfo, axios or fetch;
 * `services/connectivity.ts` owns the wiring, and `services/health-probe.ts` owns the request.
 */

export type NetworkStatus = 'unknown' | 'online' | 'degraded' | 'offline';

/**
 * What a finished request tells us about the LINK — not about the server's workload.
 *
 * ⚠️ `serverError` (5xx) is reachability EVIDENCE, not a failure: the request got to the server
 * and came back. Treating it as a network problem would drop a rep into offline mode because of a
 * backend bug, and then serve them stale data on a perfectly good connection.
 */
export type RequestSignal =
  | 'success'        // 2xx — proof the API is reachable AND serving
  | 'authError'      // 401/403 — a token problem, says nothing about the link
  | 'clientError'    // other 4xx — the request was wrong; the network delivered it fine
  | 'serverError'    // 5xx — we REACHED the server; link is fine
  | 'transportError'; // timeout, DNS, TLS, connection refused — the only network evidence

/** Does this outcome justify spending a probe? Only a transport failure does. */
export const shouldProbe = (signal: RequestSignal): boolean => signal === 'transportError';

/**
 * Minimum time in a state before another transition is allowed.
 *
 * ⚠️ Without this a lift ride flips the banner repeatedly, and every flip restarts the sync
 * drains. The spec asks for ~5 s.
 */
export const MIN_DWELL_MS = 5_000;

/** Consecutive transport failures before leaving `online`. One slow moment is not evidence. */
export const FAILURES_BEFORE_LEAVING_ONLINE = 2;

export interface NetworkState {
  status: NetworkStatus;
  /** Consecutive transport failures since the last success. */
  failures: number;
  /** When `status` was last changed — drives `MIN_DWELL_MS`. */
  changedAt: number;
}

export const initialNetworkState = (now: number = Date.now()): NetworkState => ({
  status: 'unknown',
  failures: 0,
  changedAt: now,
});

const settle = (
  state: NetworkState,
  next: NetworkStatus,
  now: number,
  { force = false }: { force?: boolean } = {}
): NetworkState => {
  if (state.status === next) return state;
  // ⚠️ Dwell is NOT applied when going to `offline` from a probe failure, nor when leaving
  // `unknown`: the first is hard evidence we must act on, and the second is the startup
  // transition that every other rule depends on.
  if (!force && state.status !== 'unknown' && now - state.changedAt < MIN_DWELL_MS) return state;
  return { ...state, status: next, changedAt: now };
};

/**
 * Fold in a finished request.
 *
 * ⚠️ A SUCCESS is the only thing that promotes to `online`. A `200` from `/health` proves the
 * host is reachable, not that the API is serving — so the probe can move us to `degraded` but
 * never to `online`. That asymmetry is deliberate and is in the backend's own guide.
 */
export const applyRequestSignal = (
  state: NetworkState,
  signal: RequestSignal,
  now: number = Date.now()
): NetworkState => {
  // Anything that came back from the server proves the link carries traffic.
  if (signal === 'success' || signal === 'serverError') {
    const cleared = { ...state, failures: 0 };
    // Only a real 2xx promotes all the way to `online`; a 5xx says "reachable", so it is enough
    // to leave `offline` but not to claim the API is serving.
    if (signal === 'success') return settle(cleared, 'online', now, { force: true });
    return cleared.status === 'offline' ? settle(cleared, 'degraded', now, { force: true }) : cleared;
  }

  // Auth and client errors are not network evidence in either direction.
  if (signal === 'authError' || signal === 'clientError') return state;

  const failures = state.failures + 1;
  // Hold `online` until there is a run of failures — the caller probes once this trips.
  if (state.status === 'online' && failures < FAILURES_BEFORE_LEAVING_ONLINE) {
    return { ...state, failures };
  }
  return { ...state, failures };
};

/**
 * Fold in a probe result.
 *
 *   `/health` answered  → the host is reachable, so the failing request was the SERVER or that
 *                         one call: `degraded`.
 *   `/health` timed out → nothing is reachable: `offline`.
 */
export const applyProbeResult = (
  state: NetworkState,
  reachable: boolean,
  now: number = Date.now()
): NetworkState =>
  reachable
    ? settle(state, 'degraded', now)
    // Forced: a failed probe is the strongest evidence available and must not wait out dwell.
    : settle(state, 'offline', now, { force: true });

/** The OS reporting no interface at all. Immediate — there is nothing to probe. */
export const applyOsDisconnected = (
  state: NetworkState,
  now: number = Date.now()
): NetworkState => settle({ ...state, failures: 0 }, 'offline', now, { force: true });

/**
 * The OS reporting an interface again.
 *
 * ⚠️ Goes to `degraded`, never straight to `online`. "Wi-Fi is connected" is precisely the claim
 * that cannot be trusted — a captive portal reports exactly this. Only a real request succeeding
 * promotes to `online`.
 */
export const applyOsConnected = (
  state: NetworkState,
  now: number = Date.now()
): NetworkState =>
  state.status === 'online' ? state : settle(state, 'degraded', now, { force: true });

/**
 * What the UI and the screens should behave as.
 *
 * ⚠️ `degraded` counts as offline HERE, for screens — a rep should not wait on a link that is
 * not serving. The sync queues deliberately read something else: they must still ATTEMPT on a
 * degraded link, because a real success is the only thing that can restore `online`. If the
 * queues stopped trying, the app could never leave `degraded`.
 */
export const isEffectivelyOffline = (status: NetworkStatus): boolean =>
  status === 'offline' || status === 'degraded';

/** Whether a sync queue should try. `unknown` is optimistic — see `connectivity-state.ts`. */
export const shouldAttemptSync = (status: NetworkStatus): boolean => status !== 'offline';
