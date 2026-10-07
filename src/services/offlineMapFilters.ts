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
  }
};

const notify = (): void => listeners.forEach((l) => l());

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

export const filtersForLead = <T,>(leadId: string | null | undefined, serverFilters: T) => {
  load();
  return effectiveFilters(queue, leadId, serverFilters);
};

export const pendingFilterCount = (): number => {
  load();
  return replayableFilterWrites(queue, getSessionOwner()).length;
};

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
      }
    }
  } finally {
    draining = false;
  }
};

let started = false;

export const startMapFilterSync = (): void => {
  if (started) return;
  started = true;
  onReconnect(() => {
    void drainMapFilters();
  });
};
