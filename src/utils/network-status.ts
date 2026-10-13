export type NetworkStatus = 'unknown' | 'online' | 'degraded' | 'offline';

export type RequestSignal =
  | 'success'        // 2xx — proof the API is reachable AND serving
  | 'authError'      // 401/403 — a token problem, says nothing about the link
  | 'clientError'    // other 4xx — the request was wrong; the network delivered it fine
  | 'serverError'    // 5xx — we REACHED the server; link is fine
  | 'transportError'; // timeout, DNS, TLS, connection refused — the only network evidence

export const shouldProbe = (signal: RequestSignal): boolean => signal === 'transportError';

export const MIN_DWELL_MS = 5_000;

export const FAILURES_BEFORE_LEAVING_ONLINE = 2;

export interface NetworkState {
  status: NetworkStatus;
  failures: number;
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
  if (!force && state.status !== 'unknown' && now - state.changedAt < MIN_DWELL_MS) return state;
  return { ...state, status: next, changedAt: now };
};

export const applyRequestSignal = (
  state: NetworkState,
  signal: RequestSignal,
  now: number = Date.now()
): NetworkState => {
  if (signal === 'success' || signal === 'serverError') {
    const cleared = { ...state, failures: 0 };
    if (signal === 'success') return settle(cleared, 'online', now, { force: true });
    return cleared.status === 'offline' ? settle(cleared, 'degraded', now, { force: true }) : cleared;
  }

  if (signal === 'authError' || signal === 'clientError') return state;

  const failures = state.failures + 1;
  if (state.status === 'online' && failures < FAILURES_BEFORE_LEAVING_ONLINE) {
    return { ...state, failures };
  }
  return { ...state, failures };
};

/** What a probe found: quick, reachable-but-crawling, or nothing there. */
export type ProbeOutcome = boolean | 'slow';

/**
 * ⚠️ `false` means UNREACHABLE, not "slow". It force-settles to offline, skipping the dwell,
 * so anything that cannot tell the two apart must not report `false` - that is how a rep on a
 * working-but-weak line gets told they are offline. `'slow'` is the honest answer there.
 * `probeHealth` therefore retries before it ever returns `false`.
 *
 * ⚠️ A probe NEVER promotes to online, however healthy it looks. /health is cheap and
 * unauthenticated, so it answers happily while the real API is failing - only a 2xx on a real
 * request proves we are being SERVED. What a healthy probe does do is clear the failure run,
 * so the next transport error starts counting from scratch instead of re-settling instantly.
 */
export const applyProbeResult = (
  state: NetworkState,
  reachable: ProbeOutcome,
  now: number = Date.now()
): NetworkState => {
  if (reachable === false) return settle(state, 'offline', now, { force: true });
  // Reachable at all means the rep can still work; the line is just not healthy.
  return settle(reachable === true ? { ...state, failures: 0 } : state, 'degraded', now);
};

export const applyOsDisconnected = (
  state: NetworkState,
  now: number = Date.now()
): NetworkState => settle({ ...state, failures: 0 }, 'offline', now, { force: true });

export const applyOsConnected = (
  state: NetworkState,
  now: number = Date.now()
): NetworkState =>
  state.status === 'online' ? state : settle(state, 'degraded', now, { force: true });

export const isEffectivelyOffline = (status: NetworkStatus): boolean =>
  status === 'offline' || status === 'degraded';

export const shouldAttemptSync = (status: NetworkStatus): boolean => status !== 'offline';
