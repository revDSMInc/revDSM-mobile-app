import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import {
  resolveOnline,
  transitionDelayMs,
  type ConnectivitySnapshot,
} from '../utils/connectivity-state';
import {
  applyOsConnected,
  applyOsDisconnected,
  applyProbeResult,
  applyRequestSignal,
  FAILURES_BEFORE_LEAVING_ONLINE,
  initialNetworkState,
  isEffectivelyOffline as computeEffectivelyOffline,
  shouldAttemptSync,
  shouldProbe,
  type NetworkState,
  type NetworkStatus,
  type RequestSignal,
} from '../utils/network-status';
import { HEALTH_URL, PROBE_STALL_INTERVAL_MS, probeHealthThrottled } from './health-probe';
import { InFlightTracker, SLOW_REQUEST_MS, isProbeUrl } from '../utils/slow-request';

type ConnectivityListener = (online: boolean) => void;
type WifiListener = (wifi: boolean) => void;

let currentOnline = true;
let onlineSince: number | null = Date.now();
let currentWifi = false;
let lastNetInfoType: string = 'unknown';
let monitorStarted = false;
let unsubscribeNetInfo: (() => void) | null = null;
let pendingTransition: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<ConnectivityListener>();
const reconnectListeners = new Set<() => void>();
const wifiReconnectListeners = new Set<() => void>();

const clearPending = () => {
  if (pendingTransition) {
    clearTimeout(pendingTransition);
    pendingTransition = null;
  }
};

const commit = (nextOnline: boolean) => {
  if (nextOnline === currentOnline) return;
  const cameBackOnline = nextOnline && !currentOnline;
  currentOnline = nextOnline;
  onlineSince = nextOnline ? Date.now() : null;

  setNetState(
    nextOnline
      ? applyOsConnected(netState, Date.now())
      : applyOsDisconnected(netState, Date.now())
  );

  listeners.forEach((l) => {
    try {
      l(nextOnline);
    } catch (e) {
      console.warn('[connectivity] listener threw:', e);
    }
  });

  if (cameBackOnline) {
    reconnectListeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.warn('[connectivity] reconnect listener threw:', e);
      }
    });
  }
};

const applySnapshot = (snapshot: ConnectivitySnapshot | null | undefined) => {
  const nextOnline = resolveOnline(snapshot);
  const nextType = (snapshot as any)?.type ?? 'unknown';
  const nextWifi = nextType === 'wifi';

  const cameOnWifi = nextWifi && !currentWifi;

  if (nextOnline === currentOnline && nextWifi === currentWifi) {
    clearPending();
    return;
  }

  const delay = transitionDelayMs(nextOnline);
  if (delay === 0) {
    clearPending();
    if (nextOnline !== currentOnline) {
      commit(nextOnline);
    }
    if (nextWifi !== currentWifi) {
      currentWifi = nextWifi;
      lastNetInfoType = nextType;
      if (cameOnWifi) {
        wifiReconnectListeners.forEach((l) => {
          try { l(); } catch (e) { console.warn('[connectivity] wifi listener threw:', e); }
        });
      }
    }
    return;
  }

  clearPending();
  pendingTransition = setTimeout(() => {
    pendingTransition = null;
    commit(nextOnline);
    if (nextWifi !== currentWifi) {
      currentWifi = nextWifi;
      lastNetInfoType = nextType;
      if (cameOnWifi) {
        wifiReconnectListeners.forEach((l) => {
          try { l(); } catch (e) { console.warn('[connectivity] wifi listener threw:', e); }
        });
      }
    }
  }, delay);
};

/**
 * How long NetInfo waits on its own reachability request before calling it a failure.
 *
 * ⚠️ Must clear a cold TLS handshake on a weak cell (measured 1.0-2.4 s on a GOOD line, and
 * the handshake is most of it). NetInfo's default is 15 s, which is far longer than anything the
 * rep will wait, and its failure force-settles the app to OFFLINE.
 */
const REACHABILITY_TIMEOUT_MS = 8_000;

/** Re-check interval once reachability has FAILED - a rep walking back into signal. */
const REACHABILITY_RETRY_MS = 10_000;

/** Re-check interval while everything is fine. Rare: our own requests are the real signal. */
const REACHABILITY_OK_MS = 60_000;

/**
 * Point NetInfo's reachability check at OUR backend.
 *
 * ⚠️ THIS WAS NEVER CONFIGURED, and the default is
 * `https://clients3.google.com/generate_204`. So the app's offline banner was driven by whether
 * GOOGLE answers, not whether our API does. On a rep's cellular connection that is wrong in both
 * directions:
 *
 *  - a carrier that blocks, throttles or intercepts that Google endpoint (it is a well-known
 *    captive-portal probe) marks the app OFFLINE while our API is perfectly reachable;
 *  - Google answering says nothing about our backend, so the app can insist it is online while
 *    every real request fails.
 *
 * `isInternetReachable === false` flows through `resolveOnline` into `applyOsDisconnected`, which
 * force-settles to offline past the dwell - so a wrong answer here is not a hint, it is a verdict.
 *
 * ⚠️ Keep this in step with `health-probe.ts`: both must ask the SAME url, or the two halves
 * of connectivity can disagree about whether the rep is online.
 */
