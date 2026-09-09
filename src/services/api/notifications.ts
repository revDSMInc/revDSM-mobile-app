import { AxiosResponse } from 'axios';
import api from './index';

/**
 * Push notification API — device binding and the notification history.
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md (branch revDSMUIUX-97). Every route here
 * is JWT-gated and enforces ownership: `:userId` must be the caller's own id.
 *
 * This module is HTTP only. The token lifecycle that drives it lives in
 * `services/PushNotificationService.ts`; the routing rules live in
 * `utils/push-routing.ts`.
 */

const BASE = '/notifications/push/v1';

export const NotificationEndpoints = {
  bind: `${BASE}/bind`,
  unbind: `${BASE}/internal/device-token`,
  devices: (userId: string) => `${BASE}/devices/userId/${userId}`,
  history: (userId: string, type: string) => `${BASE}/history/userId/${userId}/type/${type}`,
  unreadCount: (userId: string) => `${BASE}/unread-count/userId/${userId}`,
  markAllRead: (userId: string) => `${BASE}/mark-as-read/userId/${userId}`,
  markRead: (userId: string, notificationId: string) =>
    `${BASE}/mark-as-read/userId/${userId}/notification/${notificationId}`,
};

export interface BindDevicePayload {
  userId: string;
  deviceType: 'ios' | 'android';
  deviceToken: string;
  deviceInfo: string;
}

/**
 * ⚠️ The ONLY values `:type` accepts are `all` and one exact eventType from this
 * list. Anything else — including a UI tab label like "Unread" — returns 400
 * "Notification type not found". Filter unread client-side instead; the history
 * response already carries `unreadNotifications`.
 */
export const NOTIFICATION_TYPES = [
  'chat-message',
  'chat-reply',
  'chat-file-upload',
  'chat-tagged',
  // CHAT-REACTION-NOTIFICATIONS.md. ⚠️ This list is what `:type` accepts, so it
  // must track the backend's `NotificationEventTypes` — a value the server does
  // not know yet returns 400 "Notification type not found". Nothing requests a
  // single type today (the screen always fetches `all`), so adding it early is
  // inert; it exists so `NotificationHistoryType` stays honest.
  'chat-reaction',
  'lead-issued',
  'appointment-issued',
  'addendum-signed',
  'agreement-signed',
  'lead-cancelled',
] as const;

export type NotificationHistoryType = (typeof NOTIFICATION_TYPES)[number] | 'all';

export const NotificationApi = {
  /**
   * Upsert this device's FCM token against a user.
   *
   * ⚠️ All four fields are required — the request is rejected if any is empty.
   * ⚠️ `userId` must be the JWT's own user; binding on behalf of another errors.
   */
  bindDevice: (payload: BindDevicePayload): Promise<AxiosResponse<any>> =>
    api.post(NotificationEndpoints.bind, payload),

  /**
   * Release this device's token on logout.
   *
   * ⚠️ Server-side pruning of dead tokens happens only on the NEXT send, so this
   * is not optional housekeeping — see the note in PushNotificationService.
   */
  unbindDevice: (userId: string, deviceToken: string): Promise<AxiosResponse<any>> =>
    api.delete(NotificationEndpoints.unbind, { data: { userId, deviceToken } }),

  /** Diagnostic: what the server currently holds. Use when chasing "no pushes". */
  listDevices: (userId: string): Promise<AxiosResponse<any>> =>
    api.get(NotificationEndpoints.devices(userId)),

  history: (
    userId: string,
    type: NotificationHistoryType = 'all',
    pageNumber = 1,
    pageSize = 20
  ): Promise<AxiosResponse<any>> =>
    api.get(NotificationEndpoints.history(userId, type), { params: { pageNumber, pageSize } }),

  /** Cheap by design — the contract states it is intended to be polled. */
  unreadCount: (userId: string): Promise<AxiosResponse<any>> =>
    api.get(NotificationEndpoints.unreadCount(userId)),

  markAllRead: (userId: string): Promise<AxiosResponse<any>> =>
    api.post(NotificationEndpoints.markAllRead(userId)),

  markRead: (userId: string, notificationId: string): Promise<AxiosResponse<any>> =>
    api.post(NotificationEndpoints.markRead(userId, notificationId)),
};

/**
 * ⚠️ The history row's nesting is AMBIGUOUS in the contract: its sample shows
 * `{ title, message, data: { eventType … } }` while the prose immediately after
 * says to read `row.data.data.eventType`.
 *
 * Both are read until a captured response settles it — the same discipline as
 * `readDocumentGroup` in `utils/uploaded-document-refs.ts`: walk a fixed set of
 * known shapes, never guess a single path. See §5.1 of
 * FIREBASE-PUSH-BACKEND-ASKS.md, which asks for that capture.
 */
export const rowPayload = (row: any): Record<string, any> =>
  (row?.data?.data && typeof row.data.data === 'object' ? row.data.data : row?.data) || {};

export const rowEventType = (row: any): string => String(rowPayload(row)?.eventType || '');

/**
 * ⚠️ History values are TYPED, unlike the push payload — `isDynamic` is a real
 * boolean here and a null `reason` is really null. Do NOT run a history row
 * through `pushBool` / `pushNum` from `utils/push-routing.ts`; those exist for
 * the string-coerced FCM payload only.
 */
export const rowIsUnread = (row: any): boolean =>
  row?.isRead === false || row?.read === false || row?.isUnRead === true;
