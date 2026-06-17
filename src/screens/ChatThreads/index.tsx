import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import SafeBottomSpacer from '../../widgets/common/SafeBottomSpacer';
import {
  MainTabOption,
  StatusChip,
  LeadChatThreadItem,
  ChannelThreadItem,
} from '../../widgets/components/chat/ThreadItems';
import { useChatThreads } from '../../hooks/useChatThreads';

const STATUS_OPTIONS = [
  'All',
  'Unresulted Leads',
  'Pending Install',
  'Installing Today',
  'Already Installed',
  'No Sales',
];

export default function ChatThreadsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [mainTab, setMainTab] = useState<'myleads' | 'channels'>('myleads');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('unresultedleads');
  const [filterUnread, setFilterUnread] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('Unresulted Leads');

  const {
    filteredChats,
    filteredChannels,
    loading,
    totalUnread,
    availableStatuses,
    channels,
    chats,
  } = useChatThreads(user, mainTab, searchQuery, statusFilter, filterUnread);

  const renderItem = ({ item }: any) =>
    mainTab === 'myleads' ? (
      <LeadChatThreadItem
        chat={item}
        onPress={() =>
          navigation.navigate('ChatDetail', {
            leadId: item.leadDetails?._id,
            chatId: item._id || item.id,
            customerName: (() => {
              const dateStr = item.leadDetails?.leadDate ? format(new Date(item.leadDetails.leadDate), 'MM.dd.yy') : '';
              return `${item.leadDetails?.office || ''} Lead ${dateStr} - ${item.leadDetails?.leadId || 'N/A'}`.trim() || 'Discussion';
            })(),
            chatType: 'lead',
            initialParticipants: item.participants || [],
          })
        }
      />
    ) : (
      <ChannelThreadItem
        channel={item}
        onPress={() =>
          navigation.navigate('ChatDetail', {
            chatId: item._id || item.id,
            customerName: item.title || item.name,
            description: item.channelConfig?.description,
            chatType: 'channel',
            initialParticipants: item.participants || [],
          })
        }
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View
        className="px-6 py-4 flex-row items-center justify-between border-b"
        style={{ borderColor: colors.border }}
      >
        <View className="flex-row items-center">
          <Text className="text-lg font-black" style={{ color: colors.text }}>
            Recent Leads
          </Text>
        </View>
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="w-8 h-8 items-center justify-center"
          >
            <Icon name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-4 pt-4">
        <View className="flex-row p-1.5 mb-2">
          <MainTabOption
            label="My Leads"
            active={mainTab === 'myleads'}
            onPress={() => setMainTab('myleads')}
            count={totalUnread}
          />
          <MainTabOption
            label="Channels"
            active={mainTab === 'channels'}
            onPress={() => setMainTab('channels')}
            count={(channels || []).reduce((acc: number, c: any) => acc + (c.unreadCount || 0), 0)}
          />
        </View>
      </View>

      <View className="px-4 py-2 pt-4">
        {mainTab === 'myleads' ? (
          <View className="flex-row items-center gap-3">
            {/* Custom Dropdown */}
            <View className="relative z-50">
              <TouchableOpacity
                onPress={() => setShowStatusDropdown(!showStatusDropdown)}
                className="h-12 px-3 rounded-xl border flex-row items-center justify-between"
                style={{
                  backgroundColor: colors.card,
                  width: 160,
                  borderColor: colors.border,
                }}
              >
                <Text
                  className="text-xs flex-1 mr-2"
                  numberOfLines={1}
                  style={{ color: colors.text }}
                >
                  {selectedStatus}
                </Text>
                <Icon name="chevron-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>

              {showStatusDropdown && (
                <View
                  className="absolute top-14 left-0 w-52 rounded-2xl shadow-2xl border overflow-hidden"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    zIndex: 999,
                  }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => {
                        setSelectedStatus(opt);
                        setStatusFilter(opt.toLowerCase().replace(/ /g, ''));
                        setShowStatusDropdown(false);
                      }}
                      className="px-4 py-3 border-b last:border-0"
                      style={{
                        borderColor: colors.border,
                        backgroundColor:
                          selectedStatus === opt
                            ? isDark
                              ? colors.background
                              : '#F4F6F8'
                            : 'transparent',
                      }}
                    >
                      <Text
                        className="text-sm font-medium"
                        style={{
                          color: selectedStatus === opt ? colors.primary.main : colors.text,
                        }}
                      >
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Search Input */}
            <View
              className="flex-1 h-12 rounded-xl border flex-row items-center px-4"
              style={{ backgroundColor: colors.card, borderColor: colors.border }}
            >
              <Icon name="search" size={18} color={colors.textSecondary} style={{ opacity: 0.5 }} />
              <TextInput
                className="flex-1 ml-3 text-xs"
                placeholder="Search by Lead ID."
                placeholderTextColor={'#919EAB'}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={{ color: colors.text }}
              />
            </View>

            {/* Filter Icon */}
            <TouchableOpacity className="p-2">
              <Icon name="filter" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <View
            className="h-12 rounded-xl border flex-row items-center px-4"
            style={{ backgroundColor: colors.card, borderColor: colors.border }}
          >
            <Icon name="search" size={18} color={colors.textSecondary} style={{ opacity: 0.5 }} />
            <TextInput
              className="flex-1 ml-3 text-xs"
              placeholder="Search channels..."
              placeholderTextColor={'#919EAB'}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ color: colors.text }}
            />
          </View>
        )}
      </View>

      <FlatList
        key={mainTab}
        data={mainTab === 'myleads' ? filteredChats : filteredChannels || []}
        keyExtractor={(item: any) => (item._id || item.id || Math.random().toString()).toString()}
        contentContainerStyle={{ padding: 16, paddingBottom: 0 }}
        showsVerticalScrollIndicator={false}
        renderItem={renderItem}
        ListFooterComponent={<SafeBottomSpacer height={40} />}
        ListEmptyComponent={
          <View className="pt-[30%] items-center">
            {loading ? (
              <ActivityIndicator color={colors.primary.main} />
            ) : (
              <>
                <Icon
                  name={mainTab === 'myleads' ? 'chatbubble-ellipses-outline' : 'people-outline'}
                  size={64}
                  color={colors.textSecondary}
                  style={{ opacity: 0.7 }}
                />
                <Text
                  className="mt-4 text-xs text-center"
                  style={{ color: colors.textSecondary }}
                >
                  No {mainTab === 'myleads' ? 'Leads Conversations' : 'Channels'} found
                </Text>
              </>
            )}
          </View>
        }
      />
    </View>
  );
}
