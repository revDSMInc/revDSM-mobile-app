import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { LEAD_TYPE_BADGE } from './constants';
import { isSelfGeneratedLead } from '../../../utils/location-util';
import { resolveS3Url } from '../../../utils/s3-utils';
import { LeadService } from '../../../services/api/leads';
import Logo from '../../../assets/svgs/logo';

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

  return Array.from(groups.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ label, data }) => ({ title: label, data }));
}

/**
 * Appointment time slot, shown on the right of the row next to the relative
 * stamp. A lead with no slot renders nothing rather than a bare "N/A".
 */
function formatLeadTimeDisplay(leadDetails: any) {
  const leadTime = leadDetails?.leadTime || leadDetails?.appointmentTime;
  if (!leadTime || typeof leadTime !== 'string' || leadTime.trim().toUpperCase() === 'N/A') {
    return '';
  }
  return leadTime.toLowerCase().replace(/\s+/g, '');
}

function getLeadTypeBadge(leadDetails: any) {
  // Prefer the lead's own markers — `isSelfGeneratedLead` treats a MISSING
  // leadTime as self-gen, and the chat socket payload omits leadTime on some
  // issued leads, which mislabelled them.
  const status = leadDetails?.status;
  if (status === 'lfLead' || status === 'lf' || status === 'issued' || status === 'confirmedIssued') {
    return LEAD_TYPE_BADGE.issued;
  }
  if (leadDetails?.leadId) return LEAD_TYPE_BADGE.issued;
  if (isSelfGeneratedLead(leadDetails)) return LEAD_TYPE_BADGE.selfGenerated;
  return LEAD_TYPE_BADGE.issued;
}

function getLeadThumbnailUrl(leadDetails: any): string | null {
  const photos = leadDetails?.salesPhotos || leadDetails?.images || [];
  if (!Array.isArray(photos) || photos.length === 0) return null;

  const front =
    photos.find(
      (p: any) =>
        p.subcategory === 'front-image' ||
        p.subcategory === 'front_view' ||
        p.category?.toLowerCase()?.includes('home')
    ) || photos[0];

  return front?.secureUrl || front?.url || front?.displayUrl || resolveS3Url(front?.s3url) || null;
}

/** Human lead id — issued leads carry `leadId`, self-gens carry `selfGenLeadId`. */
function getLeadIdDisplay(leadDetails: any) {
  return leadDetails?.leadId || leadDetails?.selfGenLeadId || 'N/A';
}

// Secure-URL cache for lead preview thumbnails, shared across every row so the
// list does not re-request the same file on each re-render / scroll.
const previewUrlCache = new Map<string, string>();

/**
 * Resolve `leadDetails.previewImage` ({ bucketName, filePath }) into a signed
 * URL — this is where the web list gets its thumbnail (`chat-thread-item.js`).
 * The socket payload does NOT include `salesPhotos`, which is why the rows had
 * no images at all.
 */
