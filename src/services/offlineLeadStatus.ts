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

export const markLeadCheckedInOffline = (leadId: unknown): void => {
  load();
  const next = markOfflineCheckIn(store, leadId);
  if (next === store) return;
  store = next;
  persist();
};

export const rekeyLeadWorkflow = (fromId: unknown, toId: unknown): void => {
  load();
  const next = rekeyOfflineWorkflow(store, fromId, toId);
  if (next === store) return;
  store = next;
  persist();
};

export { applyOfflineWorkflow };
