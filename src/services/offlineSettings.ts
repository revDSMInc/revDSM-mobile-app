import { storage } from '../utils/storage';
import { SettingsService } from './api/SettingsService';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import { hasSession } from './api';
import {
  hasPendingSettings,
  mergePendingSettings,
  pendingSettingsPayload,
  type CalculatorSettingsPatch,
  type PendingCalculatorSettings,
} from '../utils/offline-settings';

const LEGACY_KEY = 'offline_calculator_settings';

/** Per owner, so one rep's pending defaults can never be flushed onto another rep's account. */
const keyFor = (owner: string): string => `${LEGACY_KEY}:${owner}`;

let pending: PendingCalculatorSettings | null = null;
let loaded = false;
let flushing = false;
const listeners = new Set<() => void>();

const load = (): void => {
  if (loaded) return;
  // No signed-in owner yet (app still starting): nothing to read, and NOT loaded, so the next call retries.
  const owner = getSessionOwner();
  if (!owner) return;
  loaded = true;
  try {
    // A record written before settings were per-owner belongs to whoever is signed in now.
    const legacy = storage.getString(LEGACY_KEY);
    if (legacy && !storage.getString(keyFor(owner))) storage.set(keyFor(owner), legacy);
    if (legacy) storage.remove(LEGACY_KEY);
    const saved = storage.getString(keyFor(owner));
    pending = saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.warn('[settings] could not read pending defaults', e);
    pending = null;
  }
};

const persist = (): void => {
  try {
    const owner = getSessionOwner();
    if (owner) {
      if (pending) storage.set(keyFor(owner), JSON.stringify(pending));
      else storage.remove(keyFor(owner));
    }
  } catch (e) {
    console.warn('[settings] could not write pending defaults', e);
  }
  listeners.forEach((l) => {
    try {
      l();
    } catch {
    }
  });
};

export const getPendingCalculatorSettings = (): PendingCalculatorSettings | null => {
  load();
  return pending;
};

export const subscribePendingCalculatorSettings = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const queueCalculatorSetting = (patch: CalculatorSettingsPatch): PendingCalculatorSettings => {
  load();
  pending = mergePendingSettings(pending, patch);
  persist();
  return pending;
};

export const flushCalculatorSettings = async (
  onApplied?: (applied: CalculatorSettingsPatch) => void
): Promise<CalculatorSettingsPatch | null> => {
  load();
  if (flushing || !isOnline() || !hasSession() || !hasPendingSettings(pending)) return null;

  const payload = pendingSettingsPayload(pending);
  flushing = true;
  try {
    await SettingsService.updateCalculatorsSetting(payload);
    onApplied?.(payload);
    pending = null;
    persist();
    return payload;
  } catch (e) {
    console.warn('[settings] could not sync pending defaults', e);
    return null;
  } finally {
    flushing = false;
  }
};

registerSessionResetHook(() => {
  pending = null;
  loaded = false;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
    }
  });
});

let syncStarted = false;

export const startCalculatorSettingsSync = (
  onApplied?: (applied: CalculatorSettingsPatch) => void
): void => {
  if (syncStarted) return;
  syncStarted = true;
  const run = () => {
    flushCalculatorSettings(onApplied).catch((e) =>
      console.warn('[settings] sync failed', e)
    );
  };
  onReconnect(run);
  run();
};
