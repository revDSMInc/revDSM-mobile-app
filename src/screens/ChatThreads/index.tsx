import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  SectionList,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { useUserRole } from '../../hooks/useUserRole';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsOnline } from '../../hooks/useIsOnline';
import { offlineNoticeFor } from '../../utils/offline-capability';
import Icon from 'react-native-vector-icons/Ionicons';
import SafeBottomSpacer from '../../widgets/common/SafeBottomSpacer';
import {
  MainTabOption,
  LeadChatThreadItem,
  ChannelThreadItem,
  DateSectionHeader,
  groupChatsByLeadDate,
  buildInstallerLeadHeading,
  getLeadIdDisplay,
} from '../../widgets/components/chat/ThreadItems';
import { useChatThreads } from '../../hooks/useChatThreads';
import CreateChannelModal from '../../widgets/modals/chat/CreateChannelModal';
import ChatService from '../../services/api/ChatService';
import SocketManager from '../../services/SocketManager';
import { FlashMessage } from '../../config/message';
import { sanitizeForLog } from '../../utils/sanitize-for-log';

const STATUS_OPTIONS = [
  'All',
  'Unresulted Leads',
  'Pending Rehash',
  'Pending Install',
  'Installing Today',
  'Already Installed',
  'No Sales',
];

const INSTALLER_STATUS_OPTIONS = [
  'All',
  'Pending Install',
  'Installing Today',
  'Already Installed',
];

