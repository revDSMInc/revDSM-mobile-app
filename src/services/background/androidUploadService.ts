import { Platform } from 'react-native';
import { runBackgroundDrain } from './uploadCoordinator';
import { uploadNotificationText } from '../../utils/background-upload-policy';

export const UPLOAD_CHANNEL_ID = 'background-uploads';
const UPLOAD_NOTIFICATION_ID = 'background-upload-service';

let registered = false;
let serviceActive = false;
let runnerOwned = false;
let lastShownText = '';

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
  online: boolean,
  asService: boolean
): Record<string, unknown> => {
  const { title, body } = uploadNotificationText(pending, online);
  return {
    id: UPLOAD_NOTIFICATION_ID,
    title,
    body,
    android: {
      channelId: UPLOAD_CHANNEL_ID,
      asForegroundService: asService,
      ...(asService
        ? {
            foregroundServiceTypes: [
              module?.AndroidForegroundServiceType?.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            ].filter(Boolean),
          }
        : {}),
      ongoing: true,
      onlyAlertOnce: true,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
  };
};

export const registerAndroidUploadRunner = (): void => {
  if (registered) return;
  const n = getNotifee();
  if (!n) return;
  registered = true;

  n.notifee.registerForegroundService(async () => {
    const owner = !runnerOwned;
    runnerOwned = true;
    serviceActive = true;
    try {
      await runBackgroundDrain('android-foreground-service', {
        onProgress: ({ pending, online }) => {
          if (!owner) return;
          const { title, body } = uploadNotificationText(pending, online);
          const text = `${title}|${body}`;
          if (text === lastShownText) return;
          lastShownText = text;
          n.notifee
            .displayNotification(buildNotification(n.module, pending, online, false))
            .catch(() => {});
        },
      });
    } catch (e) {
      console.warn('[background] foreground upload service ended with an error', e);
    } finally {
      if (owner) {
        runnerOwned = false;
        serviceActive = false;
        lastShownText = '';
        await n.notifee.stopForegroundService().catch(() => {});
        await n.notifee.cancelNotification(UPLOAD_NOTIFICATION_ID).catch(() => {});
      }
    }
  });
};

export const startAndroidUploadService = async (pending: number, online: boolean): Promise<boolean> => {
  const n = getNotifee();
  if (!n || !registered) return false;
  if (serviceActive) return true;
  try {
    await n.notifee.createChannel({
      id: UPLOAD_CHANNEL_ID,
      name: 'Background uploads',
      description: 'Shown while queued photos and leads upload in the background',
      importance: n.module?.AndroidImportance?.LOW,
    });
    serviceActive = true;
    await n.notifee.displayNotification(buildNotification(n.module, pending, online, true));
    return true;
  } catch (e) {
    serviceActive = false;
    console.warn('[background] could not start the foreground upload service', e);
    return false;
  }
};
