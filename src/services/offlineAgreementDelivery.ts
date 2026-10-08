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
