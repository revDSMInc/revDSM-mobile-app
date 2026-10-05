/**
 * connectivity.ts — the app's SINGLE source of truth for "are we online?".
 *
 * Before this existed the app could only discover it was offline by FAILING a request first
 * (`utils/network-error.ts › isNetworkError`, which classifies a rejection after the fact). That is
 * enough to show an error and not enough for anything else: nothing could render an offline state
 * up front, disable an action that cannot work, or — the important one — notice the moment signal
 * comes back and start syncing.
 *
 * ⚠️ This replaces `offlineUploadManager.checkOnlineStatus()`, which pinged `google.com` on a timer.
 * Three things were wrong with that: it asked a third party whether OUR API is reachable, it cost a
 * request every tick whether or not anything had changed, and being a poll it could not detect the
 * reconnect EDGE, which is the only event a sync scheduler actually cares about.
 *
 * The decision rules live in `utils/connectivity-state.ts` so they can be tested without the native
 * module; this file is the subscription, the debounce and the fan-out.
 */

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
import { probeHealthThrottled } from './health-probe';

type ConnectivityListener = (online: boolean) => void;
type WifiListener = (wifi: boolean) => void;

/**
 * Optimistic until NetInfo reports. See `resolveOnline` — a cold start must not flash "offline"
 * before the first reachability probe lands.
 */
let currentOnline = true;
/**
 * When the CURRENT online stretch began. Null while offline.
 *
 * Seeded at module load rather than left null, so a request made before the first NetInfo event
 * is judged against a real duration instead of reading as "just reconnected".
 */
