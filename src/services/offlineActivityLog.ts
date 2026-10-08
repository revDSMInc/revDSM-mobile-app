import { AppState } from 'react-native';
import { Storage } from '../utils/storage';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import {
  appendQueuedLog,
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
  console.log(
    '[CheckInTrace] rekey logs %s -> %s held=%s matched=%s',
    fromId,
    toId,
    store.length,
    next === store ? 0 : 'some'
  );
  if (next === store) return;
  store = next;
  persist();
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
      const next = replayableLogs(store, getSessionOwner())[0];
      if (!next || !isOnline()) return;
      let outcome: 'sent' | 'failed' = 'sent';
      try {
        console.log(
          '[CheckInTrace] replay %s leadId=%s attempts=%s',
          next.payload?.module_type || next.eventType,
          next.payload?.meta?.leadId,
          next.attempts
        );
        await sender(next);
      } catch (e: any) {
        // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
        console.log('[CheckInTrace] replay FAILED status=%s', e?.response?.status);
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
