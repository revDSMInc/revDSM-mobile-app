export interface NativePush {
  app: any;
  messaging: any;
  notifee: any;
  firebaseApp: any;
  messagingInstance: any;
  AndroidImportance: any;
  EventType: any;
  AuthorizationStatus: any;
}

let cached: NativePush | null | undefined;

export function getNativePush(): NativePush | null {
  if (cached !== undefined) return cached;

  try {
    /* eslint-disable global-require */
    const app = require('@react-native-firebase/app');
    const messaging = require('@react-native-firebase/messaging');
    const notifeeModule = require('@notifee/react-native');
    /* eslint-enable global-require */

    const firebaseApp = app.getApp();
    const messagingInstance = messaging.getMessaging(firebaseApp);
    const notifee = notifeeModule?.default || notifeeModule;
    if (typeof notifee?.createChannel !== 'function') {
      throw new Error('notifee unavailable');
    }

    cached = {
      app,
      messaging,
      notifee,
      firebaseApp,
      messagingInstance,
      AndroidImportance: notifeeModule?.AndroidImportance,
      EventType: notifeeModule?.EventType,
      AuthorizationStatus: notifeeModule?.AuthorizationStatus,
    };
  } catch (err: any) {
    console.warn(
      '[Push] native modules unavailable — push is disabled for this build. ' +
        'Rebuild with `yarn android` / `yarn ios` after installing the packages. ' +
        `(${err?.message || err})`
    );
    cached = null;
  }

  return cached;
}

export const isPushAvailable = (): boolean => getNativePush() !== null;