let onlineSince: number | null = Date.now();
/** Whether the device is currently on Wi-Fi (NetInfo type === 'wifi'). */
let currentWifi = false;
let lastNetInfoType: string = 'unknown';
let monitorStarted = false;
let unsubscribeNetInfo: (() => void) | null = null;
let pendingTransition: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<ConnectivityListener>();
/** Fired only on the offline→online EDGE. This is what drives the sync drains. */
const reconnectListeners = new Set<() => void>();
/** Fired when the device transitions to Wi-Fi (for offline map auto-download). */
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

  // ⚠️ The OS losing the interface is immediate and needs no probe — there is nothing to reach.
  // The OS REGAINING it only gets us to `degraded`: "Wi-Fi connected" is precisely the claim a
  // captive portal makes, so `online` is still reserved for a real request succeeding.
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

  // Detect Wi-Fi transition (non-wifi → wifi).
  const cameOnWifi = nextWifi && !currentWifi;

  // Already heading there, or already there — nothing to schedule.
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
    // Wi-Fi state updates immediately (no debounce) — it's a transport hint,
    // not a connectivity verdict that affects the session.
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

  // A drop must persist before we act on it. Re-arming on every event is deliberate: a flap that
  // resolves within the window never reaches `commit` at all.
  clearPending();
  pendingTransition = setTimeout(() => {
    pendingTransition = null;
    commit(nextOnline);
    // Wi-Fi state updates alongside connectivity.
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
 * Start the single app-wide subscription. Idempotent — safe to call from a remount.
 * Called once from `useAppInitialization`.
 */
export const startConnectivityMonitor = (): void => {
  if (monitorStarted) return;
  monitorStarted = true;

  unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
    applySnapshot(state);
  });

  // `addEventListener` does not fire until something CHANGES, so a device that is already offline
  // at launch would sit reported as online until it moved. Seed from an explicit read.
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

/** Synchronous read. Cheap — no request, no promise. */
export const isOnline = (): boolean => currentOnline;

/**
 * How long a caller should require the connection to have been up before it trusts a hostile
 * answer from the server. See `isConnectionStable`.
 */
export const STABLE_CONNECTION_MS = 10_000;

/**
 * Online, and has been for a while.
 *
 * ⚠️ This exists for ONE job: deciding whether a `401` is real. A rep who has been offline all day
 * and catches five seconds of signal will fire a queued request on a token the backend may have
 * superseded — and the naive reading of that `401` is a full sign-out, which strands them on a
 * login screen they cannot pass and (once there is an outbox) risks their day's work.
 *
 * A momentary reconnect is not enough evidence to end a session. A sustained one is.
 */
export const isConnectionStable = (minMs: number = STABLE_CONNECTION_MS): boolean =>
  currentOnline && onlineSince !== null && Date.now() - onlineSince >= minMs;

// ─── The three-state network model ──────────────────────────────────────────
// `currentOnline` above is the OS's answer: "is there an interface?". This is the answer the app
// actually acts on: `online` / `degraded` / `offline`. Rules in `utils/network-status.ts`, the
// probe in `services/health-probe.ts`, rationale in `docs/claude/health-probe-mobile-guide.md`.
//
// ⚠️ A slow API is NOT a bad network. Only a TRANSPORT failure (timeout, DNS, TLS, refused)
// counts, and even then nothing changes state until `GET /health` has been asked. A 5xx is
// reachability EVIDENCE — the request reached the server and came back.

let netState: NetworkState = initialNetworkState();
const statusListeners = new Set<(status: NetworkStatus) => void>();

const setNetState = (next: NetworkState) => {
  if (next === netState || next.status === netState.status) {
    netState = next;
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
  // Reaching `online` is a reconnect in every sense a sync scheduler cares about: work that
  // could not be sent now can be. Reuse the existing edge so every queue drains with no new
  // wiring.
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

/**
 * Classify a finished request for the state machine.
 *
 * ⚠️ The whole point is what does NOT count. `401`/`403` is a token problem; any other `4xx`
 * means the request was wrong and the network delivered it fine; `5xx` proves we reached the
 * server. Only a transport-layer failure is evidence about the link.
 */
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
 * Report a finished request. Called by the axios interceptors for every call.
 *
 * On a transport failure this may fire `GET /health` — throttled to once per 20 s, and never
 * while requests are succeeding.
 */
export const reportRequestSignal = (signal: RequestSignal): void => {
  setNetState(applyRequestSignal(netState, signal, Date.now()));

  if (!shouldProbe(signal)) return;
  // ⚠️ Hold `online` through a single failure. One timed-out request on an otherwise healthy
  // link is noise, and probing on it would spend a request to learn nothing. Once the run is
  // long enough — or we are already out of `online` and need to know whether it got better or
  // worse — ask `/health`. `probeHealthThrottled` is what keeps this to once per 20 s.
  if (netState.status === 'online' && netState.failures < FAILURES_BEFORE_LEAVING_ONLINE) return;
  void (async () => {
    const reachable = await probeHealthThrottled();
    if (reachable === null) return; // too soon; keep the current state
    setNetState(applyProbeResult(netState, reachable, Date.now()));
  })();
};

/** The current three-state status. */
export const getNetworkStatus = (): NetworkStatus => netState.status;

/**
 * What a SCREEN should behave as — `degraded` counts as offline here.
 *
 * ⚠️ The sync queues must NOT use this; see `canAttemptSync`. A degraded link has to keep being
 * attempted, because only a real success can restore `online`.
 */
export const isEffectivelyOffline = (): boolean => computeEffectivelyOffline(netState.status);

/** Whether a sync queue should try. True unless we are positively offline. */
export const canAttemptSync = (): boolean => shouldAttemptSync(netState.status);

export const subscribeNetworkStatus = (
  listener: (status: NetworkStatus) => void
): (() => void) => {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
};

/**
 * Ask `/health` now, bypassing the throttle. For a deliberate user action — pull-to-refresh, a
 * Retry button — where waiting out the interval would feel broken.
 */
export const recheckNetworkNow = async (): Promise<NetworkStatus> => {
  const { probeHealthNow } = await import('./health-probe');
  setNetState(applyProbeResult(netState, await probeHealthNow(), Date.now()));
  return netState.status;
};

/** Test seam. */
export const __resetNetworkStatus = (): void => {
  netState = initialNetworkState();
};

/** Subscribe to every change. Returns the unsubscribe. */
export const subscribeConnectivity = (listener: ConnectivityListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Subscribe to the offline→online EDGE only.
 *
 * This is the hook a sync scheduler wants: it fires once per reconnect rather than on every
 * connectivity event, so a drain cannot be started twice for one return of signal.
 */
export const onReconnect = (listener: () => void): (() => void) => {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
};

/**
 * One-shot confirmation, for a caller that must not act on the cached value.
 *
 * ⚠️ Prefer `isOnline()`. This costs a native round trip and exists for the rare path that has just
 * been resumed from the background, where the subscription may not have caught up yet.
 */
export const refreshConnectivity = async (): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    applySnapshot(state);
    // ⚠️ The RAW reading, NOT `currentOnline`. `applySnapshot` DEBOUNCES a drop by
    // OFFLINE_DEBOUNCE_MS, so `currentOnline` is still `true` for 1.5 s after the network
    // goes — which made this probe answer "online" on the FIRST call after going offline,
    // the one call that matters. The debounce exists to stop subscribers flapping; a caller
    // that asked a direct question wants the direct answer.
    return resolveOnline(state);
  } catch (e) {
    console.warn('[connectivity] refresh failed:', e);
    return currentOnline;
  }
};

// ─── Wi-Fi helpers ─────────────────────────────────────────────────────────────

/** Synchronous read — is the device currently on Wi-Fi? */
export const isOnWifi = (): boolean => currentWifi;

/**
 * Subscribe to Wi-Fi state changes. The listener fires with `true` when the
 * device connects to Wi-Fi and `false` otherwise.
 *
 * Returns an unsubscribe function.
 */
export const subscribeWifiStatus = (listener: WifiListener): (() => void) => {
  // Fire immediately with current state so the caller can skip an extra read.
  try { listener(currentWifi); } catch (e) { console.warn('[connectivity] wifi subscriber threw:', e); }
  const wrapped = () => { try { listener(currentWifi); } catch (e) { console.warn('[connectivity] wifi subscriber threw:', e); } };
  wifiReconnectListeners.add(wrapped);
  return () => { wifiReconnectListeners.delete(wrapped); };
};

/**
 * Subscribe to the "just connected to Wi-Fi" edge — fires exactly once when
 * the device transitions from non-wifi to wifi. Use this to trigger
 * bulk background downloads (e.g. offline map packs).
 *
 * Returns an unsubscribe function.
 */
export const onWifiReconnect = (listener: () => void): (() => void) => {
  wifiReconnectListeners.add(listener);
  return () => {
    wifiReconnectListeners.delete(listener);
  };
};
