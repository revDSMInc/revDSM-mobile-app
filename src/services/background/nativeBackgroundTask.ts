/**
 * nativeBackgroundTask.ts — JS face of the iOS `BackgroundUploadTask` module
 * (`ios/revDSM_Sales/BackgroundUploadTask.m`).
 *
 * iOS has no background service. It grants a finite grace period, requested with
 * `beginBackgroundTask`, and kills the app if it overruns. These three calls are all JS needs:
 * open the grace period, close it, and read how much is left so a drain can stop starting work it
 * cannot finish.
 *
 * ⚠️ Android has no equivalent here — its budget is the foreground service in
 * `androidUploadService.ts` — so every call is a safe no-op there, and `remainingSeconds` answers
 * `Infinity` (no budget to respect).
 *
 * ⚠️ Reached through `NativeModules` at CALL time, not destructured at import: a JS-only reload
 * against a binary built before this module existed must degrade to "no extra time", not crash.
 */

import { NativeModules, Platform } from 'react-native';

interface BackgroundUploadTaskModule {
  begin(): Promise<boolean>;
  end(): Promise<void>;
  remainingSeconds(): Promise<number>;
}

const getModule = (): BackgroundUploadTaskModule | null => {
  if (Platform.OS !== 'ios') return null;
  return (NativeModules.BackgroundUploadTask as BackgroundUploadTaskModule | undefined) ?? null;
};

/** Open the grace period. Resolves whether iOS granted it. Idempotent natively. */
export const beginBackgroundGrace = async (): Promise<boolean> => {
  const mod = getModule();
  if (!mod) return false;
  try {
    return await mod.begin();
  } catch (e) {
    console.warn('[background] could not begin a background task', e);
    return false;
  }
};

/** Close the grace period. ⚠️ Always call it when done — an open task is held until iOS expires it. */
export const endBackgroundGrace = async (): Promise<void> => {
  const mod = getModule();
  if (!mod) return;
  try {
    await mod.end();
  } catch (e) {
    console.warn('[background] could not end the background task', e);
  }
};

/** Seconds of grace left on iOS. `Infinity` where the platform has no such budget. */
export const remainingGraceSeconds = async (): Promise<number> => {
  const mod = getModule();
  if (!mod) return Number.POSITIVE_INFINITY;
  try {
    return await mod.remainingSeconds();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
