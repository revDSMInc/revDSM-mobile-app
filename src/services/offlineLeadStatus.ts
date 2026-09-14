/**
 * offlineLeadStatus.ts — the device half of `utils/offline-lead-status.ts`.
 *
 * ⚠️ NOT wiped with the rep's queued WORK, but IS wiped with their session: a check-in mark is a
 * record of what this rep did on this shift, and replaying it onto whoever signs in next would put
 * another rep's card in the resumed state. `sessionScope` clears the key; the hook below is what
 * stops the in-memory copy writing it straight back.
 */

import { Storage } from '../utils/storage';
import { registerSessionResetHook } from './sessionScope';
import {
  applyOfflineWorkflow,
  markOfflineCheckIn,
  pruneOfflineWorkflow,
  rekeyOfflineWorkflow,
  type OfflineWorkflowMap,
} from '../utils/offline-lead-status';

const STORE_KEY = 'offline_lead_workflow';

let store: OfflineWorkflowMap = {};
let loaded = false;
const listeners = new Set<() => void>();

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const raw = Storage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    store = pruneOfflineWorkflow(parsed && typeof parsed === 'object' ? parsed : {});
  } catch (e) {
    console.warn('[leadStatus] could not read the store', e);
    store = {};
  }
};

const persist = (): void => {
  try {
    Storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[leadStatus] could not write the store', e);
  }
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a bad listener must not break the write */
    }
  });
};

registerSessionResetHook(() => {
  store = {};
  loaded = false;
});

export const getOfflineWorkflow = (): OfflineWorkflowMap => {
  load();
  return store;
};

export const subscribeOfflineWorkflow = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The rep started (or resumed) this appointment with no signal.
 *
 * ⚠️ This mark is the DISPLAY half only, and it is deliberately local: it colours the card
 * immediately, ages out after a day, and is re-addressed by `rekeyLeadWorkflow` when the lead
 * gets its real id. The server is told separately, by the `work` upload step — see the note on
 * that step for why replaying the call was originally refused and what changed.
 */
export const markLeadCheckedInOffline = (leadId: unknown): void => {
  load();
  const next = markOfflineCheckIn(store, leadId);
  if (next === store) return;
  store = next;
  persist();
};

/**
 * Move a mark onto the id the server issued, once the create has landed.
 *
 * Called from the `lead` upload step beside `uploadQueueManager.rekeyLead`, and for the same
 * reason — see `rekeyOfflineWorkflow`.
 */
export const rekeyLeadWorkflow = (fromId: unknown, toId: unknown): void => {
  load();
  const next = rekeyOfflineWorkflow(store, fromId, toId);
  if (next === store) return;
  store = next;
  persist();
};

export { applyOfflineWorkflow };
