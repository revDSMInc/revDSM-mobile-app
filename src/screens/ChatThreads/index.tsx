import React, { useState } from 'react';
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

export default function ChatThreadsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [mainTab, setMainTab] = useState<'myleads' | 'channels'>('myleads');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterUnread, setFilterUnread] = useState(false);

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
            customerName: `${item.leadDetails?.customerDetails?.firstName} ${item.leadDetails?.customerDetails?.lastName}`,
            chatType: 'lead',
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
            chatType: 'channel',
          })
        }
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View className="px-6 py-4 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="w-10 h-10 rounded-full items-center justify-center bg-slate-100 dark:bg-slate-800 mr-4"
          >
            <Icon name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text className="text-2xl font-black" style={{ color: colors.text }}>
            Messages
          </Text>
        </View>
        <View className="flex-row items-center">
          <Text className="text-xl font-black tracking-tighter" style={{ color: '#4CBB17' }}>
            rev
          </Text>
          <Text
            className="text-xl font-black tracking-tighter"
            style={{ color: isDark ? '#fff' : '#000' }}
          >
            DSM
          </Text>
        </View>
      </View>

      <View className="px-6">
        <View className="flex-row bg-slate-100 dark:bg-slate-900 rounded-2xl p-1.5 mb-2">
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

      <View className="px-6 py-2">
        <View className="flex-row items-center space-x-3">
          <View className="flex-1 h-12 rounded-2xl bg-slate-100 dark:bg-slate-900 flex-row items-center px-4">
            <Icon name="search" size={18} color={colors.textSecondary} style={{ opacity: 0.5 }} />
            <TextInput
              className="flex-1 ml-3 text-sm font-bold"
              placeholder={mainTab === 'myleads' ? 'Search Leads...' : 'Search Channels...'}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ color: colors.text }}
            />
          </View>
          {mainTab === 'myleads' && (
            <TouchableOpacity
              onPress={() => setFilterUnread(!filterUnread)}
              className="ml-3 w-12 h-12 rounded-2xl items-center justify-center"
              style={{ backgroundColor: filterUnread ? '#2563eb' : isDark ? '#0f172a' : '#f1f5f9' }}
            >
              <Icon
                name="mail-unread"
                size={20}
                color={filterUnread ? 'white' : colors.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {mainTab === 'myleads' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="pl-6 py-2"
          contentContainerStyle={{ paddingRight: 24 }}
        >
          <StatusChip
            label="All"
            active={statusFilter === 'all'}
            onPress={() => setStatusFilter('all')}
            count={chats.filter((c: any) => c.unreadCount > 0).length}
            specialMode="all"
          />
          <StatusChip
            label="Today"
            active={statusFilter === 'currentLeads'}
            onPress={() => setStatusFilter('currentLeads')}
            count={
              chats.filter((c: any) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                return new Date(c.leadDetails?.createdAt) >= today && c.unreadCount > 0;
              }).length
            }
            specialMode="current"
          />
          {availableStatuses.map((s: string) => (
            <StatusChip
              key={s}
              label={s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1')}
              active={statusFilter === s}
              onPress={() => setStatusFilter(s)}
              count={
                chats.filter((c: any) => c.leadDetails?.status === s && c.unreadCount > 0).length
              }
            />
          ))}
          <View className="w-10" />
        </ScrollView>
      )}

      <FlatList
        key={mainTab}
        data={mainTab === 'myleads' ? filteredChats : filteredChannels || []}
        keyExtractor={(item: any) => (item._id || item.id || Math.random().toString()).toString()}
        contentContainerStyle={{ padding: 24, paddingBottom: 0 }}
        showsVerticalScrollIndicator={false}
        renderItem={renderItem}
        ListFooterComponent={<SafeBottomSpacer height={40} />}
        ListEmptyComponent={
          <View className="py-20 items-center">
            {loading ? (
              <ActivityIndicator color={colors.primary.main} />
            ) : (
              <>
                <Icon
                  name={mainTab === 'myleads' ? 'chatbubble-ellipses-outline' : 'people-outline'}
                  size={64}
                  color={colors.textSecondary}
                  style={{ opacity: 0.15 }}
                />
                <Text
                  className="mt-4 font-black uppercase text-xs tracking-widest opacity-40 text-center"
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
