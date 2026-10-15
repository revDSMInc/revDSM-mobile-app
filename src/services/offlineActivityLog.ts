import { AppState } from 'react-native';
import { Storage } from '../utils/storage';
import { isOnline, onReconnect } from './connectivity';
import { isUnauthorizedError } from '../utils/upload-retry-policy';
import { findUnresolvedClientIds } from '../utils/offline-lead-work';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import {
  appendQueuedLog,
  nextSendableLog,
  replayableLogs,
  rekeyQueuedLogs,
  settleQueuedLog,
  type QueuedActivityLog,
} from '../utils/offline-activity-log';

const STORE_KEY = 'offline_activity_logs';

let store: QueuedActivityLog[] = [];
let loaded = false;
let draining = false;

type LogSender = (entry: QueuedActivityLog) => Promise<unknown>;
let sender: LogSender | null = null;

export const setActivityLogSender = (fn: LogSender): void => {
  sender = fn;
};

// Swaps a device-only id (lead / appointment / calculator created offline) for its server id once
// that step has uploaded. Registered by `offlineLeadStore`, which owns the id maps.
type IdResolver = (value: Record<string, any>) => Record<string, any>;
let resolveIds: IdResolver = (v) => v;

export const setActivityLogIdResolver = (fn: IdResolver): void => {
  resolveIds = fn;
};

const resolvedPayload = (entry: QueuedActivityLog): Record<string, any> =>
  resolveIds(entry.payload);

const hasUnresolvedIds = (entry: QueuedActivityLog): boolean =>
  findUnresolvedClientIds(resolvedPayload(entry)).length > 0;

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const raw = Storage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    store = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[activityLogQueue] could not read the queue', e);
    store = [];
  }
};

const persist = (): void => {
  try {
    Storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[activityLogQueue] could not write the queue', e);
  }
};

registerSessionResetHook(() => {
  store = [];
  loaded = false;
});

let seq = 0;
const nextId = (): string => `log-${Date.now()}-${(seq += 1)}`;

export const queueActivityLog = (
  entry: Omit<QueuedActivityLog, 'id' | 'ownerId' | 'attempts'>
): void => {
  load();
  const ownerId = getSessionOwner();
  if (!ownerId) return;
  store = appendQueuedLog(store, { ...entry, id: nextId(), ownerId, attempts: 0 });
  persist();
  // Drain on enqueue, as the other queues do: a log held during a brief dropout would otherwise
  // wait for the next `onReconnect`, which may never come in that session.
  if (isOnline()) runActivityLogDrain();
};

export const rekeyActivityLogs = (fromId: string, toId: string): void => {
  load();
  const next = rekeyQueuedLogs(store, fromId, toId);
  if (next === store) return;
  store = next;
  persist();
  // The lead now exists, so the logs held back for it can go.
  if (isOnline()) runActivityLogDrain();
};

// True while any log of this rep is waiting. `logEvent` uses it so a log made after reconnecting
// joins the line behind the older held ones instead of overtaking them.
export const hasQueuedActivityLogs = (): boolean => {
  load();
  return replayableLogs(store, getSessionOwner()).length > 0;
};

export const queuedActivityLogCount = (): number => {
  load();
  return replayableLogs(store, getSessionOwner()).length;
};

export const drainActivityLogs = async (): Promise<void> => {
  load();
  // No session yet means the app is still starting, NOT that the log is bad. Returning here
  // rather than letting the sender throw is what stops a few launches burning all 5 attempts
  // and discarding a check-in the rep really did make.
  if (draining || !isOnline() || !sender || !getSessionOwner() || !Storage.getItem('accessToken')) {
    return;
  }
  draining = true;
  try {
    for (;;) {
      const next = nextSendableLog(store, getSessionOwner(), hasUnresolvedIds);
      if (!next || !isOnline()) return;
      let outcome: 'sent' | 'failed' = 'sent';
      try {
        await sender({ ...next, payload: resolvedPayload(next) });
      } catch (e: any) {
        // A 401 is the session, not the log: keep it, spend no attempt, and stop.
        if (isUnauthorizedError(e)) return;
        outcome = 'failed';
      }
      const before = store.length;
      store = settleQueuedLog(store, next.id, outcome);
      persist();
      if (store.length === before && outcome === 'failed') return;
    }
  } finally {
    draining = false;
  }
};

export const isActivityLogDraining = (): boolean => draining;

export const runActivityLogDrain = (): void => {
  drainActivityLogs().catch((e) => console.warn('[activityLogQueue] drain failed', e));
};

let syncStarted = false;

const RETRY_SWEEP_MS = 60_000;

export const startActivityLogSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;
  onReconnect(() => runActivityLogDrain());

  // The same three triggers `offlineLeadStore` uses, and for the same reason. `onReconnect` alone
  // is not enough: a rep who reconnects, kills the app, then reopens it ALREADY ONLINE never gets
  // a reconnect event, and the startup drain below races `initialize()` setting the session owner
  // and token - so the queue sat full while the app looked perfectly healthy.
  AppState.addEventListener('change', (next) => {
    if (next === 'active') runActivityLogDrain();
  });

  setInterval(() => {
    if (!isOnline()) return;
    load();
    if (!replayableLogs(store, getSessionOwner()).length) return;
    runActivityLogDrain();
  }, RETRY_SWEEP_MS);

  runActivityLogDrain();
};
