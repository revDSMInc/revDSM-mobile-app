/**
 * backgroundUploadService.ts — decides WHEN to keep uploading after the app leaves the screen, and
 * hands the work to the right platform mechanism.
 *
 *   leaves the screen with work queued
 *     ├─ iOS      open a grace period (`beginBackgroundTask`, ~30 s), run the coordinator's drain
 *     │           inside it, close the period when the drain ends or gives up.
 *     └─ Android  start the foreground service (`androidUploadService`), whose runner is the same
 *                 coordinator drain; it holds the process while it waits for signal and drains the
 *                 moment it returns.
 *
 *   returns to the screen   nothing to cancel — the drain is single-flight and finishes on its own;
 *                           the existing foreground triggers (reconnect edge, `active`, 60 s sweep)
 *                           carry on as before.
 *
 * ⚠️ What this can NOT do, by platform rule rather than by omission: on iOS a force-quit (swiping
 * the card away) cancels everything, and the grace period is finite — whatever is left drains on the
 * next foreground. Leaving the app in the recents list is fine; that is "suspended", not "killed".
 *
 * Idempotent start, so a remount cannot double-subscribe.
 */

import { AppState, Platform, type AppStateStatus } from 'react-native';
import { hasSession } from '../api';
import { isOnline, onReconnect } from '../connectivity';
import {
  shouldStartBackgroundWork,
} from '../../utils/background-upload-policy';
import { pendingUploadCount, runBackgroundDrain } from './uploadCoordinator';
import { beginBackgroundGrace, endBackgroundGrace } from './nativeBackgroundTask';
import { startAndroidUploadService } from './androidUploadService';

let started = false;
let lastState: AppStateStatus = AppState.currentState;

/** The app has left the screen. Keep going if there is anything to keep going with. */
const engageBackgroundUpload = async (): Promise<void> => {
  const pending = pendingUploadCount();
  if (!shouldStartBackgroundWork(pending, hasSession())) return;

  if (Platform.OS === 'ios') {
    // ⚠️ Begin BEFORE any await on the drain: the grace period has to be open before iOS suspends
    // the process, and every async hop spends part of the window.
    const granted = await beginBackgroundGrace();
    if (!granted) {
      console.warn('[background] iOS refused a background task; drain resumes on foreground');
      return;
    }
    try {
      await runBackgroundDrain('ios-background');
    } finally {
      await endBackgroundGrace();
    }
    return;
  }

  // Android: the service's runner calls the same drain. If it cannot start (Android 12+ limits, or
  // notifee missing), run the drain directly — it still works while the process is alive.
  const serviceStarted = await startAndroidUploadService(pending, isOnline());
  if (!serviceStarted) {
    runBackgroundDrain('android-no-service').catch((e) =>
      console.warn('[background] drain failed', e)
    );
  }
};

/**
 * Subscribe to app-state changes. Call once from `useAppInitialization`.
 *
 * iOS reports `inactive` before `background` (and also for a pulled-down control centre), so both
 * engage: the drain is single-flight and the grace period idempotent, and engaging early is the
 * safe direction — an unused grace period is ended as soon as the queue is empty.
 */
export const startBackgroundUploadService = (): void => {
  if (started) return;
  started = true;

  AppState.addEventListener('change', (next) => {
    const wasForeground = lastState === 'active';
    lastState = next;
    if (wasForeground && (next === 'inactive' || next === 'background')) {
      engageBackgroundUpload().catch((e) =>
        console.warn('[background] could not engage background upload', e)
      );
    }
  });

  // ⚠️ SIGNAL RETURNING WHILE BACKGROUNDED is its own trigger, and its absence was the bug.
  //
  // The AppState hook above only fires on the way OUT of the foreground. The common field case
  // runs the other way round: the rep creates a lead with no signal, backgrounds the app, and
  // signal comes back minutes later. Nothing was listening, so the drain that had already given
  // up (`WAIT_FOR_NETWORK_MS`, or the iOS grace period expiring) was never restarted — and the
  // work sat until the rep opened the app by hand. That is the "background service is not
  // working" report.
  //
  // This re-engages the platform mechanism rather than just calling the drain: on Android the
  // foreground service may have been released while waiting, and on iOS the grace period is
  // long gone, so a bare drain would be killed mid-request. `engageBackgroundUpload` asks for
  // time first and is a no-op when nothing is queued.
  //
  // ⚠️ Only while we are NOT in the foreground. A reconnect with the app on screen is already
  // covered by each engine's own `onReconnect` hook; engaging here too would open a grace period
  // nobody needs and fight the single-flight drain for no gain.
  onReconnect(() => {
    if (lastState === 'active') return;
    engageBackgroundUpload().catch((e) =>
      console.warn('[background] could not re-engage on reconnect', e)
    );
  });
};
