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
  if (draining || !isOnline() || !sender) return;
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

export const startActivityLogSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;
  onReconnect(() => runActivityLogDrain());
  runActivityLogDrain();
};