export default function ChatThreadsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { isInstaller } = useUserRole();
  const insets = useSafeAreaInsets();

  const [mainTab, setMainTab] = useState<'myleads' | 'channels'>('myleads');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterUnread, setFilterUnread] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  const statusOptions = isInstaller ? INSTALLER_STATUS_OPTIONS : STATUS_OPTIONS;

  // The new channel itself lands in the list through the live `team-channel-created` event.
  const handleCreateChannel = (channelData: any) => {
    if (!SocketManager.isConnected()) {
      FlashMessage.warning('Socket not connected');
      return;
    }
    ChatService.createChannel(channelData)
      .then((res: any) => {
        FlashMessage.success('Channel created', res?.data?.channel?.name || channelData?.name || '');
      })
      .catch((err: any) => {
        FlashMessage.error('Failed to create channel', err?.message || '');
      });
  };

  const {
    filteredChats,
    filteredChannels,
    loading,
  } = useChatThreads(user, mainTab, searchQuery, statusFilter, filterUnread);

  const leadSections = useMemo(() => groupChatsByLeadDate(filteredChats), [filteredChats]);

  useEffect(() => {
    if (!__DEV__ || loading) return;
    const rows: any[] = mainTab === 'myleads' ? filteredChats : filteredChannels;
    console.log(
      `[chatThreads] displayed ${mainTab}: ${rows.length} row(s) ` +
        `(status=${statusFilter}, unread=${filterUnread}, search=${searchQuery || "none"})`,
      rows.map((r) => sanitizeForLog(r))
    );
  }, [
    loading,
    mainTab,
    filteredChats,
    filteredChannels,
    statusFilter,
    filterUnread,
    searchQuery,
  ]);

  const navigateToChat = (item: any) => {
    navigation.navigate('ChatDetail', {
      leadId: item.leadDetails?._id,
      chatId: item._id || item.id,
      customerName: isInstaller
        ? buildInstallerLeadHeading(item.leadDetails, getLeadIdDisplay(item.leadDetails))
        : (() => {
            const dateStr = item.leadDetails?.leadDate
              ? format(new Date(item.leadDetails.leadDate), 'MM.dd.yy')
              : '';
            return (
              `${item.leadDetails?.office || ''} Lead ${dateStr} - ${item.leadDetails?.leadId || 'N/A'}`.trim() ||
              'Discussion'
            );
          })(),
      chatType: 'lead',
      initialParticipants: item.participants || [],
      previewImage: item.leadDetails?.previewImage,
      previewImages: item.leadDetails?.previewImages,
    });
  };

  const navigateToChannel = (item: any) => {
    navigation.navigate('ChatDetail', {
      chatId: item.id,
      customerName: item.name,
      description: item.description,
      chatType: 'channel',
      initialParticipants: item.participants || [],
    });
  };

  const online = useIsOnline();

  const emptyState = (
    <View className="pt-[30%] items-center">
      {loading ? (
        <ActivityIndicator color={colors.primary.main} />
      ) : !online ? (
        <>
          <Icon name="cloud-offline-outline" size={64} color="#C4CDD5" />
          <Text className="mt-4 px-8 text-xs text-center" style={{ color: '#919EAB' }}>
            {offlineNoticeFor('chat')?.message}
          </Text>
        </>
      ) : (
        <>
          <Icon
            name={mainTab === 'myleads' ? 'chatbubble-ellipses-outline' : 'people-outline'}
            size={64}
            color="#C4CDD5"
          />
          <Text className="mt-4 text-xs text-center" style={{ color: '#919EAB' }}>
            No {mainTab === 'myleads' ? 'Leads Conversations' : 'Channels'} found
          </Text>
        </>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-2 pb-3 flex-row items-center justify-between">
        <Text className="text-xl font-bold" style={{ color: '#1C252E' }}>
          Recent Leads
        </Text>
        <View className="flex-row items-center">
          {/* {mainTab === 'channels' && (
            <TouchableOpacity
              onPress={() => setShowCreateChannel(true)}
              className="flex-row items-center h-8 px-3 mr-2 rounded-full"
              style={{ backgroundColor: colors.primary.main }}
            >
              <Icon name="add" size={16} color="#fff" />
              <Text className="text-xs font-bold ml-1" style={{ color: '#fff' }}>
                New Channel
              </Text>
            </TouchableOpacity>
          )} */}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="w-8 h-8 items-center justify-center"
          >
            <Icon name="close" size={22} color="#1C252E" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View className="px-5 border-b" style={{ borderColor: '#F4F6F8' }}>
        <View className="flex-row">
          <MainTabOption
            label={isInstaller ? 'My Installs' : 'My Leads'}
            active={mainTab === 'myleads'}
            onPress={() => setMainTab('myleads')}
          />
          <MainTabOption
            label="Channels"
            active={mainTab === 'channels'}
            onPress={() => setMainTab('channels')}
          />
        </View>
      </View>

      {/* Filters */}
      <View className="px-4 py-3">
        {mainTab === 'myleads' ? (
          <View className="flex-row items-center gap-2">
            <View className="relative z-50">
              <TouchableOpacity
                onPress={() => setShowStatusDropdown(!showStatusDropdown)}
                className="h-11 px-3 rounded-xl border flex-row items-center justify-between"
                style={{
                  backgroundColor: '#FFFFFF',
                  width: 148,
                  borderColor: '#DFE3E8',
                }}
              >
                <Text
                  className="text-xs flex-1 mr-1"
                  numberOfLines={1}
                  style={{ color: '#1C252E' }}
                >
                  {selectedStatus}
                </Text>
                <Icon name="chevron-down" size={14} color="#919EAB" />
              </TouchableOpacity>

              {showStatusDropdown && (
                <View
                  className="absolute top-12 left-0 w-52 rounded-xl shadow-lg border overflow-hidden"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: '#DFE3E8',
                    zIndex: 999,
                  }}
                >
                  {statusOptions.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => {
                        setSelectedStatus(opt);
                        setStatusFilter(opt.toLowerCase().replace(/ /g, ''));
                        setShowStatusDropdown(false);
                      }}
                      className="px-4 py-3 border-b"
                      style={{
                        borderColor: '#F4F6F8',
                        backgroundColor:
                          selectedStatus === opt
                            ? isDark
                              ? colors.background
                              : '#F9FAFB'
                            : 'transparent',
                      }}
                    >
                      <Text
                        className="text-sm"
                        style={{
                          color: selectedStatus === opt ? colors.primary.main : '#1C252E',
                          fontWeight: selectedStatus === opt ? '600' : '400',
                        }}
                      >
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View
              className="flex-1 h-11 rounded-xl border flex-row items-center px-3"
              style={{ backgroundColor: '#FFFFFF', borderColor: '#DFE3E8' }}
            >
              <Icon name="search" size={16} color="#919EAB" />
              <TextInput
                className="flex-1 ml-2 text-xs"
                placeholder="Search by Lead ID"
                placeholderTextColor="#919EAB"
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={{ color: '#1C252E', paddingVertical: 0 }}
              />
            </View>

            <TouchableOpacity
              onPress={() => setFilterUnread((prev) => !prev)}
              className="w-10 h-11 items-center justify-center"
            >
              <Icon
                name="filter"
                size={20}
                color={filterUnread ? colors.primary.main : '#637381'}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <View
            className="h-11 rounded-xl border flex-row items-center px-3"
            style={{ backgroundColor: '#FFFFFF', borderColor: '#DFE3E8' }}
          >
            <Icon name="search" size={16} color="#919EAB" />
            <TextInput
              className="flex-1 ml-2 text-xs"
              placeholder="Search channels..."
              placeholderTextColor="#919EAB"
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ color: '#1C252E', paddingVertical: 0 }}
            />
          </View>
        )}
      </View>

      {/* List */}
      {mainTab === 'myleads' ? (
        <SectionList
          sections={leadSections}
          keyExtractor={(item: any) => (item._id || item.id || Math.random().toString()).toString()}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 0, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => setShowStatusDropdown(false)}
          renderSectionHeader={({ section: { title } }) => <DateSectionHeader label={title} />}
          renderItem={({ item }) => (
            <LeadChatThreadItem
              chat={item}
              onPress={() => navigateToChat(item)}
              installerView={isInstaller}
            />
          )}
          ListFooterComponent={<SafeBottomSpacer height={40} />}
          ListEmptyComponent={emptyState}
          stickySectionHeadersEnabled={false}
        />
      ) : (
        <FlatList
          data={filteredChannels || []}
          keyExtractor={(item: any) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 0, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ChannelThreadItem channel={item} onPress={() => navigateToChannel(item)} />
          )}
          ListFooterComponent={<SafeBottomSpacer height={40} />}
          ListEmptyComponent={emptyState}
        />
      )}

      <CreateChannelModal
        visible={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
        onCreate={handleCreateChannel}
      />
    </View>
  );
}
