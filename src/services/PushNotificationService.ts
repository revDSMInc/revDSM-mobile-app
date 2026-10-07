import { Platform, PermissionsAndroid } from 'react-native';
import { Storage } from '../utils/storage';
import { hasSession } from './api';
import { NotificationApi } from './api/notifications';
import { getNativePush } from './push-native';
import { CHANNEL_MESSAGES, CHANNEL_LEADS, CHANNEL_SIGNATURES } from '../utils/push-routing';

const TOKEN_KEY = 'pushDeviceToken';
const USER_KEY = 'pushBoundUserId';

let unsubscribeTokenRefresh: (() => void) | null = null;

function messagingInstance(): { np: any; instance: any } | null {
  const np = getNativePush();
  if (!np) return null;
  return { np, instance: np.messagingInstance };
}

function describeDevice(): string {
  const c: any = Platform.constants || {};
  if (Platform.OS === 'android') {
    const model = [c.Manufacturer, c.Model].filter(Boolean).join(' ').trim();
    return `${model || 'Android device'} / Android ${c.Release || Platform.Version}`;
  }
  const idiom = c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone';
  return `${idiom} / iOS ${c.osVersion || Platform.Version}`;
}

export async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const np = getNativePush();
  if (!np) return;

  try {
    const importance = np.AndroidImportance;
    await Promise.all([
      np.notifee.createChannel({
        id: CHANNEL_MESSAGES,
        name: 'Messages',
        description: 'Chat messages, replies and mentions',
        importance: importance?.HIGH,
      }),
      np.notifee.createChannel({
        id: CHANNEL_LEADS,
        name: 'Leads & Appointments',
        description: 'Leads issued to you, appointments and cancellations',
        importance: importance?.HIGH,
      }),
      np.notifee.createChannel({
        id: CHANNEL_SIGNATURES,
        name: 'Signatures',
        description: 'Addendums and agreements signed by customers',
        importance: importance?.DEFAULT,
      }),
    ]);
  } catch (err) {
    console.warn('[Push] createChannels failed:', err);
  }
}

export async function requestPushPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      if (Number(Platform.Version) < 33) return true;
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }

    const np = getNativePush();
    if (!np) return false;
    const settings = await np.notifee.requestPermission();
    const status = np.AuthorizationStatus;
    return (
      settings?.authorizationStatus === status?.AUTHORIZED ||
      settings?.authorizationStatus === status?.PROVISIONAL
    );
  } catch (err) {
    console.warn('[Push] permission request failed:', err);
    return false;
  }
}

export async function bind(userId?: string | null): Promise<void> {
  const id = String(userId || '').trim();
  if (!id) {
    console.warn('[Push] bind skipped — no userId');
    return;
  }

  const m = messagingInstance();
  if (!m) return; // native unavailable — already warned by push-native

  try {
    const granted = await requestPushPermission();
    if (!granted) {
      console.log('[Push] permission not granted — not binding');
      return;
    }

    await createChannels();

    const token = await m.np.messaging.getToken(m.instance);
    if (!token) {
      console.warn('[Push] no FCM token returned');
      return;
    }

    if (__DEV__) console.log('[Push] FCM token:\n' + token);

    await sendBind(id, token);

    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = m.np.messaging.onTokenRefresh(m.instance, (next: string) => {
      console.log('[Push] token refreshed');
      void sendBind(id, next);
    });
  } catch (err) {
    console.warn('[Push] bind failed:', err);
  }
}

export async function unbind(): Promise<void> {
  try {
    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = null;

    const token = Storage.getItem(TOKEN_KEY);
    const userId = Storage.getItem(USER_KEY);

    if (token && userId && hasSession()) {
      await NotificationApi.unbindDevice(String(userId), String(token)).catch((err) =>
        console.warn('[Push] unbind request failed:', err)
      );
    }

    Storage.removeItem(TOKEN_KEY);
    Storage.removeItem(USER_KEY);
    await clearNativeState();
  } catch (err) {
    console.warn('[Push] unbind failed:', err);
  }
}

export async function clearLocalPushState(): Promise<void> {
  try {
    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = null;
    Storage.removeItem(TOKEN_KEY);
    Storage.removeItem(USER_KEY);
    await clearNativeState();
  } catch (err) {
    console.warn('[Push] clearLocalPushState failed:', err);
  }
}

async function clearNativeState(): Promise<void> {
  const m = messagingInstance();
  if (!m) return;
  await m.np.messaging.deleteToken(m.instance).catch(() => {});
  await m.np.notifee.cancelAllNotifications().catch(() => {});
  await m.np.notifee.setBadgeCount(0).catch(() => {});
}

export async function listBoundDevices(userId: string): Promise<any[]> {
  try {
    const res = await NotificationApi.listDevices(userId);
    const body: any = res?.data;
    return (
      body?.data?.userDevices?.devices ||
      body?.userDevices?.devices ||
      body?.data?.devices ||
      []
    );
  } catch (err) {
    console.warn('[Push] listBoundDevices failed:', err);
    return [];
  }
}

async function sendBind(userId: string, deviceToken: string): Promise<void> {
  try {
    await NotificationApi.bindDevice({
      userId,
      deviceType: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceToken,
      deviceInfo: describeDevice(),
    });
    Storage.setItem(TOKEN_KEY, deviceToken);
    Storage.setItem(USER_KEY, userId);
    console.log('[Push] bound', Platform.OS, describeDevice());
  } catch (err) {
    console.warn('[Push] bind POST failed:', err);
  }
}

export const PushNotificationService = {
  bind,
  unbind,
  clearLocalPushState,
  createChannels,
  requestPushPermission,
  listBoundDevices,
};

export default PushNotificationService;