function useLeadPreviewUrl(leadDetails: any): string | null {
  const direct = useMemo(() => getLeadThumbnailUrl(leadDetails), [leadDetails]);
  const preview = leadDetails?.previewImage;
  const cacheKey = preview?.filePath ? `${preview.bucketName}/${preview.filePath}` : '';

  const [secureUrl, setSecureUrl] = useState<string | null>(
    cacheKey ? previewUrlCache.get(cacheKey) || null : null
  );

  useEffect(() => {
    if (direct || !cacheKey || !preview?.bucketName || !preview?.filePath) return;

    const cached = previewUrlCache.get(cacheKey);
    if (cached) {
      setSecureUrl(cached);
      return;
    }

    let cancelled = false;
    LeadService.getSecureUrls([{ bucketName: preview.bucketName, filePath: preview.filePath }])
      .then((res) => {
        const item = res?.data?.data?.[0] || res?.data?.[0];
        const url = item?.secureUrl || item?.url || null;
        if (!url) return;
        previewUrlCache.set(cacheKey, url);
        if (!cancelled) setSecureUrl(url);
      })
      .catch((err) => {
        console.warn('[ChatThreads] Failed to resolve lead preview image:', err?.message || err);
      });

    return () => {
      cancelled = true;
    };
  }, [direct, cacheKey, preview?.bucketName, preview?.filePath]);

  return direct || secureUrl;
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

function getSenderName(message: any) {
  const fn = message?.senderDetails?.firstName;
  const ln = message?.senderDetails?.lastName;
  if (!fn && !ln) return 'User';
  return `${fn || ''} ${ln || ''}`.trim();
}

function LeadThreadThumbnail({ leadDetails }: { leadDetails: any }) {
  const thumbnailUrl = useLeadPreviewUrl(leadDetails);

  if (thumbnailUrl) {
    return (
      <Image
        source={{ uri: thumbnailUrl }}
        className="rounded-lg"
        style={{ width: 72, height: 72, backgroundColor: '#F4F6F8' }}
        resizeMode="cover"
      />
    );
  }

  // No photo on the lead yet → show the app logo instead of a generic house glyph.
  return (
    <View
      className="rounded-lg items-center justify-center"
      style={{ width: 72, height: 72, backgroundColor: '#F4F6F8' }}
    >
      <Logo width={58} height={20} />
    </View>
  );
}

// ─── LeadChatThreadItem ───────────────────────────────────────────────────────
export function LeadChatThreadItem({ chat, onPress }: any) {
  const { colors } = useTheme();
  const { leadDetails, unreadCount, recentMessages, lastMessageAt } = chat;

  const lastMsg = recentMessages?.[0];
  const senderName = lastMsg ? getSenderName(lastMsg) : '';
  const leadTime = formatLeadTimeDisplay(leadDetails);
  const typeBadge = getLeadTypeBadge(leadDetails);
  const leadIdDisplay = getLeadIdDisplay(leadDetails);
  const timeAgo = useMemo(
    () => formatLastMessageAgo(lastMessageAt || chat?.updatedAt || chat?.createdAt),
    [lastMessageAt, chat?.updatedAt, chat?.createdAt]
  );

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

      <View className="flex-1 ml-3 mr-2">
        <View className="flex-row items-center mb-1">
          {!!timeAgo && (
            <Text className="text-[11px] mr-2" style={{ color: '#919EAB' }}>
              {timeAgo}
            </Text>
          )}
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: typeBadge.color }}
          >
            <Text className="text-[10px] font-bold" style={{ color: typeBadge.textColor }}>
              {typeBadge.label}
            </Text>
          </View>
          {!!leadTime && (
            <Text className="text-xs font-semibold ml-auto pl-2" style={{ color: '#1C252E' }}>
              {leadTime}
            </Text>
          )}
        </View>

        <Text className="text-xs mb-1.5" style={{ color: '#637381' }} numberOfLines={1}>
          Lead ID: {leadIdDisplay}
        </Text>

        {lastMsg?.message ? (
          <View className="flex-row items-center pr-1">
            <Icon name="chatbubble-outline" size={14} color="#919EAB" style={{ marginRight: 4 }} />
            <Text className="text-xs flex-1" numberOfLines={1}>
              <Text style={{ color: colors.primary.main, fontWeight: '600' }}>
                {senderName}:{' '}
              </Text>
              <Text style={{ color: '#637381' }}>{lastMsg.message}</Text>
            </Text>
          </View>
        ) : (
          <Text className="text-xs italic" style={{ color: '#C4CDD5' }}>
            No Messages
          </Text>
        )}
      </View>

      <View className="items-center justify-center pl-1">
        {unreadCount > 0 ? (
          <View className="w-5 h-5 rounded-full items-center justify-center mb-1" style={{ backgroundColor: colors.primary.main }}>
            <Text className="text-white text-[9px] font-black">{unreadCount}</Text>
          </View>
        ) : null}
        <Icon name="chevron-forward" size={16} color="#C4CDD5" />
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
