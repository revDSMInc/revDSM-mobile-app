/**
 * PushNotificationService — device token lifecycle.
 *
 * The one module that owns the Firebase Messaging lifecycle. Everything else in
 * the app talks to push through this or through `utils/push-routing.ts`.
 *
 * Architecture (mirrors SocketManager: a singleton owning a stateful native thing):
 *
 *   utils/push-routing.ts           pure — eventType → destination, no RN imports
 *   services/push-native.ts         safe lazy accessor for the native SDKs
 *   services/api/notifications.ts   HTTP — bind / unbind / history
 *   services/PushNotificationService.ts   ← you are here: permission, token, channels
 *   hooks/usePushNotifications.ts   React — foreground display, taps, navigation
 *   hooks/useNotifications.ts       React — history list, unread badge, mark read
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md (branch revDSMUIUX-97).
 *
 * ⚠️ NOTHING HERE EVER THROWS, and nothing here is imported statically from a
 * native module. `hooks/useAuth.ts` calls into this on logout, so a throw at
 * import time would take sign-in down with it — see `services/push-native.ts`.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { Storage } from '../utils/storage';
import { hasSession } from './api';
import { NotificationApi } from './api/notifications';
import { getNativePush } from './push-native';
import { CHANNEL_MESSAGES, CHANNEL_LEADS, CHANNEL_SIGNATURES } from '../utils/push-routing';

/**
 * Persisted so logout can still release the token after an app restart, or after a
 * cold-start bind that failed offline. Without these, a rep who signs out on a
 * launch where the bind never completed leaves the token registered — see the
 * shared-handset note on `unbind`.
 */
const TOKEN_KEY = 'pushDeviceToken';
const USER_KEY = 'pushBoundUserId';

let unsubscribeTokenRefresh: (() => void) | null = null;

/**
 * The messaging instance, or null when the native modules are unavailable.
 *
 * No try/catch needed: `getNativePush()` probes the native side before returning,
 * so a non-null result means these instances already resolved successfully.
 */
function messagingInstance(): { np: any; instance: any } | null {
  const np = getNativePush();
  if (!np) return null;
  return { np, instance: np.messagingInstance };
}

// ─── Device description ──────────────────────────────────────────────────────

/**
 * ⚠️ All four bind fields are REQUIRED and an empty one is rejected outright, so
 * this must never return ''. Built from `Platform.constants` because the repo has
 * no `react-native-device-info` — which is why iOS reports only the idiom and OS
 * version rather than the exact model.
 */
function describeDevice(): string {
  const c: any = Platform.constants || {};
  if (Platform.OS === 'android') {
    const model = [c.Manufacturer, c.Model].filter(Boolean).join(' ').trim();
    return `${model || 'Android device'} / Android ${c.Release || Platform.Version}`;
  }
  const idiom = c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone';
  return `${idiom} / iOS ${c.osVersion || Platform.Version}`;
}

// ─── Channels ────────────────────────────────────────────────────────────────

/**
 * Three channels, not one, so a rep can silence chatter without also silencing a
 * lead assignment — Android exposes per-channel toggles in system settings.
 *
 * ⚠️ `messages` MUST stay in step with `default_notification_channel_id` in
 * `res/values/strings.xml`. That string is what the OS uses to render a push
 * received while the app is backgrounded; if it names a channel that was never
 * created, Android drops the notification into an unlabelled fallback.
 */
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

// ─── Permission ──────────────────────────────────────────────────────────────

/**
 * ⚠️ Deliberately does NOT use `messaging().requestPermission()`. That API is
 * deprecated as of @react-native-firebase v22 and documented for removal; we are
 * on v26. Notifee owns the iOS prompt, and Android 13+ goes through
 * `PermissionsAndroid` to match how every other permission in this app is asked
 * for (see `useAppInitialization`).
 */
export async function requestPushPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // Below API 33 the permission is granted at install time.
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

// ─── Bind / unbind ───────────────────────────────────────────────────────────

/**
 * Register this device against `userId`.
 *
 * ⚠️ MUST be called AFTER `setSessionHeader(token)`. The POST is authenticated;
 * fired earlier it 401s and the rep then receives nothing, with no symptom
 * anywhere on the device.
 *
 * ⚠️ MUST be called on EVERY app start, not only after login — the contract
 * requires it. An FCM token can rotate at any time, and a rotated token that is
 * never re-bound silently stops delivery: the server logs "has no bound devices"
 * and answers `{ devices: 0 }`, and nothing surfaces to the client.
 *
 * Safe to call repeatedly — the endpoint is an upsert.
 */
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

    // Dev-only, and the whole token rather than a prefix: testing a push means
    // pasting this into the Firebase console, and a truncated token is useless.
    if (__DEV__) console.log('[Push] FCM token:\n' + token);

    await sendBind(id, token);

    // Re-bind whenever FCM rotates the token mid-session.
    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = m.np.messaging.onTokenRefresh(m.instance, (next: string) => {
      console.log('[Push] token refreshed');
      void sendBind(id, next);
    });
  } catch (err) {
    // Never throw. A failed bind costs notifications, not the session.
    console.warn('[Push] bind failed:', err);
  }
}

/**
 * Release this device's token.
 *
 * ⚠️ THIS IS A SECURITY STEP, NOT HOUSEKEEPING. Field crews share handsets. A
 * token left bound means the next rep to sign in on that device receives the
 * PREVIOUS rep's lead names, customer addresses and chat messages on their lock
 * screen. The backend only prunes a dead token on its next send attempt, so
 * leaving it is a real window, not a theoretical one.
 *
 * ⚠️ Call BEFORE `setSessionHeader(null)` — the DELETE is authenticated.
 */
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

/**
 * Local-only teardown for the global 401 path, where the session is already gone
 * and an authenticated DELETE is impossible.
 */
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

/**
 * Deleting the FCM token forces a fresh one at the next sign-in, so a different
 * rep on this handset can never inherit the previous binding.
 */
async function clearNativeState(): Promise<void> {
  const m = messagingInstance();
  if (!m) return;
  await m.np.messaging.deleteToken(m.instance).catch(() => {});
  await m.np.notifee.cancelAllNotifications().catch(() => {});
  await m.np.notifee.setBadgeCount(0).catch(() => {});
}

/** Diagnostic: what the server currently holds for this user. */
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
    // Persisted only on success, so `unbind` never sends a token the server
    // never accepted.
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
