/**
 * offlineSettings.ts — storage and replay for a rep default set with no signal.
 *
 * The rules live in `utils/offline-settings.ts` (pure, tested). This is the device half: one MMKV
 * record, a listener set so the toggle re-renders the instant it is tapped, and a reconnect flush.
 *
 * ⚠️ Replay is unconditionally safe here, unlike the lead queue. This is a whole-value PUT of a
 * preference, so sending it twice lands the same state — there is no create to duplicate and no
 * ambiguous outcome to reason about.
 */

import { storage } from '../utils/storage';
import { SettingsService } from './api/SettingsService';
import { isOnline, onReconnect } from './connectivity';
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
      /* a bad listener must not stop the sync */
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

/** Record the rep's choice locally. Returns the merged record the UI should read. */
export const queueCalculatorSetting = (patch: CalculatorSettingsPatch): PendingCalculatorSettings => {
  load();
  pending = mergePendingSettings(pending, patch);
  persist();
  return pending;
};

/**
 * Send whatever is waiting.
 *
 * Resolves with the payload that landed, so the caller can write those values onto the local user
 * BEFORE the pending record is cleared. ⚠️ That order matters: clearing first drops the override
 * while redux still holds the older server value, and the rep watches their toggle flip back.
 */
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
    // Kept for the next reconnect. A preference is not worth surfacing an error over.
    console.warn('[settings] could not sync pending defaults', e);
    return null;
  } finally {
    flushing = false;
  }
};

let syncStarted = false;

/** Idempotent. Flushes on every reconnect, plus once on a cold start. */
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
