import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Pin from '../../../assets/svgs/icons/pin';

const CHANNEL_SCHEMES: Record<string, { icon: string; color: string }> = {
  Announcements: { icon: '📢', color: '#FF6B6B' },
  'Sales Wins': { icon: '🎉', color: '#51CF66' },
  General: { icon: '💬', color: '#748FFC' },
  Files: { icon: '📁', color: '#339AF0' },
  Commission: { icon: '💰', color: '#FFC107' },
  'Commission Sheets': { icon: '💰', color: '#FFC107' },
  Questions: { icon: '❓', color: '#9775FA' },
};

export const ChatHeader = ({
  customerName,
  isChannel,
  colors,
  isDark,
  navigation,
  isSearching,
  setIsSearching,
  searchQuery,
  setSearchQuery,
  pinnedMessages,
  setShowPinned,
  participants,
  setParticipantModalVisible,
}: any) => {
  return (
    <View
      className="px-4 pt-3 pb-4 border-b"
      style={{ backgroundColor: isDark ? '#1A1A1A' : '#fff', borderBottomColor: colors.border }}
    >
      <TouchableOpacity onPress={() => navigation.goBack()} className="flex-row items-center mb-4">
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2"
          style={{ backgroundColor: isDark ? '#242424' : '#F1F5F9' }}
        >
          <Icon name="arrow-back" size={18} color={colors.text} />
        </View>
        <Text className="font-bold text-sm" style={{ color: '#84cc16' }}>
          Back to {isChannel ? 'Channels' : 'Leads'}
        </Text>
      </TouchableOpacity>

      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center flex-1">
          <View
            className="w-10 h-10 rounded-xl items-center justify-center mr-3"
            style={{
              backgroundColor: isChannel
                ? (CHANNEL_SCHEMES[customerName]?.color || '#748FFC') + '33'
                : colors.primary.main + '20',
            }}
          >
            {isChannel ? (
              <Text className="text-md">{CHANNEL_SCHEMES[customerName]?.icon || '💬'}</Text>
            ) : (
              <Icon name="person" size={24} color={colors.primary.main} />
            )}
          </View>
          <View className="flex-1">
            <Text
              className="text-xs font-semibold pb-1"
              style={{ color: '#1C252E' }}
              numberOfLines={1}
            >
              {customerName || (isChannel ? 'Announcements' : 'Lead Conversation')}
            </Text>
            <Text className="text-xs" style={{ color: '#637381' }}>
              {isChannel ? 'Management announcements (View only)' : 'Standard Lead Conversation'}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => setShowPinned(true)} className="relative">
            <Pin />
            {pinnedMessages.length > 0 && (
              <View className="absolute -top-1.5 -right-1.5 bg-amber-500 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 items-center justify-center">
                <Text className="text-[8px] text-white font-bold">{pinnedMessages.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setParticipantModalVisible(true)} className="relative">
            <Icon name="people" size={24} color="#94a3b8" />
            <View className="absolute -top-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 items-center justify-center">
              <Text className="text-[8px] text-white font-bold">{participants.length}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View
        className="h-11 rounded-full border flex-row items-center px-4"
        style={{
          backgroundColor: isDark ? '#121212' : '#F9FBFC',
          borderColor: isDark ? '#2A2A2A' : '#E2E8F0',
        }}
      >
        <Icon name="search" size={18} color="#94a3b8" />
        <TextInput
          className="flex-1 ml-3 text-sm font-medium"
          placeholder="Search messages...."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={{ color: colors.text }}
        />
      </View>
    </View>
  );
};
