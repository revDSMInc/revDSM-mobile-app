/**
 * offlineMapFilters.ts — map filters changed with no signal, replayed on reconnect.
 *
 * The binding half of `utils/offline-map-filters.ts`: MMKV persistence, the PATCH, the reconnect
 * drain and the listener fan-out. The rules live in that pure module so they can be tested
 * without the native storage.
 *
 * ⚠️ Why this exists: both call sites in `MapFiltersModal` swallowed the failure
 * (`saveLeadFilters(...).catch(() => {})`), so offline a filter change — INCLUDING a reset — was
 * lost and the server's previous set came back on the next read.
 */

import { Storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import {
  queueFilterWrite,
  replayableFilterWrites,
  settleFilterWrite,
  effectiveFilters,
  type QueuedFilterWrite,
} from '../utils/offline-map-filters';

const STORAGE_KEY = 'offline-map-filters';

let queue: QueuedFilterWrite[] = [];
let loaded = false;
let draining = false;
const listeners: (() => void)[] = [];

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const raw = Storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    queue = Array.isArray(parsed) ? parsed : [];
  } catch {
    queue = [];
  }
};

const persist = (): void => {
  try {
    Storage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* a filter set is not worth failing a render over */
  }
};

const notify = (): void => listeners.forEach((l) => l());

// Cleared with the session: a filter set belongs to the rep who chose it, and `sessionScope`
// wipes the key anyway — this keeps the in-memory copy from writing it back.
registerSessionResetHook(() => {
  queue = [];
  loaded = false;
});

export const addFilterListener = (fn: () => void): (() => void) => {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
};

/**
 * Record a filter change that could not be sent.
 *
 * ⚠️ Call this for a RESET too — `{}` is a write, not an absence. Treating an empty object as
 * "nothing to do" is exactly how the reset was lost.
 */
export const queueMapFilters = (leadId: string, savedFilters: Record<string, unknown>): void => {
  load();
  const ownerId = getSessionOwner();
  if (!leadId || !ownerId) return;
  queue = queueFilterWrite(queue, {
    leadId,
    savedFilters: savedFilters || {},
    at: new Date().toISOString(),
    ownerId,
  });
  persist();
  notify();
  void drainMapFilters();
};

/** What the map should SHOW for this lead — the queued set wins while one is pending. */
export const filtersForLead = <T,>(leadId: string | null | undefined, serverFilters: T) => {
  load();
  return effectiveFilters(queue, leadId, serverFilters);
};

/** How many of this rep's filter changes are waiting. */
export const pendingFilterCount = (): number => {
  load();
  return replayableFilterWrites(queue, getSessionOwner()).length;
};

/**
 * Send everything held.
 *
 * ⚠️ A failure LEAVES the row. The PATCH is a full-state write, so re-sending it lands exactly the
 * same value — there is nothing to make idempotent and nothing an attempt counter would protect.
 */
export const drainMapFilters = async (): Promise<void> => {
  load();
  if (draining || !isOnline()) return;
  draining = true;
  try {
    for (const row of replayableFilterWrites(queue, getSessionOwner())) {
      if (!isOnline()) return;
      try {
        await LeadService.saveLeadFilters(row.leadId, { savedFilters: row.savedFilters });
        queue = settleFilterWrite(queue, row.leadId);
        persist();
        notify();
      } catch {
        // Left queued; the next reconnect or sweep tries again.
      }
    }
  } finally {
    draining = false;
  }
};

let started = false;

/** Subscribe to reconnects. Call once from `useAppInitialization`. */
export const startMapFilterSync = (): void => {
  if (started) return;
  started = true;
  onReconnect(() => {
    void drainMapFilters();
  });
};
