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

type ConnectivityListener = (online: boolean) => void;

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
let monitorStarted = false;
let unsubscribeNetInfo: (() => void) | null = null;
let pendingTransition: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<ConnectivityListener>();
/** Fired only on the offline→online EDGE. This is what drives the sync drains. */
const reconnectListeners = new Set<() => void>();

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

  // Already heading there, or already there — nothing to schedule.
  if (nextOnline === currentOnline) {
    clearPending();
    return;
  }

  const delay = transitionDelayMs(nextOnline);
  if (delay === 0) {
    clearPending();
    commit(nextOnline);
    return;
  }

  // A drop must persist before we act on it. Re-arming on every event is deliberate: a flap that
  // resolves within the window never reaches `commit` at all.
  clearPending();
  pendingTransition = setTimeout(() => {
    pendingTransition = null;
    commit(nextOnline);
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
