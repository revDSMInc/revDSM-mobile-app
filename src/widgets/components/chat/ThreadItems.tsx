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
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
              elevation: 1,
            }
          : {}
      }
    >
      <Text
        className="font-black uppercase tracking-widest text-[10px]"
        style={{ color: active ? colors.text : colors.textSecondary }}
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
      className="mr-2.5 px-4 py-2 rounded-xl flex-row items-center border"
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
        className="text-[10px] font-black uppercase tracking-widest"
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

  const isSale = leadDetails?.status === 'sale';
  const dateStr = leadDetails?.leadDate ? format(new Date(leadDetails.leadDate), 'MM.dd.yy') : '';
  const heading =
    `${leadDetails?.office || ''} ${isSale ? leadDetails?.leadId : `Lead ${dateStr}`}`.trim() ||
    'Discussion';

  const statusObj = STATUS_CONFIG[leadDetails?.status] || {
    label: leadDetails?.status || 'N/A',
    color: '#94a3b8',
  };
  const lastMsg = recentMessages?.[0];
  const repName = leadDetails?.assignedRepDetails
    ? `${leadDetails.assignedRepDetails.firstName}`
    : 'Rep';

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-4 p-5 rounded-[28px]"
      style={{
        borderLeftWidth: 8,
        borderColor: unreadCount > 0 ? colors.primary.main : isDark ? '#2A2A2A' : '#F1F1F1',
        backgroundColor:
          unreadCount > 0
            ? isDark
              ? 'rgba(37,99,235,0.1)'
              : 'rgba(239,246,255,0.2)'
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
            className="font-black text-[15px] mr-2"
            style={{ color: colors.text }}
            numberOfLines={1}
          >
            {heading}
          </Text>
          <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: statusObj.color }}>
            <Text className="text-[9px] font-black uppercase text-white">{statusObj.label}</Text>
          </View>
        </View>
        {lastMessageAt && (
          <Text
            className="text-[9px] font-bold opacity-30 uppercase"
            style={{ color: colors.text }}
          >
            {formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true }).replace(
              'about ',
              ''
            )}
          </Text>
        )}
      </View>

      <View className="flex-row items-center mb-1">
        <Icon name="person" size={10} color={colors.textSecondary} style={{ opacity: 0.5 }} />
        <Text
          className="text-[10px] font-black uppercase tracking-widest ml-1"
          style={{ color: colors.textSecondary }}
        >
          Lead ID: {leadDetails?.leadId || 'N/A'} • {repName}
        </Text>
      </View>

      <View className="flex-row items-center mt-2 pr-10">
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2"
          style={{ backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }}
        >
          <Text className="text-xs">💬</Text>
        </View>
        <View className="flex-1">
          <Text
            className="text-xs font-bold leading-4"
            style={{ color: colors.textSecondary }}
            numberOfLines={2}
          >
            <Text style={{ color: isDark ? '#93c5fd' : '#2563eb' }}>
              {lastMsg?.senderDetails?.firstName || 'User'}:{' '}
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

// ─── ChannelThreadItem ────────────────────────────────────────────────────────
export function ChannelThreadItem({ channel, onPress }: any) {
  const { colors, isDark } = useTheme();
  const { title, name, unreadCount, channelConfig } = channel;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-4 p-5 rounded-[28px] border flex-row items-center"
      style={{
        borderColor: isDark ? '#2A2A2A' : '#F1F1F1',
        backgroundColor: isDark ? colors.surface : '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: isDark ? 0 : 0.05,
        shadowRadius: 10,
        elevation: 2,
      }}
    >
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center mr-4"
        style={{ backgroundColor: isDark ? 'rgba(37,99,235,0.2)' : '#eff6ff' }}
      >
        <Icon name="layers" size={24} color={colors.primary.main} />
      </View>

      <View className="flex-1 pr-4">
        <Text className="font-black text-[16px] mb-1" style={{ color: colors.text }}>
          {title || name}
        </Text>
        <Text
          className="text-[11px] font-black uppercase tracking-widest opacity-40"
          style={{ color: colors.text }}
        >
          {channelConfig?.description || 'Team Communication Channel'}
        </Text>
      </View>

      {unreadCount > 0 && (
        <View className="w-6 h-6 rounded-full bg-red-500 items-center justify-center">
          <Text className="text-white text-[10px] font-black">{unreadCount}</Text>
        </View>
      )}
      <Icon
        name="chevron-forward"
        size={18}
        color={colors.textSecondary}
        style={{ marginLeft: 10, opacity: 0.2 }}
      />
    </TouchableOpacity>
  );
}
