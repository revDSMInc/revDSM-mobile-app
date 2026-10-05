/**
 * androidUploadService.ts — the Android half of background upload: a foreground service that keeps
 * the process alive, and the network permitted, while queued work drains.
 *
 * Android freezes or kills a backgrounded process's JS within minutes (sooner under Doze), which
 * silently stops every timer the offline engines rely on. A FOREGROUND service is the platform's
 * supported answer: it shows an ongoing notification ("Uploading 3 items") and in exchange the OS
 * leaves the process running. `@notifee/react-native` already owns one, so no native Kotlin is
 * needed — the service's lifetime is simply the promise returned by the runner below.
 *
 * ⚠️ `registerAndroidUploadRunner` MUST run at MODULE SCOPE in `index.js`, before the app mounts.
 * notifee looks the runner up when the service starts; if the process was restarted into a headless
 * context there is no React tree to register it from.
 *
 * ⚠️ Android 12+ forbids STARTING a foreground service from the background. It is therefore
 * started at the moment the app leaves the screen (still permitted) and in a try/catch, so a
 * rejection degrades to "no service" — the foreground hook and the sweep still drain on return.
 * Android 14+ additionally requires the declared type (`dataSync`) in the manifest AND on the
 * notification; both are set.
 *
 * ⚠️ notifee is required lazily inside try/catch, never imported at the top — it resolves its
 * native module at import time and would take the bundle down on a stale binary (see
 * `services/push-native.ts`, which records the same trap).
 */

import { Platform } from 'react-native';
import { runBackgroundDrain } from './uploadCoordinator';
import { uploadNotificationText } from '../../utils/background-upload-policy';

export const UPLOAD_CHANNEL_ID = 'background-uploads';
const UPLOAD_NOTIFICATION_ID = 'background-upload-service';

let registered = false;

const getNotifee = (): { notifee: any; module: any } | null => {
  if (Platform.OS !== 'android') return null;
  try {
    const module = require('@notifee/react-native');
    const notifee = module?.default || module;
    if (typeof notifee?.registerForegroundService !== 'function') return null;
    return { notifee, module };
  } catch (e) {
    console.warn('[background] notifee unavailable — no foreground upload service', e);
    return null;
  }
};

const buildNotification = (
  module: any,
  pending: number,
  online: boolean
): Record<string, unknown> => {
  const { title, body } = uploadNotificationText(pending, online);
  return {
    id: UPLOAD_NOTIFICATION_ID,
    title,
    body,
    android: {
      channelId: UPLOAD_CHANNEL_ID,
      asForegroundService: true,
      // Android 14+: must match `android:foregroundServiceType` in the manifest.
      foregroundServiceTypes: [
        module?.AndroidForegroundServiceType?.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      ].filter(Boolean),
      ongoing: true,
      onlyAlertOnce: true,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
  };
};

/**
 * Register what the service DOES. Call once, at module scope, from `index.js`.
 *
 * The runner's lifetime is the service's lifetime, so it returns only when the drain is finished or
 * has given up — at which point notifee removes the notification and releases the process.
 */
export const registerAndroidUploadRunner = (): void => {
  if (registered) return;
  const n = getNotifee();
  if (!n) return;
  registered = true;

  n.notifee.registerForegroundService(async () => {
    try {
      await runBackgroundDrain('android-foreground-service', {
        onProgress: ({ pending, online }) => {
          // Refresh the text in place: same id, so it updates rather than stacking.
          n.notifee
            .displayNotification(buildNotification(n.module, pending, online))
            .catch(() => {});
        },
      });
    } catch (e) {
      console.warn('[background] foreground upload service ended with an error', e);
    } finally {
      await n.notifee.stopForegroundService().catch(() => {});
    }
  });
};

/**
 * Start the service. Resolves whether it was started. Never throws.
 *
 * Safe to call repeatedly — notifee reuses the one service for the same notification id.
 */
export const startAndroidUploadService = async (pending: number, online: boolean): Promise<boolean> => {
  const n = getNotifee();
  if (!n || !registered) return false;
  try {
    await n.notifee.createChannel({
      id: UPLOAD_CHANNEL_ID,
      name: 'Background uploads',
      description: 'Shown while queued photos and leads upload in the background',
      // LOW: a service notification must not buzz or pop up every time it appears.
      importance: n.module?.AndroidImportance?.LOW,
    });
    await n.notifee.displayNotification(buildNotification(n.module, pending, online));
    return true;
  } catch (e) {
    // Includes Android 12+ "not allowed to start a foreground service from the background".
    console.warn('[background] could not start the foreground upload service', e);
    return false;
  }
};
