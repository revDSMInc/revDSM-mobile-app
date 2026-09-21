import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { STATUS_CONFIG } from './constants';
import { useLeadPreviewUrl } from '../../../hooks/useLeadPreviewUrl';
import { buildJobNumber } from '../../../utils/office-initials';
import { sortLeadThreadsByLeadTime } from '../../../utils/lead-thread-order';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';

// ─── MainTabOption ────────────────────────────────────────────────────────────
export function MainTabOption({ label, active, onPress }: any) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 pb-2 items-center justify-center"
      style={{
        borderBottomWidth: active ? 3 : 0,
        borderColor: active ? colors.primary.main : 'transparent',
      }}
    >
      <Text
        className="font-semibold text-sm"
        style={{ color: active ? colors.primary.main : '#919EAB' }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── StatusChip ───────────────────────────────────────────────────────────────
export function StatusChip({ label, active, onPress, count, specialMode }: any) {
  const { colors, isDark } = useTheme();

  let activeBg = isDark ? '#ffffff' : '#000000';
  let labelColor = isDark ? '#000000' : '#ffffff';

  if (specialMode === 'all') {
    activeBg = isDark ? '#3b82f6' : '#2563eb';
    labelColor = '#fff';
  } else if (specialMode === 'current') {
    activeBg = '#10b981';
    labelColor = '#fff';
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mr-2.5 px-4 py-2 h-10 rounded-xl flex-row items-center border"
      style={{
        backgroundColor: active ? activeBg : 'transparent',
        borderColor: active ? activeBg : isDark ? '#334155' : '#e2e8f0',
      }}
    >
      {specialMode === 'current' && (
        <Icon
          name="flash"
          size={10}
          color={active ? 'white' : '#10b981'}
          style={{ marginRight: 6 }}
        />
      )}
      <Text
        className="text-[10px] font-black tracking-widest"
        style={{ color: active ? labelColor : colors.textSecondary }}
      >
        {label}
      </Text>
      {count > 0 && (
        <View className="ml-2 w-4 h-4 rounded-full bg-red-500 items-center justify-center">
          <Text className="text-white text-[8px] font-black">{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── DateSectionHeader ────────────────────────────────────────────────────────
export function DateSectionHeader({ label }: { label: string }) {
  return (
    <View className="flex-row items-center my-3">
      <View className="flex-1 h-px" style={{ backgroundColor: '#DFE3E8' }} />
      <Text
        className="mx-3 text-[11px] font-bold tracking-wider"
        style={{ color: '#919EAB' }}
      >
        {label}
      </Text>
      <View className="flex-1 h-px" style={{ backgroundColor: '#DFE3E8' }} />
    </View>
  );
}

export function getDateSectionLabel(dateStr?: string): string {
  if (!dateStr) return 'OLDER';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'OLDER';
  const monthDay = format(date, 'MMM dd').toUpperCase();
  if (isToday(date)) return `TODAY • ${monthDay}`;
  if (isYesterday(date)) return `YESTERDAY • ${monthDay}`;
  return `${format(date, 'EEE').toUpperCase()} • ${monthDay}`;
}

export function groupChatsByLeadDate(chats: any[]) {
  const groups = new Map<string, { label: string; sortKey: number; data: any[] }>();

  chats.forEach((chat) => {
    const dateKey =
      chat.leadDetails?.leadDate ||
      chat.leadDetails?.leadDatetime ||
      chat.lastMessageAt ||
      chat.createdAt;
    const label = getDateSectionLabel(dateKey);
    const sortKey = dateKey ? new Date(dateKey).getTime() : 0;

    if (!groups.has(label)) {
      groups.set(label, { label, sortKey, data: [] });
    }
    groups.get(label)!.data.push(chat);
  });

  // Sections stay newest-day-first; the ROWS inside a day read forwards (9am, 11am, 1pm,
  // 3pm) off each lead's own appointment time, self-gens taking their creation time. See
  // `utils/lead-thread-order.ts` - `useChatThreads` sorts by chat recency, which bears no
  // relation to the time printed on the card.
  return Array.from(groups.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ label, data }) => ({ title: label, data: sortLeadThreadsByLeadTime(data) }));
}

/** `MM.dd.yy`, or '' for a missing / unparseable date (web uses date-fns `format`). */
function formatShortDate(value: any): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MM.dd.yy');
}

/**
 * Card heading, ported 1:1 from web `chat-thread-item.js`:
 *   sale               → office-prefixed job number (e.g. "STN/A", "FL803")
 *   installer assigned → "{jobNumber} {lastName} {date}"
 *   otherwise          → "Lead {leadDate} {leadTime}"  e.g. "Lead 07.22.26 9am"
 * The sale branch prefixes the office initials via `buildJobNumber` exactly like
 * web (`buildJobNumber(assignedRepDetails, jobNumber || leadId)`).
 */
function buildLeadHeading(leadDetails: any, leadId: string): string {
  const status = leadDetails?.status;
  const installerAssignment = leadDetails?.installerAssignment;

  if (status === 'sale') {
    const jobNum = installerAssignment?.jobNumber || leadId;
    return buildJobNumber(leadDetails?.assignedRepDetails, jobNum);
  }
  if (installerAssignment) {
    const jobNumber = installerAssignment.jobNumber || '';
    const lastName = leadDetails?.customerDetails?.lastName || '';
    return `${jobNumber} ${lastName} ${formatShortDate(leadDetails?.leadDate)}`.trim();
  }

  const rawLeadTime = leadDetails?.leadTime || '';
  const leadTime =
    rawLeadTime && String(rawLeadTime).trim().toUpperCase() === 'N/A'
      ? ''
      : rawLeadTime
        ? String(rawLeadTime).toLowerCase().replace(/\s/g, '')
        : '';
  return `Lead ${formatShortDate(leadDetails?.leadDate)} ${leadTime}`.trim();
}

/**
 * The INSTALLER's heading: `{jobNumber} {lastName} {timeWindow}` - e.g.
 * "1272 test two 8AM-12PM". All three come off the job the crew is being sent to:
 * `installerAssignment.jobNumber`, `customerDetails.lastName` and
 * `installerAssignment.timeWindow`.
 *
 * WARNING deliberate divergence from web, and it is NOT enough to reorder
 * `buildLeadHeading`'s branches. That function already carries a
 * `{jobNumber} {lastName} {date}` arm, but the `status === 'sale'` arm above it
 * catches every install job (an installer only ever sees sold leads), so the arm is
 * unreachable in practice. Web has the same ordering on purpose - a sales rep reads
 * the office-prefixed job number ("OR1272") - so the installer gets its own builder
 * rather than the shared one being re-ordered underneath sales.
 *
 * Each segment is dropped when missing rather than rendering a blank or "N/A", so an
 * unassigned or window-less job degrades to what IS known instead of reading as a
 * broken row.
 */
export function buildInstallerLeadHeading(leadDetails: any, leadId: string): string {
  const assignment = leadDetails?.installerAssignment;
  // `leadId` is the same fallback the sale branch uses, so a job whose number has not
  // been issued yet is still identified rather than opening with the customer name.
  const jobNumber = String(assignment?.jobNumber || leadId || "").trim();
  const lastName = String(leadDetails?.customerDetails?.lastName || "").trim();
  const timeWindow = String(assignment?.timeWindow || "").trim();

  const heading = [jobNumber, lastName, timeWindow].filter(Boolean).join(" ");
  // Nothing known at all - fall back to the shared builder rather than an empty row.
  return heading || buildLeadHeading(leadDetails, leadId);
}

/** Status chip label + colours, via web's `STATUS_CONFIG` (unmapped → notResulted). */
function getStatusProps(status?: string) {
  const config = STATUS_CONFIG[status || ''] || STATUS_CONFIG.notResulted;
  return { label: config.label, color: config.color, textColor: config.textColor };
}

/** Human lead id — issued leads carry `leadId`, self-gens carry `selfGenLeadId`. */
export function getLeadIdDisplay(leadDetails: any) {
  return leadDetails?.leadId || leadDetails?.selfGenLeadId || 'N/A';
}

/**
 * "4 days ago" relative stamp of the last message — shown top-right of each row,
 * same as the previous list UI (and the web `chat-thread-item.js`).
 */
function formatLastMessageAgo(lastMessageAt?: string | null) {
  if (!lastMessageAt) return '';
  const date = new Date(lastMessageAt);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true }).replace(/^about\s/, '');
}

function LeadThreadThumbnail({ leadDetails }: { leadDetails: any }) {
  const thumbnailUrl = useLeadPreviewUrl(leadDetails);

  if (thumbnailUrl) {
    return (
      <Image
        source={{ uri: thumbnailUrl }}
        className="rounded-lg"
        style={{ width: 56, height: 56, backgroundColor: '#F4F6F8' }}
        resizeMode="cover"
      />
    );
  }

  // No preview image or street-view on the lead yet → home-outline placeholder,
  // matching web's `mdi:home-outline` in the disabled-text colour.
  return (
    <View
      className="rounded-lg items-center justify-center"
      style={{ width: 56, height: 56, backgroundColor: '#F4F6F8' }}
    >
      <MaterialCommunityIcon name="home-outline" size={26} color="#919EAB" />
    </View>
  );
}

// ─── LeadChatThreadItem ───────────────────────────────────────────────────────
export function LeadChatThreadItem({ chat, onPress, installerView }: any) {
  const { colors } = useTheme();
  const { leadDetails, unreadCount, recentMessages, lastMessageAt } = chat;

  const lastMsg = recentMessages?.[0];
  const leadIdDisplay = getLeadIdDisplay(leadDetails);
  const heading = installerView
    ? buildInstallerLeadHeading(leadDetails, leadIdDisplay)
    : buildLeadHeading(leadDetails, leadIdDisplay);
  const status = getStatusProps(leadDetails?.status);
  const timeAgo = useMemo(
    () => formatLastMessageAgo(lastMessageAt || chat?.updatedAt || chat?.createdAt),
    [lastMessageAt, chat?.updatedAt, chat?.createdAt]
  );

  // Web `renderMessagePreview`: sender first name in green, an attachment-only
  // message falls back to "Sent an attachment" rather than reading "No Messages".
  const senderName = lastMsg?.senderDetails?.firstName || 'User';
  const messageContent = lastMsg?.message?.trim() || 'Sent an attachment';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="mb-3 p-3 rounded-xl flex-row items-center"
      style={{
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: unreadCount > 0 ? colors.primary.main : '#F4F6F8',
      }}
    >
      <LeadThreadThumbnail leadDetails={leadDetails} />

      <View className="flex-1 ml-3">
        {/* Row 1: Heading + relative time */}
        <View className="flex-row items-center mb-0.5">
          <Text
            className="font-bold flex-1"
            style={{ color: '#1C252E', fontSize: 15 }}
            numberOfLines={1}
          >
            {heading}
          </Text>
          {!!timeAgo && (
            <Text className="text-[11px] ml-2" style={{ color: '#919EAB' }} numberOfLines={1}>
              {timeAgo}
            </Text>
          )}
        </View>

        {/* Row 2: Lead ID + status chip */}
        <View className="flex-row items-center mb-1">
          <Text className="text-xs font-medium" style={{ color: '#919EAB' }}>
            Lead ID: {leadIdDisplay}
          </Text>
          <View className="ml-2 px-1.5 py-0.5 rounded" style={{ backgroundColor: status.color }}>
            <Text
              className="text-[10px] font-extrabold"
              style={{ color: status.textColor, textTransform: 'uppercase' }}
            >
              {status.label}
            </Text>
          </View>
        </View>

        {/* Row 3: Message preview + unread badge + chevron */}
        <View className="flex-row items-center">
          <View className="flex-1 flex-row items-center pr-1">
            {lastMsg ? (
              <>
                <Icon name="chatbubble-outline" size={14} color="#919EAB" style={{ marginRight: 4 }} />
                <Text
                  className="text-xs flex-1"
                  numberOfLines={1}
                  style={unreadCount > 0 ? { fontWeight: '600' } : undefined}
                >
                  <Text style={{ color: colors.primary.main, fontWeight: '700' }}>
                    {senderName}:{' '}
                  </Text>
                  <Text style={{ color: unreadCount > 0 ? '#1C252E' : '#637381' }}>
                    {messageContent}
                  </Text>
                </Text>
              </>
            ) : (
              <Text className="text-xs italic" style={{ color: '#C4CDD5' }}>
                No Messages
              </Text>
            )}
          </View>
          <View className="flex-row items-center">
            {unreadCount > 0 && (
              <View
                className="w-5 h-5 rounded-full items-center justify-center mr-1"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Text className="text-white text-[9px] font-black">{unreadCount}</Text>
              </View>
            )}
            <Icon name="chevron-forward" size={16} color="#C4CDD5" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const CHANNEL_SCHEMES: Record<string, { icon: string; color: string }> = {
  Announcements: { icon: '📢', color: '#FF6B6B' },
  'Sales Wins': { icon: '🎉', color: '#51CF66' },
  General: { icon: '💬', color: '#748FFC' },
  Files: { icon: '📁', color: '#339AF0' },
  Commission: { icon: '💰', color: '#FFC107' },
  'Commission Sheets': { icon: '💰', color: '#FFC107' },
  Questions: { icon: '❓', color: '#9775FA' },
};

// ─── ChannelThreadItem ────────────────────────────────────────────────────────
export function ChannelThreadItem({ channel, onPress }: any) {
  const { colors, isDark } = useTheme();
  const { title, name, unreadCount, channelConfig } = channel;
  const displayName = title || name || 'General';
  const scheme = CHANNEL_SCHEMES[displayName] || CHANNEL_SCHEMES.General;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-3 p-4 rounded-xl border flex-row items-center"
      style={{
        borderColor: isDark ? '#2A2A2A' : '#F4F6F8',
        backgroundColor: isDark ? colors.surface : '#fff',
      }}
    >
      <View
        className="w-12 h-12 rounded-lg items-center justify-center mr-3"
        style={{ backgroundColor: scheme.color + '20' }}
      >
        <Text className="text-lg">{scheme.icon}</Text>
      </View>

      <View className="flex-1 pr-2">
        <Text className="font-semibold text-sm mb-0.5" style={{ color: '#1C252E' }}>
          {title || name}
        </Text>
        <Text className="text-xs" style={{ color: '#637381' }} numberOfLines={1}>
          {channelConfig?.description || 'Team Communication Channel'}
        </Text>
      </View>

      {unreadCount > 0 && (
        <View className="w-5 h-5 rounded-full items-center justify-center mr-2" style={{ backgroundColor: colors.primary.main }}>
          <Text className="text-white text-[9px] font-black">{unreadCount}</Text>
        </View>
      )}
      <Icon name="chevron-forward" size={16} color="#C4CDD5" />
    </TouchableOpacity>
  );
}