const configureReachability = (): void => {
  try {
    NetInfo.configure({
      reachabilityUrl: HEALTH_URL,
      reachabilityMethod: 'GET',
      reachabilityHeaders: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      // A 200 from our own /health is the only thing that counts as "the internet works".
      reachabilityTest: async (response) => response.status === 200,
      reachabilityRequestTimeout: REACHABILITY_TIMEOUT_MS,
      reachabilityShortTimeout: REACHABILITY_RETRY_MS,
      reachabilityLongTimeout: REACHABILITY_OK_MS,
      // ⚠️ Android's native reachability reports the OS's own captive-portal verdict, which
      // is about the INTERNET, not about us. Our url is the only authority we want.
      useNativeReachability: false,
    });
  } catch (e) {
    // A failure here leaves NetInfo on its defaults - degraded, but still working.
    console.warn('[connectivity] NetInfo.configure failed:', e);
  }
};

export const startConnectivityMonitor = (): void => {
  if (monitorStarted) return;
  monitorStarted = true;

  // Arm the poll for whatever state we are already in at startup.
  syncRecoveryPoll();

  // Before the listener, so the first state NetInfo reports already used our url.
  configureReachability();

  unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
    applySnapshot(state);
  });

  NetInfo.fetch()
    .then(applySnapshot)
    .catch((e) => console.warn('[connectivity] initial fetch failed:', e));
};

export const stopConnectivityMonitor = (): void => {
  clearPending();
  unsubscribeNetInfo?.();
  unsubscribeNetInfo = null;
  monitorStarted = false;
};

export const isOnline = (): boolean => currentOnline;

export const STABLE_CONNECTION_MS = 10_000;

export const isConnectionStable = (minMs: number = STABLE_CONNECTION_MS): boolean =>
  currentOnline && onlineSince !== null && Date.now() - onlineSince >= minMs;

let netState: NetworkState = initialNetworkState();
const statusListeners = new Set<(status: NetworkStatus) => void>();

const setNetState = (next: NetworkState) => {
  if (next === netState || next.status === netState.status) {
    netState = next;
    // ⚠️ The poll must be kept in step even when the STATUS did not change. It used to be
    // armed only on a transition, so an app that settled into `degraded` and then stopped
    // changing never started polling - nothing asked whether the line had recovered, and
    // "Weak connection" stayed on screen indefinitely on a perfectly good connection.
    syncRecoveryPoll();
    return;
  }
  const previous = netState.status;
  netState = next;
  console.log(`[connectivity] ${previous} → ${next.status}`);
  statusListeners.forEach((l) => {
    try {
      l(next.status);
    } catch (e) {
      console.warn('[connectivity] status listener threw:', e);
    }
  });
  syncRecoveryPoll();
  if (next.status === 'online' && previous !== 'online') {
    reconnectListeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.warn('[connectivity] reconnect listener threw:', e);
      }
    });
  }
};

export const classifyRequestError = (error: any): RequestSignal => {
  const status = error?.response?.status;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'authError';
    if (status >= 500) return 'serverError';
    return 'clientError';
  }
  return 'transportError';
};

/**
 * Requests currently open, so a STALL can be judged while it is happening.
 *
 * ⚠️ The reason this exists. `reportRequestSignal` runs in the axios interceptors, which a
 * hanging request never reaches - so on one bar no signal is ever reported and the `/health`
 * probe that would rescue the rep never runs. Waiting for a request to end before judging the
 * connection cannot detect the one case where requests do not end.
 */
const inFlight = new InFlightTracker();
let slowTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Probe now, and let the result move the state. Shared by the stall and failure paths.
 *
 * `stalled` relaxes the throttle: while a request is genuinely hanging we need another look
 * within the timeout window, not in twenty seconds' time.
 */
const probeAndApply = async (stalled = false): Promise<void> => {
  const reachable = await probeHealthThrottled(
    Date.now(),
    stalled ? PROBE_STALL_INTERVAL_MS : undefined
  );
  if (reachable === null) return; // throttled; keep the current state
  setNetState(applyProbeResult(netState, reachable, Date.now()));
};

