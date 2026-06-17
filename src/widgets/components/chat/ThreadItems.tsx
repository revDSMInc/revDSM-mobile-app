import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import { format, formatDistanceToNow } from 'date-fns';
import { STATUS_CONFIG } from './constants';

// ─── MainTabOption ────────────────────────────────────────────────────────────
// NOTE: Conditional dark: variants are intentionally avoided here.
// NativeWind v4 requires dark: classes to be present from initial render.
// Dynamic addition triggers printUpgradeWarning → navigation proxy crash.
// All dynamic theming uses isDark from useTheme() + style prop instead.
export function MainTabOption({ label, active, onPress, count }: any) {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 py-1.5 items-center justify-center rounded-xl flex-row"
      style={
        active
          ? {
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            borderBottomWidth: 2,
            borderColor: isDark ? '#1e293b' : colors.primary.main,
          }
          : {}
      }
    >
      <Text
        className="font-semibold text-sm"
        style={{ color: active ? colors.primary.main : '#8D90A4' }}
      >
        {label}
      </Text>
      {count > 0 && (
        <View className="ml-2 w-6 h-6 rounded-full bg-red-500 items-center justify-center">
          <Text className="text-white text-[8px] font-black">{count}</Text>
        </View>
      )}
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

// ─── LeadChatThreadItem ───────────────────────────────────────────────────────
export function LeadChatThreadItem({ chat, onPress }: any) {
  const { colors, isDark } = useTheme();
  const { leadDetails, unreadCount, recentMessages, lastMessageAt } = chat;

  const dateStr = leadDetails?.leadDate ? format(new Date(leadDetails.leadDate), 'MM.dd.yy') : '';
  const heading =
    `${leadDetails?.office || ''} Lead ${dateStr}`.trim() ||
    'Discussion';

  const lastMsg = recentMessages?.[0];
  const repName = leadDetails?.assignedRepDetails
    ? `${leadDetails.assignedRepDetails.firstName}`
    : 'Rep';

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-4 p-3 rounded-xl"
      style={{
        borderColor: unreadCount > 0 ? colors.primary.main : isDark ? '#2A2A2A' : '#F1F1F1',
        backgroundColor:
          unreadCount > 0
            ? isDark
              ? 'rgba(37,99,235,0.1)'
              : '#ffffff'
            : isDark
              ? '#0f172a'
              : '#ffffff',
        borderWidth: unreadCount > 0 ? 0 : 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: isDark ? 0 : 0.05,
        shadowRadius: 10,
        elevation: 2,
      }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center flex-1 pr-2">
          <Text
            className="font-semibold text-xs mr-2"
            style={{ color: colors.text }}
            numberOfLines={1}
          >
            {heading}
          </Text>
          <View className="px-1.5 py-0.5 rounded-md" style={{ backgroundColor: STATUS_CONFIG[leadDetails?.status]?.color || '#94a3b8' }}>
            <Text className="text-[10px] font-bold" style={{ color: STATUS_CONFIG[leadDetails?.status]?.textColor || '#fff' }}>
              {STATUS_CONFIG[leadDetails?.status]?.label || leadDetails?.status || 'N/A'}
            </Text>
          </View>
        </View>
        {lastMessageAt && (
          <Text className="text-[12px]" style={{ color: '#637381' }}>
            {formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true }).replace(
              'about ',
              ''
            )}
          </Text>
        )}
      </View>

      <View className="flex-row items-center mb-1">
        <Text className="text-xs" style={{ color: colors.textSecondary }}>
          Lead ID: {leadDetails?.leadId || 'N/A'}
        </Text>
      </View>

      <View className="flex-row items-center mb-1">
        <Icon name="chatbubble" size={16} color={colors.textSecondary} style={{ marginRight: 4 }} />
        <View className="flex-1">
          <Text
            className="text-xs font-semibold"
            style={{ color: colors.textSecondary }}
            numberOfLines={2}
          >
            <Text style={{ color: colors.primary.main }}>
              {(() => {
                const fn = lastMsg?.senderDetails?.firstName;
                const ln = lastMsg?.senderDetails?.lastName;
                if (!fn && !ln) return 'User';
                return `${fn || ''} ${ln || ''}`.trim();
              })()}
              :{' '}
            </Text>
          </Text>
        </View>
        <View className="absolute right-0 w-6 h-6 items-center justify-center">
          <Icon name="chevron-forward-outline" size={12} color={colors.textSecondary} />
        </View>
      </View>
      <View className="flex-row items-center">
        <View className="">
          <Text
            className="text-[10px] font-semibold"
            style={{ color: colors.textSecondary }}
            numberOfLines={2}
          >
            <Text style={{ color: colors.primary.main }}>
              {(() => {
                const fn = lastMsg?.senderDetails?.firstName;
                const ln = lastMsg?.senderDetails?.lastName;
                if (!fn && !ln) return 'User';
                return `${fn || ''} ${ln || ''}`.trim();
              })()}
              :{' '}
            </Text>
            {lastMsg?.message || 'Started a new discussion.'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <View className="absolute right-0 w-6 h-6 rounded-full bg-blue-600 items-center justify-center">
            <Text className="text-white text-[10px] font-black">{unreadCount}</Text>
          </View>
        )}
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
  const scheme = CHANNEL_SCHEMES[displayName] || CHANNEL_SCHEMES['General'];

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-3 p-4 rounded-lg border flex-row items-center"
      style={{
        borderColor: isDark ? '#2A2A2A' : '#919EAB33',
        backgroundColor: isDark ? colors.surface : '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: isDark ? 0 : 0.05,
        shadowRadius: 6,
        elevation: 1,
      }}
    >
      <View
        className="w-10 h-10 rounded-md items-center justify-center mr-4"
        style={{ backgroundColor: scheme.color + '20' }}
      >
        <Text className="text-lg">{scheme.icon}</Text>
      </View>

      <View className="flex-1 pr-4">
        <Text className="font-semibold text-xs mb-1" style={{ color: '#1C252E' }}>
          {title || name}
        </Text>
        <Text className="text-xs" style={{ color: '#637381' }}>
          {channelConfig?.description || 'Team Communication Channel'}
        </Text>
      </View>

      {unreadCount > 0 && (
        <View className="w-6 h-6 rounded-full bg-red-500 items-center justify-center">
          <Text className="text-white text-[10px] font-black">{unreadCount}</Text>
        </View>
      )}
      <Icon name="caret-forward" size={16} color={'#637381'} style={{ marginLeft: 10 }} />
    </TouchableOpacity>
  );
}
