import { storage } from '../utils/storage';
import { SettingsService } from './api/SettingsService';
import { isOnline, onReconnect } from './connectivity';
import { registerSessionResetHook } from './sessionScope';
import {
  hasPendingSettings,
  mergePendingSettings,
  pendingSettingsPayload,
  type CalculatorSettingsPatch,
  type PendingCalculatorSettings,
} from '../utils/offline-settings';

const KEY = 'offline_calculator_settings';

let pending: PendingCalculatorSettings | null = null;
let loaded = false;
let flushing = false;
const listeners = new Set<() => void>();

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const saved = storage.getString(KEY);
    pending = saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.warn('[settings] could not read pending defaults', e);
    pending = null;
  }
};

const persist = (): void => {
  try {
    if (pending) storage.set(KEY, JSON.stringify(pending));
    else storage.remove(KEY);
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
  if (flushing || !isOnline() || !hasPendingSettings(pending)) return null;

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
