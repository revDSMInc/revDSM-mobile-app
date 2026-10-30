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
import { ACK_AMBER } from './chat-confirmation';
import { isGifFileMessage, isGifMessageText } from '../../../utils/gif-message';

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

  return Array.from(groups.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ label, data }) => ({ title: label, data: sortLeadThreadsByLeadTime(data) }));
}

function formatShortDate(value: any): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MM.dd.yy');
}

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

export function buildInstallerLeadHeading(leadDetails: any, leadId: string): string {
  const assignment = leadDetails?.installerAssignment;
  const jobNumber = String(assignment?.jobNumber || leadId || "").trim();
  const lastName = String(leadDetails?.customerDetails?.lastName || "").trim();
  const timeWindow = String(assignment?.timeWindow || "").trim();

  const heading = [jobNumber, lastName, timeWindow].filter(Boolean).join(" ");
  return heading || buildLeadHeading(leadDetails, leadId);
}

function getStatusProps(status?: string) {
  const config = STATUS_CONFIG[status || ''] || STATUS_CONFIG.notResulted;
  return { label: config.label, color: config.color, textColor: config.textColor };
}

export function getLeadIdDisplay(leadDetails: any) {
  return leadDetails?.leadId || leadDetails?.selfGenLeadId || 'N/A';
}

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

  return (
    <View
      className="rounded-lg items-center justify-center"
      style={{ width: 56, height: 56, backgroundColor: '#F4F6F8' }}
    >
      <MaterialCommunityIcon name="home-outline" size={26} color="#919EAB" />
    </View>
  );
}

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

  const senderName = lastMsg?.senderDetails?.firstName || 'User';
  // A GIF reads as an attachment once it is stored as one, so both shapes are checked.
  const messageContent =
    isGifMessageText(lastMsg?.message) || isGifFileMessage(lastMsg)
      ? 'Sent a GIF'
      : lastMsg?.message?.trim() || 'Sent an attachment';

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

export function ChannelThreadItem({ channel, onPress }: any) {
  const { colors, isDark } = useTheme();
  const { name, unread_count: unreadCount, description, icon_emoji, icon_url, require_ack: requireAck } = channel;
  const displayName = name || 'General';
  const scheme = CHANNEL_SCHEMES[displayName] || CHANNEL_SCHEMES.General;
  const tint = colors.primary.main;
  // REVDSM-1313: a channel that requires read confirmation still has unread posts —
  // show the amber "Confirm needed" badge beside the counter (QA mockup, REP 1).
  // Only a rep is asked for one, so only a rep is told one is waiting: the per-viewer
  // `requires_ack` answers that, and the setting alone is the older server's answer.
  const mustAck =
    channel?.permissions?.requires_ack !== undefined
      ? !!channel.permissions.requires_ack
      : !!requireAck;
  const confirmNeeded = mustAck && unreadCount > 0;
  const ackPalette = isDark ? ACK_AMBER.dark : ACK_AMBER.light;

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
        style={{ backgroundColor: tint + '20' }}
      >
        {icon_url ? (
          <Image source={{ uri: icon_url }} style={{ width: 48, height: 48, borderRadius: 8 }} />
        ) : (
          <Text className="text-lg">{icon_emoji || scheme.icon}</Text>
        )}
      </View>

      <View className="flex-1 pr-2">
        <Text className="font-semibold text-sm mb-0.5" style={{ color: '#1C252E' }}>
          {name}
        </Text>
        <Text className="text-xs" style={{ color: '#637381' }} numberOfLines={1}>
          {description || 'Team Communication Channel'}
        </Text>
        {confirmNeeded && (
          <View className="flex-row items-center mt-1.5">
            <View
              className="flex-row items-center px-2 py-[3px] rounded-full"
              style={{ backgroundColor: ackPalette.bg, borderWidth: 1, borderColor: ackPalette.border }}
            >
              <Icon name="alert-circle-outline" size={12} color={ackPalette.accent} />
              <Text
                className="ml-1"
                style={{ fontSize: 10, fontWeight: '800', color: ackPalette.accent }}
              >
                Confirm needed
              </Text>
            </View>
            {unreadCount > 0 && (
              <View
                className="w-5 h-5 rounded-full items-center justify-center ml-2"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Text className="text-white text-[9px] font-black">{unreadCount}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {!confirmNeeded && unreadCount > 0 && (
        <View className="w-5 h-5 rounded-full items-center justify-center mr-2" style={{ backgroundColor: colors.primary.main }}>
          <Text className="text-white text-[9px] font-black">{unreadCount}</Text>
        </View>
      )}
      <Icon name="chevron-forward" size={16} color="#C4CDD5" />
    </TouchableOpacity>
  );
}
