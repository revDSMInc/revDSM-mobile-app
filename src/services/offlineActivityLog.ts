/**
 * offlineActivityLog.ts — the device half of the held activity-log queue.
 *
 * Storage, the drain and the reconnect subscription. Every rule lives in
 * `utils/offline-activity-log.ts`, which is testable without MMKV.
 *
 * ⚠️ It does NOT import `LoggerService`, and must not: that module imports this one to decide
 * whether a log can be held, so an import back would be a cycle. The POST is INJECTED instead
 * (`setActivityLogSender`), the same shape as `registerSessionResetHook`.
 */

import { Storage } from '../utils/storage';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import {
  appendQueuedLog,
  replayableLogs,
  settleQueuedLog,
  type QueuedActivityLog,
} from '../utils/offline-activity-log';

const STORE_KEY = 'offline_activity_logs';

let store: QueuedActivityLog[] = [];
let loaded = false;
let draining = false;

/** Injected by `LoggerService`. Returns a promise that rejects when the POST failed. */
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

/**
 * ⚠️ Cleared with the session, unlike the rep's queued WORK.
 *
 * A queued lead is a door the rep knocked and must survive them signing out; a held log is
 * telemetry about a session that has ended. Keeping it would replay one rep's movements under
 * whoever signs in next — and `sessionScope` wipes the key anyway, so this only keeps the
 * in-memory copy from writing it back.
 */
registerSessionResetHook(() => {
  store = [];
  loaded = false;
});

let seq = 0;
const nextId = (): string => `log-${Date.now()}-${(seq += 1)}`;

/** Hold one log until there is a connection. */
export const queueActivityLog = (
  entry: Omit<QueuedActivityLog, 'id' | 'ownerId' | 'attempts'>
): void => {
  load();
  const ownerId = getSessionOwner();
  // No session means nothing can own the row, and an unowned one is never replayed — holding it
  // would only grow the store. `LoggerService` already holds pre-auth logs in memory.
  if (!ownerId) return;
  store = appendQueuedLog(store, { ...entry, id: nextId(), ownerId, attempts: 0 });
  persist();
};

/** How many of this rep's rows are waiting — for a banner, or a device check. */
export const queuedActivityLogCount = (): number => {
  load();
  return replayableLogs(store, getSessionOwner()).length;
};

/**
 * Send everything held, oldest first.
 *
 * ⚠️ SEQUENTIAL and in order, for the reason `LoggerService` chains its POSTs at all: the backend
 * stamps `createdAt` on receipt and the portal renders in arrival order, so a parallel drain would
 * file the rep's day scrambled. `occurredAt` records the truth either way, but arrival order is
 * what the timeline actually shows today.
 */
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
        await sender(next);
      } catch {
        outcome = 'failed';
      }
      const before = store.length;
      store = settleQueuedLog(store, next.id, outcome);
      persist();
      // A row that neither sent nor was dropped would spin this loop forever.
      if (store.length === before && outcome === 'failed') return;
    }
  } finally {
    draining = false;
  }
};

/** Whether a drain is mid-flight. Lets the background loop tell "stuck" from "busy". */
export const isActivityLogDraining = (): boolean => draining;

export const runActivityLogDrain = (): void => {
  drainActivityLogs().catch((e) => console.warn('[activityLogQueue] drain failed', e));
};

let syncStarted = false;

/** Idempotent — a remount cannot double-subscribe the drain. */
export const startActivityLogSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;
  onReconnect(() => runActivityLogDrain());
  runActivityLogDrain();
};
