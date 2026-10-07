import { AxiosResponse } from 'axios';
import api from './index';

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

export const NOTIFICATION_TYPES = [
  'chat-message',
  'chat-reply',
  'chat-file-upload',
  'chat-tagged',
  'chat-reaction',
  'lead-issued',
  'appointment-issued',
  'addendum-signed',
  'agreement-signed',
  'lead-cancelled',
] as const;

export type NotificationHistoryType = (typeof NOTIFICATION_TYPES)[number] | 'all';

export const NotificationApi = {
  bindDevice: (payload: BindDevicePayload): Promise<AxiosResponse<any>> =>
    api.post(NotificationEndpoints.bind, payload),

  unbindDevice: (userId: string, deviceToken: string): Promise<AxiosResponse<any>> =>
    api.delete(NotificationEndpoints.unbind, { data: { userId, deviceToken } }),

  listDevices: (userId: string): Promise<AxiosResponse<any>> =>
    api.get(NotificationEndpoints.devices(userId)),

  history: (
    userId: string,
    type: NotificationHistoryType = 'all',
    pageNumber = 1,
    pageSize = 20
  ): Promise<AxiosResponse<any>> =>
    api.get(NotificationEndpoints.history(userId, type), { params: { pageNumber, pageSize } }),

  unreadCount: (userId: string): Promise<AxiosResponse<any>> =>
    api.get(NotificationEndpoints.unreadCount(userId)),

  markAllRead: (userId: string): Promise<AxiosResponse<any>> =>
    api.post(NotificationEndpoints.markAllRead(userId)),

  markRead: (userId: string, notificationId: string): Promise<AxiosResponse<any>> =>
    api.post(NotificationEndpoints.markRead(userId, notificationId)),
};

export const rowPayload = (row: any): Record<string, any> =>
  (row?.data?.data && typeof row.data.data === 'object' ? row.data.data : row?.data) || {};

export const rowEventType = (row: any): string => String(rowPayload(row)?.eventType || '');

export const rowIsUnread = (row: any): boolean =>
  row?.isRead === false || row?.read === false || row?.isUnRead === true;
