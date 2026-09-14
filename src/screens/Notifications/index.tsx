import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import {
  useNotificationHistory,
  useMarkNotificationsRead,
  useUnreadNotificationCount,
  useUnreadFilter,
  describeNotification,
  type NotificationRow,
} from '../../hooks/useNotifications';
import {
  buildNotificationSections,
  endHintFor,
  todayKey,
  type NotificationItem,
} from '../../utils/notification-groups';
import { resolvePushRoute } from '../../utils/push-routing';
import { isLeadResulted } from '../../utils/lead-result-status';
import { LeadService } from '../../services/api/leads';
import { resolveBuildIds } from '../../hooks/usePushNotifications';
import { FlashMessage } from '../../config/message';
import { useIsOnline } from '../../hooks/useIsOnline';
import { offlineNoticeFor } from '../../utils/offline-capability';

/**
 * Notification Center — the history side of the push feature.
 *
 * The layout is the `notify-ui.txt` redesign: a paper ground, day sections, and
 * one bordered CARD PER NOTIFICATION. ⚠️ Nothing is grouped — an earlier pass
 * merged adjacent notifications about the same lead into a shared card and hid
 * repeats behind a disclosure, and that was reversed on request. Day bucketing
 * is all `utils/notification-groups.ts` does now; this file only paints it.
 *
 * ⚠️ Tapping a row resolves its destination through the SAME `resolvePushRoute`
 * the push banner uses. That shared path is the whole reason the routing lives in
 * a pure module: a row and the banner that raised it can never disagree about
 * where they lead.
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md §5.
 */

/**
 * The redesign's palette, verbatim from `notify-ui.txt`'s `:root`.
 *
 * ⚠️ Written as literals rather than pulled from `useTheme()`. This screen is a
 * standalone surface with its own warm "paper" ground (`#F6F5F0`), which is not a
 * colour the app's palette has — reading `colors.background` here would put the
 * cards on plain white and lose the whole separation the design rests on. The app
 * is light-only today (`ThemeProvider` forces it), so there is no dark variant to
 * miss; give this block a dark twin if that ever changes.
 */
