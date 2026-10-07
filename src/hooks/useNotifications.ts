import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNativePush } from '../services/push-native';
import { useAuth } from './useAuth';
import { addendumOutcome } from '../utils/push-routing';
import {
  NotificationApi,
  rowPayload,
  rowEventType,
  rowIsUnread,
  type NotificationHistoryType,
} from '../services/api/notifications';

export const unreadCountKey = (userId?: string) => ['notification-unread', userId];
export const historyKey = (userId?: string, type: string = 'all') => [
  'notification-history',
  userId,
  type,
];

const PAGE_SIZE = 20;

function useUserId(): string {
  const { user } = useAuth();
  return String((user as any)?._id || (user as any)?.id || '');
}

export function useUnreadNotificationCount() {
  const userId = useUserId();

  const query = useQuery({
    queryKey: unreadCountKey(userId),
    queryFn: async () => {
      const res = await NotificationApi.unreadCount(userId);
      const body: any = res?.data;
      const count = body?.data?.unreadCount ?? body?.unreadCount ?? 0;
      return Number(count) || 0;
    },
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const unreadCount = query.data ?? 0;

  useEffect(() => {
    try {
      getNativePush()?.notifee?.setBadgeCount(unreadCount)?.catch?.(() => {});
    } catch {
    }
  }, [unreadCount]);

  return { unreadCount, isLoading: query.isLoading, refetch: query.refetch };
}

export interface NotificationRow {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  isUnread: boolean;
  eventType: string;
  payload: Record<string, any>;
  raw: any;
}

const rowId = (row: any): string =>
  String(row?._id || row?.id || row?.notificationId || '');

function normalizeRow(row: any): NotificationRow {
  return {
    id: rowId(row),
    title: String(row?.title || row?.data?.title || ''),
    message: String(row?.message || row?.body || row?.data?.message || ''),
    createdAt: String(row?.createdAt || row?.created_at || row?.updatedAt || ''),
    isUnread: rowIsUnread(row),
    eventType: rowEventType(row),
    payload: rowPayload(row),
    raw: row,
  };
}

export function useNotificationHistory(type: NotificationHistoryType = 'all') {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [type]);

  const query = useQuery({
    queryKey: [...historyKey(userId, type), page],
    queryFn: async () => {
      const res = await NotificationApi.history(userId, type, page, PAGE_SIZE);
      const body: any = res?.data;
      const payload = body?.data ?? body ?? {};
      const rows: any[] = payload?.data || payload?.notifications || [];
      return {
        rows: rows.map(normalizeRow),
        totalPages: Number(payload?.pagination?.totalPages) || 1,
        unreadCount: Number(payload?.unreadCount) || 0,
      };
    },
    enabled: Boolean(userId),
    staleTime: 15_000,
  });

  const hasMore = (query.data?.totalPages ?? 1) > page;

  const loadMore = useCallback(() => {
    if (hasMore && !query.isFetching) setPage((p) => p + 1);
  }, [hasMore, query.isFetching]);

  const refresh = useCallback(() => {
    setPage(1);
    queryClient.invalidateQueries({ queryKey: historyKey(userId, type) });
    queryClient.invalidateQueries({ queryKey: unreadCountKey(userId) });
  }, [queryClient, userId, type]);

  return {
    rows: query.data?.rows ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    page,
    hasMore,
    loadMore,
    refresh,
  };
}

export function useMarkNotificationsRead() {
  const userId = useUserId();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notification-history', userId] });
    queryClient.invalidateQueries({ queryKey: unreadCountKey(userId) });
  }, [queryClient, userId]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!userId || !notificationId) return;
      try {
        await NotificationApi.markRead(userId, notificationId);
      } catch (err) {
        console.warn('[Notifications] markRead failed:', err);
      } finally {
        invalidate();
      }
    },
    [userId, invalidate]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    try {
      await NotificationApi.markAllRead(userId);
    } catch (err) {
      console.warn('[Notifications] markAllRead failed:', err);
    } finally {
      invalidate();
    }
  }, [userId, invalidate]);

  return { markRead, markAllRead };
}

export const NOTIFICATION_TINTS = {
  pine: { color: '#1E5C43', tint: '#E7F0EA' },
  amber: { color: '#B4762C', tint: '#FBF0E1' },
  rust: { color: '#B0443A', tint: '#FBEAE8' },
  slate: { color: '#3E5C78', tint: '#E9EFF5' },
} as const;

export type NotificationFamily = keyof typeof NOTIFICATION_TINTS;

export function describeNotification(
  eventType: string,
  payload?: Record<string, any>
): {
  icon: string;
  color: string;
  tint: string;
  family: NotificationFamily;
  group: string;
} {
  const of = (
    family: NotificationFamily,
    icon: string,
    group: string
  ) => ({ icon, group, family, ...NOTIFICATION_TINTS[family] });

  if (eventType === 'addendum-signed') {
    const outcome = addendumOutcome(payload as any);
    if (outcome === 'declined') {
      return of('rust', 'file-document-remove-outline', 'Signatures');
    }
    return of('amber', 'pencil-outline', 'Signatures');
  }

  switch (eventType) {
    case 'chat-message':
    case 'chat-reply':
    case 'chat-file-upload':
      return of('slate', 'message-outline', 'Messages');
    case 'chat-tagged':
      return of('slate', 'at', 'Messages');
    case 'chat-reaction':
      return of('slate', 'emoticon-happy-outline', 'Messages');
    case 'lead-issued':
      return of('pine', 'account-plus-outline', 'Leads');
    case 'appointment-issued':
      return of('pine', 'calendar-clock', 'Leads');
    case 'lead-cancelled':
      return of('rust', 'close-circle-outline', 'Leads');
    case 'agreement-signed':
      return of('amber', 'pencil-outline', 'Signatures');
    default:
      return of('slate', 'bell-outline', 'Other');
  }
}

export function formatNotificationTime(iso: string): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!match) return '';
  const [, y, mo, d, hh, mm] = match;
  const hour = Number(hh);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  const now = new Date();
  const isToday =
    now.getFullYear() === Number(y) &&
    now.getMonth() + 1 === Number(mo) &&
    now.getDate() === Number(d);

  const time = `${h12}:${mm} ${suffix}`;
  return isToday ? time : `${Number(mo)}/${Number(d)}/${String(y).slice(2)} · ${time}`;
}

export function useUnreadFilter(rows: NotificationRow[], unreadOnly: boolean) {
  return useMemo(
    () => (unreadOnly ? rows.filter((r) => r.isUnread) : rows),
    [rows, unreadOnly]
  );
}
