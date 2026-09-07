import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import {
  useNotificationHistory,
  useMarkNotificationsRead,
  useUnreadNotificationCount,
  useUnreadFilter,
  describeNotification,
  formatNotificationTime,
  type NotificationRow,
} from '../../hooks/useNotifications';
import { resolvePushRoute } from '../../utils/push-routing';
import { LeadService } from '../../services/api/leads';
import { resolveBuildIds } from '../../hooks/usePushNotifications';
import { FlashMessage } from '../../config/message';

/**
 * Notification Center — the history side of the push feature.
 *
 * ⚠️ Tapping a row resolves its destination through the SAME `resolvePushRoute`
 * the push banner uses. That shared path is the whole reason the routing lives in
 * a pure module: a row and the banner that raised it can never disagree about
 * where they lead.
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md §5.
 */
export default function NotificationsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  /**
   * ⚠️ Always fetched as `all`. The `:type` path segment accepts ONLY `all` or an
   * exact eventType — a UI label like "Unread" returns 400 "Notification type not
   * found". The unread view is a client-side filter over the same list, which the
   * response already supports.
   */
  const { rows, isLoading, isFetching, isError, hasMore, loadMore, refresh } =
    useNotificationHistory('all');
  const { unreadCount } = useUnreadNotificationCount();
  const { markRead, markAllRead } = useMarkNotificationsRead();

  const visible = useUnreadFilter(rows, unreadOnly);

  const handleOpen = useCallback(
    async (row: NotificationRow) => {
      if (opening) return;

      if (row.isUnread && row.id) void markRead(row.id);

      const route = resolvePushRoute(row.payload as any);
      if (!route) {
        // A control event, or one whose payload names no destination. Marking it
        // read is still the right outcome — silently doing nothing is not.
        FlashMessage.info('Notification', 'There is nothing more to open for this one.');
        return;
      }

      try {
        setOpening(row.id);

        if (route.kind === 'leadList') {
          navigation.navigate('Leads');
          return;
        }

        // `agreement-signed` — the job can now be submitted, so land on the Job
        // Builder Summary. Same branch as the push tap; see usePushNotifications.
        if (route.kind === 'jobBuilder') {
          const res = await LeadService.getLeadDetailsById(route.leadId);
          const body: any = res?.data;
          const lead = body?.data?.lead || body?.data || body?.lead || body;
          if (!lead?._id && !lead?.id) {
            FlashMessage.error('Not found', 'That lead could not be loaded.');
            return;
          }

          // Same rule as the push tap: only an EXPLICIT "not dynamic" diverts to
          // the documents. The lead cannot answer this before the job is
          // submitted — see the note in usePushNotifications.
          if (route.isDynamic === false) {
            navigation.navigate('LeadCenter', { lead, tab: 'job_docs' });
            return;
          }

          // Shared with the push tap so a row and a banner cannot resolve a
          // different calculator — and so both benefit from the sales-portal
          // fallback when `lead/v1/details` has no calculator on it.
          const ids = await resolveBuildIds(lead);
          if (!ids.calculatorId) {
            navigation.navigate('LeadCenter', { lead, tab: 'job_docs' });
            return;
          }

          navigation.navigate('DynamicDealCenter', {
            // appointmentId merged onto the lead — see the note in
            // usePushNotifications; it is the only field resolveAppointmentId reads.
            lead: ids.appointmentId
              ? { ...ids.lead, appointmentId: ids.lead?.appointmentId || ids.appointmentId }
              : ids.lead,
            openJobBuilder: true,
            calculatorResultData: {
              calculatorId: ids.calculatorId,
              appointmentId: ids.appointmentId,
            },
          });
          return;
        }

        if (route.kind === 'lead') {
          // LeadCenter's params take a full lead object, not an id.
          // ⚠️ Same route as the push tap (`lead/v1/details/{id}`) — a row and a
          // banner must resolve the lead identically or they can land on
          // different data for the same notification.
          const res = await LeadService.getLeadDetailsById(route.leadId);
          const lead = (res?.data as any)?.data || res?.data;
          if (!lead) {
            FlashMessage.error('Not found', 'That lead could not be loaded.');
            return;
          }
          navigation.navigate('LeadCenter', { lead, tab: route.tab });
          return;
        }

        navigation.navigate('ChatDetail', {
          chatId: route.chatId,
          leadId: route.leadId,
          customerName: '',
          chatType: route.chatType,
        });
      } catch (err) {
        console.warn('[Notifications] open failed:', err);
        FlashMessage.error('Could not open', 'Please try again.');
      } finally {
        setOpening(null);
      }
    },
    [navigation, markRead, opening]
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationRow }) => {
      const meta = describeNotification(item.eventType, item.payload);
      const isOpening = opening === item.id;

      return (
        <TouchableOpacity
          onPress={() => handleOpen(item)}
          activeOpacity={0.7}
          style={[
            styles.row,
            {
              backgroundColor: item.isUnread ? '#F3F9EF' : colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: `${meta.color}1A` }]}>
            <Icon name={meta.icon} size={20} color={meta.color} />
          </View>

          <View style={styles.body}>
            <Text
              numberOfLines={2}
              style={[
                styles.title,
                { color: colors.text, fontWeight: item.isUnread ? '700' : '600' },
              ]}
            >
              {item.title || meta.group}
            </Text>
            {!!item.message && (
              <Text numberOfLines={3} style={[styles.message, { color: colors.textSecondary }]}>
                {item.message}
              </Text>
            )}
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {formatNotificationTime(item.createdAt)}
            </Text>
          </View>

          {isOpening ? (
            <ActivityIndicator size="small" color={meta.color} style={styles.trailing} />
          ) : (
            item.isUnread && <View style={[styles.dot, { backgroundColor: '#D32F2F' }]} />
          )}
        </TouchableOpacity>
      );
    },
    [colors, handleOpen, opening]
  );

  return (
    /**
     * ⚠️ The top inset is applied EXPLICITLY, not through `SafeAreaView`.
     *
     * `App.tsx` paints an absolutely-positioned status-bar strip of `insets.top`
     * at zIndex 9999, and this screen is not in the navigator's `showHeader`
     * list — so the navigator's own SafeAreaView passes `edges={[]}` and applies
     * nothing. A nested `SafeAreaView edges={['top']}` did NOT reliably apply the
     * padding here (the header still rendered under the strip), so the inset is
     * added directly to the header instead. Deterministic, and it cannot be
     * defeated by SafeAreaView nesting semantics.
     *
     * Do not "simplify" this back to SafeAreaView without checking on a device
     * that the title clears the status bar.
     */
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="chevron-left" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity
            onPress={() => markAllRead()}
            style={styles.markAllBtn}
            accessibilityRole="button"
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          // Keeps the title optically centred against the back chevron whether or
          // not the action is present.
          <View style={styles.markAllPlaceholder} />
        )}
      </View>

      {/* All / Unread */}
      <View
        style={[
          styles.tabs,
          { borderBottomColor: colors.border, backgroundColor: colors.surface },
        ]}
      >
        {[
          { key: false, label: 'All' },
          { key: true, label: unreadCount > 0 ? `Unread (${unreadCount})` : 'Unread' },
        ].map((tab) => {
          const active = unreadOnly === tab.key;
          return (
            <TouchableOpacity
              key={String(tab.key)}
              onPress={() => setUnreadOnly(tab.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? '#3A8F14' : colors.textSecondary },
                  active && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading && rows.length === 0 ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color="#4CBB17" />
        </View>
      ) : isError && rows.length === 0 ? (
        <View style={styles.centre}>
          <Icon name="wifi-off" size={44} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Couldn&rsquo;t load notifications
          </Text>
          <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item, index) => item.id || `row-${index}`}
          renderItem={renderItem}
          // flexGrow lets the empty state centre in the available space instead of
          // sitting just under the tabs; paddingBottom keeps the last row clear of
          // the gesture bar.
          contentContainerStyle={
            visible.length === 0
              ? styles.listEmpty
              : { paddingBottom: insets.bottom + 24 }
          }
          onEndReached={() => {
            // Pagination off an empty list is never meaningful, and FlatList fires
            // onEndReached on mount whenever the content is shorter than the viewport.
            if (visible.length > 0) loadMore();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && rows.length > 0}
              onRefresh={refresh}
              tintColor="#4CBB17"
            />
          }
          ListEmptyComponent={
            <View style={styles.centre}>
              <Icon name="bell-off-outline" size={44} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {unreadOnly ? 'Nothing unread' : 'No notifications yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                {unreadOnly
                  ? 'You are all caught up.'
                  : 'Messages, leads and signed documents will appear here.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore && visible.length > 0 ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color="#4CBB17" />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The three header elements are given explicit separation: the chevron sits in
   * its own tinted circle, the title is offset from it, and "Mark all read" is a
   * pill rather than bare text. Run together as plain siblings they read as one
   * merged strip — the title looked like a label on the back button and the
   * action looked like part of the title.
   */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 20, 0.05)',
  },
  headerTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginLeft: 12,
    marginRight: 8,
  },
  markAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#EAF5E3',
    borderWidth: 1,
    borderColor: '#CFE7C0',
  },
  markAllPlaceholder: { width: 4 },
  markAllText: { color: '#3A8F14', fontSize: 12.5, fontWeight: '700' },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: 12 },
  tab: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#4CBB17' },
  tabText: { fontSize: 14, fontWeight: '600' },
  tabTextActive: { fontWeight: '700' },

  row: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, alignItems: 'flex-start' },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  body: { flex: 1 },
  title: { fontSize: 14.5, marginBottom: 2 },
  message: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  time: { fontSize: 11.5 },
  trailing: { marginLeft: 8, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8, marginTop: 6 },

  root: { flex: 1 },
  listEmpty: { flexGrow: 1 },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 14, marginBottom: 6, textAlign: 'center' },
  emptyBody: { fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 16, backgroundColor: '#4CBB17', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  footer: { paddingVertical: 18 },
});