/**
 * While the strip is showing, keep checking whether it still should be.
 *
 * ⚠️ Nothing else can clear it, and this is the bug the client hit from the other side:
 * `applyOsConnected` only ever reaches `degraded`, and ONLY a 2xx on a real request promotes
 * to `online`. An idle app makes no requests - so a rep who walked back into signal kept
 * "Weak connection" (or worse, "Offline") until they happened to tap something.
 *
 * ⚠️ It must be a REAL authenticated call, not `/health`. A probe cannot promote to online
 * by design: /health is cheap and unauthenticated, so it answers while the API is failing.
 * `getMe` goes through axios, so its 2xx arrives as a normal `success` signal and recovery
 * happens through the one sanctioned path rather than a second rule that could disagree.
 *
 * The poll exists ONLY while a warning is up; a healthy app pays nothing for it.
 */
export const RECOVERY_POLL_MS = 8_000;

let recoveryTimer: ReturnType<typeof setInterval> | null = null;

const recoveryCheck = async (): Promise<void> => {
  try {
    const { AuthService } = await import('./api/auth');
    await AuthService.getMe();
    // A 2xx already reported `success` through the interceptor - nothing to do here.
  } catch {
    // The interceptor reported the failure too. Swallow: this is a background check and an
    // unhandled rejection here would surface as a crash on a bad line.
  }
};

const syncRecoveryPoll = (): void => {
  const warning = netState.status === 'offline' || netState.status === 'degraded';
  if (warning && !recoveryTimer) {
    recoveryTimer = setInterval(() => {
      void recoveryCheck();
    }, RECOVERY_POLL_MS);
  } else if (!warning && recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
};

const clearSlowTimer = (): void => {
  if (slowTimer) {
    clearTimeout(slowTimer);
    slowTimer = null;
  }
};

/**
 * One request went out. Returns the id to hand back to `endRequest`.
 *
 * The timer is armed once for the whole batch rather than per request: it only has to notice
 * that SOMETHING is stuck, and a timer per request on a busy screen is pure overhead.
 */
const armSlowTimer = (): void => {
  if (slowTimer) return;
  slowTimer = setTimeout(() => {
    slowTimer = null;
    if (!inFlight.hasSlowRequest(Date.now())) return;
    void probeAndApply(true);
    // ⚠️ KEEP WATCHING while the request is still stuck. The first probe is the one most
    // likely to be lost on a weak radio, and nothing else re-arms this: the screen is blocked,
    // so no new request comes through `beginRequest` to start another timer. Without this the
    // rep gets ONE chance at a banner per stall.
    armSlowTimer();
  }, SLOW_REQUEST_MS);
};

export const beginRequest = (url?: string | null): number | null => {
  if (isProbeUrl(url)) return null; // never measure the probe with itself
  const id = inFlight.begin(Date.now());
  armSlowTimer();
  return id;
};

export const endRequest = (id: number | null): void => {
  if (id === null) return;
  inFlight.end(id);
  if (inFlight.size === 0) clearSlowTimer();
};

export const __resetInFlight = (): void => {
  inFlight.clear();
  clearSlowTimer();
};

export const reportRequestSignal = (signal: RequestSignal): void => {
  setNetState(applyRequestSignal(netState, signal, Date.now()));

  if (!shouldProbe(signal)) return;
  if (netState.status === 'online' && netState.failures < FAILURES_BEFORE_LEAVING_ONLINE) return;
  void probeAndApply();
};

export const getNetworkStatus = (): NetworkStatus => netState.status;

export const isEffectivelyOffline = (): boolean => computeEffectivelyOffline(netState.status);

export const canAttemptSync = (): boolean => shouldAttemptSync(netState.status);

export const subscribeNetworkStatus = (
  listener: (status: NetworkStatus) => void
): (() => void) => {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
};

export const recheckNetworkNow = async (): Promise<NetworkStatus> => {
  const { probeHealthNow } = await import('./health-probe');
  setNetState(applyProbeResult(netState, await probeHealthNow(), Date.now()));
  return netState.status;
};

export const __resetNetworkStatus = (): void => {
  netState = initialNetworkState();
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
};

export const subscribeConnectivity = (listener: ConnectivityListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const onReconnect = (listener: () => void): (() => void) => {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
};

export const refreshConnectivity = async (): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    applySnapshot(state);
    return resolveOnline(state);
  } catch (e) {
    console.warn('[connectivity] refresh failed:', e);
    return currentOnline;
  }
};

export const isOnWifi = (): boolean => currentWifi;

export const subscribeWifiStatus = (listener: WifiListener): (() => void) => {
  try { listener(currentWifi); } catch (e) { console.warn('[connectivity] wifi subscriber threw:', e); }
  const wrapped = () => { try { listener(currentWifi); } catch (e) { console.warn('[connectivity] wifi subscriber threw:', e); } };
  wifiReconnectListeners.add(wrapped);
  return () => { wifiReconnectListeners.delete(wrapped); };
};

export const onWifiReconnect = (listener: () => void): (() => void) => {
  wifiReconnectListeners.add(listener);
  return () => {
    wifiReconnectListeners.delete(listener);
  };
};
