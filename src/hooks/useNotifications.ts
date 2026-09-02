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

/**
 * Notification history, unread badge and mark-read.
 *
 * Backs the Notification Center screen and the header bell. The push side of the
 * same feature lives in `hooks/usePushNotifications.ts`; both funnel taps through
 * `resolvePushRoute`, so a row and a banner can never land in different places.
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md §5.
 */

export const unreadCountKey = (userId?: string) => ['notification-unread', userId];
export const historyKey = (userId?: string, type: string = 'all') => [
  'notification-history',
  userId,
  type,
];

const PAGE_SIZE = 20;

/** Every route here enforces ownership — `:userId` must be the caller's own id. */
function useUserId(): string {
  const { user } = useAuth();
  return String((user as any)?._id || (user as any)?.id || '');
}

// ─── Unread badge ────────────────────────────────────────────────────────────

/**
 * The header bell's count.
 *
 * Polled rather than pushed: the contract describes this endpoint as
 * "cheap by design — intended to be polled without pulling a page". A foreground
 * push also invalidates this key (see `push-routing.invalidationKeysFor`), so the
 * badge moves the moment a notification lands rather than up to a minute later.
 */
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

  /**
   * Mirror to the OS badge so the springboard icon agrees with the in-app count.
   * ⚠️ Android only shows this on launchers that support badges; a failure here is
   * cosmetic and must never surface.
   */
  useEffect(() => {
    // Reached through the lazy shim: a build without the native modules must not
    // take the header bell down with it. See services/push-native.ts.
    getNativePush()?.notifee?.setBadgeCount(unreadCount)?.catch?.(() => {});
  }, [unreadCount]);

  return { unreadCount, isLoading: query.isLoading, refetch: query.refetch };
}

// ─── History ─────────────────────────────────────────────────────────────────

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

/**
 * ⚠️ Row ids come back under several spellings depending on the route. Reading a
 * fixed list rather than guessing one, the same discipline as `rowPayload`.
 */
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

  // A type change is a different list, not a later page of the same one.
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

// ─── Mark read ───────────────────────────────────────────────────────────────

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
        // Non-fatal: the row still opens. Marking read is a side effect of the tap,
        // not the point of it.
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

// ─── Presentation helpers ────────────────────────────────────────────────────

/**
 * Icon and tint per event family — the same three groupings as the Android
 * notification channels, so a row in the list reads as the banner that raised it.
 *
 * ⚠️ Takes the payload as well as the type because `addendum-signed` covers a
 * DECLINE too, and its title reads "Addendum signed" either way. Branching on
 * `data.outcome` is the only way to tell them apart — the rule the contract
 * states, applied here so a refusal does not wear the same badge as an approval.
 */
export function describeNotification(
  eventType: string,
  payload?: Record<string, any>
): {
  icon: string;
  color: string;
  group: string;
} {
  if (eventType === 'addendum-signed') {
    const outcome = addendumOutcome(payload as any);
    if (outcome === 'declined') {
      return { icon: 'file-document-remove-outline', color: '#A81F1B', group: 'Signatures' };
    }
    return { icon: 'file-document-edit-outline', color: '#9A5B08', group: 'Signatures' };
  }

  switch (eventType) {
    case 'chat-message':
    case 'chat-reply':
    case 'chat-file-upload':
      return { icon: 'chat-outline', color: '#0B6A85', group: 'Messages' };
    case 'chat-tagged':
      return { icon: 'at', color: '#0B6A85', group: 'Messages' };
    case 'lead-issued':
      return { icon: 'account-plus-outline', color: '#4CBB17', group: 'Leads' };
    case 'appointment-issued':
      return { icon: 'calendar-clock', color: '#4CBB17', group: 'Leads' };
    case 'lead-cancelled':
      return { icon: 'close-octagon-outline', color: '#A81F1B', group: 'Leads' };
    case 'agreement-signed':
      return { icon: 'file-sign', color: '#9A5B08', group: 'Signatures' };
    default:
      return { icon: 'bell-outline', color: '#6E7A71', group: 'Other' };
  }
}

/**
 * Hand-rolled rather than `toLocaleString`, for the reason `formatCaptureTime` in
 * `utils/inspection-photos.ts` gives: it must not depend on Intl being compiled
 * into the JS engine.
 */
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

/** Client-side unread filter — `:type` only accepts `all` or a real eventType. */
export function useUnreadFilter(rows: NotificationRow[], unreadOnly: boolean) {
  return useMemo(
    () => (unreadOnly ? rows.filter((r) => r.isUnread) : rows),
    [rows, unreadOnly]
  );
}