const C = {
  ink: '#152018',
  inkSoft: '#4B594E',
  inkFaint: '#8B968D',
  paper: '#F6F5F0',
  card: '#FFFFFF',
  line: '#E6E3DA',
  pine: '#1E5C43',
  pineTint: '#E7F0EA',
  /**
   * The unread wash. The design paints a left-to-right gradient
   * (`rgba(30,92,67,0.06)` → transparent); this repo ships no gradient library
   * and pulling `react-native-svg` in behind every row to fake one is not worth
   * it, so this is that tint flattened over white. The 3px pine rail beside it is
   * what actually carries the "unread" signal.
   */
  unreadWash: '#F1F6F2',
};

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export default function NotificationsScreen() {
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
  const online = useIsOnline();
  const { rows, isLoading, isFetching, isError, hasMore, loadMore, refresh } =
    useNotificationHistory('all');
  const { unreadCount } = useUnreadNotificationCount();
  const { markRead, markAllRead } = useMarkNotificationsRead();

  const visible = useUnreadFilter(rows, unreadOnly);

  /**
   * `today` is read once per render pass rather than inside the grouper, so every
   * day heading on one screen is measured against the same instant — a list that
   * re-groups across midnight cannot end up with two "Today" sections.
   */
  const sections = useMemo(
    () => buildNotificationSections(visible, todayKey()),
    [visible]
  );
  const endHint = useMemo(
    () => (hasMore ? '' : endHintFor(visible, todayKey())),
    [visible, hasMore]
  );

  const handleOpen = useCallback(
    async (item: NotificationItem<NotificationRow>) => {
      if (opening) return;
      const row = item.row;

      // One row per card, so one id to clear — nothing is hidden behind this one.
      if (item.isUnread && row.id) void markRead(row.id);

      const route = resolvePushRoute(row.payload as any);
      if (!route) {
        // A control event, or one whose payload names no destination. Marking it
        // read is still the right outcome — silently doing nothing is not.
        FlashMessage.info('Notification', 'There is nothing more to open for this one.');
        return;
      }

      try {
        setOpening(item.key);

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

          /**
           * ⚠️ A RESULTED lead goes to its own screen, NOT the Job Builder.
           *
           * The branch below exists because signing the agreement is what
           * UNBLOCKS submitting the job, so the rep's next action is normally
           * "Complete Job". Once the lead is resulted that is no longer true —
           * the deal is on the Lead Center, which is where the agreement, the
           * contract details and the addendums all live — and dropping the rep
           * into a builder for a job that is already done reads as though the
           * app has lost the submission.
           *
           * ⚠️ Kept in step with the push tap in `hooks/usePushNotifications.ts`,
           * which runs the same check against the same helper. A row and the
           * banner that raised it must never land on different screens.
           */
          if (isLeadResulted(lead)) {
            // No `tab`, so the screen opens on its own default — the lead's main
            // view rather than a sub-tab chosen by a notification.
            navigation.navigate('LeadCenter', { lead });
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
    ({ item }: { item: NotificationItem<NotificationRow> }) => {
      const meta = describeNotification(item.row.eventType, item.row.payload);
      const isOpening = opening === item.key;

      // One notification, one card. The row is the card's only child, so it
      // carries no divider — there is never a sibling beneath it.
      return (
        <TouchableOpacity
          onPress={() => handleOpen(item)}
          activeOpacity={0.75}
          style={[styles.card, styles.item, item.isUnread && styles.itemUnread]}
        >
          {item.isUnread && <View style={styles.rail} />}

          <View
            style={[styles.bubble, { backgroundColor: meta.tint }, !item.isUnread && styles.bubbleRead]}
          >
            <Icon name={meta.icon} size={19} color={meta.color} />
          </View>

          <View style={styles.itemBody}>
            <View style={styles.itemTop}>
              <Text
                numberOfLines={2}
                style={[styles.itemTitle, !item.isUnread && styles.itemTitleRead]}
              >
                {item.title || meta.group}
              </Text>
              {isOpening ? (
                <ActivityIndicator size="small" color={meta.color} style={styles.spinner} />
              ) : (
                !!item.time && <Text style={styles.itemTime}>{item.time}</Text>
              )}
            </View>

            {!!item.message && (
              <Text numberOfLines={3} style={styles.itemDesc}>
                {item.message}
              </Text>
            )}

            {!!item.tag && (
              <View style={styles.tagWrap}>
                <Text style={styles.tag}>{item.tag}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [handleOpen, opening]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { label: string; date: string } }) => (
      <View style={styles.dayRow}>
        <Text style={styles.dayLabel}>{section.label}</Text>
        {!!section.date && <Text style={styles.dayDate}>{section.date}</Text>}
        <View style={styles.dayRule} />
      </View>
    ),
    []
  );

  const isEmpty = sections.length === 0;

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
    <View style={styles.root}>
      {/* Header — sits on the paper ground, so it carries no rule of its own;
          the tab strip below it is what separates the header from the list. */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon name="chevron-left" size={22} color={C.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          <TouchableOpacity
            onPress={() => markAllRead()}
            // Kept mounted at zero so the header does not reflow the moment the
            // last notification is read.
            disabled={unreadCount === 0}
            style={[styles.markAllBtn, unreadCount === 0 && styles.markAllDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabs}>
          {[
            { key: false, label: 'All' },
            { key: true, label: 'Unread' },
          ].map((tab) => {
            const active = unreadOnly === tab.key;
            return (
              <TouchableOpacity
                key={String(tab.key)}
                onPress={() => setUnreadOnly(tab.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                {tab.key === true && unreadCount > 0 && (
                  <View style={[styles.tabCount, active && styles.tabCountActive]}>
                    <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>
                      {unreadCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isLoading && rows.length === 0 ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={C.pine} />
        </View>
      ) : isError && rows.length === 0 ? (
        <View style={styles.centre}>
          <Icon name="wifi-off" size={44} color={C.inkFaint} />
          {/*
            ⚠️ A failed read and an unreachable one are different, and the generic wording covered
            both — so a rep with no signal was told the app "couldn't load", which reads as a fault
            and invites them to keep retrying. Offline is a wait, not a failure, and saying so is
            the whole difference. Try Again stays either way: it is the right control the moment
            signal returns, and the flag can be wrong.
          */}
          <Text style={styles.emptyTitle}>
            {online ? 'Couldn\u2019t load notifications' : offlineNoticeFor('notifications')?.title}
          </Text>
          {!online && (
            <Text style={styles.emptyBody}>{offlineNoticeFor('notifications')?.message}</Text>
          )}
          <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          // A sticky day heading over a card list reads as a second header; the
          // design pins only the screen header.
          stickySectionHeadersEnabled={false}
          contentContainerStyle={
            isEmpty ? styles.listEmpty : { paddingBottom: insets.bottom + 24 }
          }
          onEndReached={() => {
            // Pagination off an empty list is never meaningful, and the list fires
            // onEndReached on mount whenever the content is shorter than the viewport.
            if (!isEmpty) loadMore();
          }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && rows.length > 0}
              onRefresh={refresh}
              tintColor={C.pine}
            />
          }
          ListEmptyComponent={
            <View style={styles.centre}>
              <Icon name="bell-off-outline" size={44} color={C.inkFaint} />
              <Text style={styles.emptyTitle}>
                {unreadOnly ? 'Nothing unread' : 'No notifications yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {unreadOnly
                  ? 'You are all caught up.'
                  : 'Messages, leads and signed documents will appear here.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore && !isEmpty ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={C.pine} />
              </View>
            ) : endHint ? (
              <Text style={styles.endHint}>{endHint}</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },

  header: { backgroundColor: C.paper, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },
  headerTitle: {
    flex: 1,
    // The design sets a serif here; this app bundles Public Sans only, so the
    // heading is carried by size and tighter tracking instead of a second family.
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: C.ink,
    marginLeft: 12,
    marginRight: 8,
  },
  markAllBtn: { paddingVertical: 8, paddingHorizontal: 2 },
  markAllDisabled: { opacity: 0.35 },
  markAllText: { color: C.pine, fontSize: 14, fontWeight: '700' },

  tabs: { flexDirection: 'row', marginTop: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 11,
    marginRight: 22,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: C.pine },
  tabText: { fontSize: 15, fontWeight: '700', color: C.inkFaint },
  tabTextActive: { color: C.ink },
  tabCount: {
    marginLeft: 6,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: C.pineTint,
    alignItems: 'center',
  },
  tabCountActive: { backgroundColor: C.pine },
  tabCountText: { fontSize: 12, fontWeight: '700', color: C.pine },
  tabCountTextActive: { color: '#FFFFFF' },

  dayRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 18, paddingBottom: 9, paddingHorizontal: 22 },
  dayLabel: { fontSize: 13, fontWeight: '800', color: C.ink },
  dayDate: { fontSize: 12, fontWeight: '600', color: C.inkFaint, marginLeft: 8 },
  dayRule: { flex: 1, height: 1, backgroundColor: C.line, marginLeft: 8 },

  card: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    // Clips the unread rail and the row wash to the card's corners. Safe here
    // because the card carries no shadow — iOS drops a shadow on a view that
    // sets overflow:hidden (see the inspection-photo card in CLAUDE.md).
    overflow: 'hidden',
  },

  item: { paddingVertical: 14, paddingHorizontal: 14 },
  itemUnread: { backgroundColor: C.unreadWash },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: C.pine },
  bubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  bubbleRead: { opacity: 0.72 },

  itemBody: { flex: 1, minWidth: 0 },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 20, color: C.ink, marginRight: 8 },
  itemTitleRead: { color: C.inkSoft },
  itemTime: { fontSize: 12, fontWeight: '600', color: C.inkFaint, paddingTop: 2 },
  spinner: { marginTop: 2 },
  itemDesc: { fontSize: 13.5, lineHeight: 19, color: C.inkSoft, marginTop: 2 },

  // A wrapping View rather than a styled Text, so the chip hugs its content
  // instead of stretching to the row.
  tagWrap: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
  },
  tag: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: C.inkSoft },

  listEmpty: { flexGrow: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 14, marginBottom: 6, textAlign: 'center', color: C.ink },
  emptyBody: { fontSize: 13.5, textAlign: 'center', lineHeight: 19, color: C.inkSoft },
  retryBtn: { marginTop: 16, backgroundColor: C.pine, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  footer: { paddingVertical: 18 },
  endHint: { textAlign: 'center', color: C.inkFaint, fontSize: 12.5, paddingTop: 20, paddingBottom: 8, paddingHorizontal: 20 },
});
