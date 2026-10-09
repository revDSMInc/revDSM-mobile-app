import { Storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import {
  pendingDeliveryFor,
  queueDeliveryWrite,
  replayableDeliveryWrites,
  settleDeliveryWrite,
  type QueuedDeliveryWrite,
} from '../utils/offline-agreement-delivery';

const STORAGE_KEY = 'offline-agreement-delivery';

let queue: QueuedDeliveryWrite[] = [];
let loaded = false;
let draining = false;

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

registerSessionResetHook(() => {
  queue = [];
  loaded = false;
});

export const queueDeliveryPreference = (
  leadId: string,
  payload: QueuedDeliveryWrite['payload']
): void => {
  load();
  const ownerId = getSessionOwner();
  if (!leadId || !ownerId) return;
  queue = queueDeliveryWrite(queue, { leadId, payload, at: new Date().toISOString(), ownerId });
  persist();
  void drainDeliveryPreferences();
};

/** The queued choice for a lead, so the prompt reopens on what the rep picked. */
export const queuedDeliveryPreference = (leadId: string | null | undefined) => {
  load();
  return pendingDeliveryFor(queue, leadId);
};

/**
 * Re-point a queued preference at the real lead id once the lead itself syncs.
 *
 * A lead created at a door is queued under a CLIENT id. Replaying the preference against that id
 * would file it on a lead the server has never heard of, so the row has to follow the lead.
 */
export const rekeyDeliveryPreference = (fromId: string, toId: string): void => {
  load();
  const from = String(fromId || '').trim();
  const to = String(toId || '').trim();
  if (!from || !to || from === to) return;
  let changed = false;
  queue = queue.map((row) => {
    if (row.leadId !== from) return row;
    changed = true;
    return { ...row, leadId: to };
  });
  if (!changed) return;
  persist();
  void drainDeliveryPreferences();
};

export const pendingDeliveryCount = (): number => {
  load();
  return replayableDeliveryWrites(queue, getSessionOwner()).length;
};

export const drainDeliveryPreferences = async (): Promise<void> => {
  load();
  if (draining || !isOnline()) return;
  draining = true;
  try {
    for (const row of replayableDeliveryWrites(queue, getSessionOwner())) {
      if (!isOnline()) return;
      try {
        await LeadService.saveAgreementDeliveryPreference(row.leadId, row.payload);
        queue = settleDeliveryWrite(queue, row.leadId);
        persist();
      } catch {
      }
    }
  } finally {
    draining = false;
  }
};

let started = false;

export const startDeliveryPreferenceSync = (): void => {
  if (started) return;
  started = true;
  onReconnect(() => {
    void drainDeliveryPreferences();
  });
};
