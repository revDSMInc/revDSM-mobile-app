import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import ChatService from '../../../services/api/ChatService';

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

export const PinnedMessagesArea = ({
  pinnedMessages,
  onUnpin,
  onNavigate,
  imageUrls = {},
}: any) => {
  const { colors, isDark } = useTheme();
  if (pinnedMessages.length === 0) return null;

  const getMessagePreview = (msg: any) => {
    if (msg.image || msg.imageUrl) return 'Shared Image';
    if (msg.video || msg.videoUrl) return 'Shared Video';
    if (msg.audio || msg.voice || msg.isVoiceNote) return 'Voice Note';
    if (msg.files?.length > 0) return 'Attachment';
    return msg.text || msg.message || 'Media Message';
  };

  const getThumbnail = (msg: any) => {
    // Check direct fields
    let p = msg.image || msg.imageUrl || msg.video || msg.videoUrl;

    // Check files array if direct fields are empty
    if (!p && msg.files?.length > 0) {
      const f = msg.files[0];
      p = f.url || f.path || f.filePath;
    }

    if (!p) return null;
    return imageUrls[p] || (p.startsWith('http') ? p : null);
  };

  const getIcon = (msg: any) => {
    if (msg.image || msg.imageUrl) return 'image-outline';
    if (msg.video || msg.videoUrl) return 'videocam-outline';
    if (msg.audio || msg.voice || msg.isVoiceNote) return 'mic-outline';
    if (msg.files?.length > 0) return 'document-outline';
    return 'chatbubble-outline';
  };

  return (
    <View className="py-2">
      <View className="flex-row items-center px-4 mb-2">
        <Icon name="pin" size={14} color="#F59E0B" />
        <Text
          className="text-[11px] font-black tracking-[2px] ml-2"
          style={{ color: colors.primary.main }}
        >
          Pinned Insights
        </Text>
      </View>
      <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
        {pinnedMessages.map((msg: any) => {
          const thumb = getThumbnail(msg);
          return (
            <TouchableOpacity
              key={msg._id || msg.id}
              onPress={() => onNavigate(msg)}
              className="px-4 py-3 flex-row items-center justify-between border-b border-gray-50 dark:border-zinc-800"
            >
              <View className="flex-row items-center flex-1">
                <View
                  className="w-10 h-10 rounded-lg items-center justify-center mr-3 overflow-hidden shadow-sm"
                  style={{ backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
                >
                  {thumb ? (
                    <Image source={{ uri: thumb }} className="w-full h-full" resizeMode="cover" />
                  ) : (
                    <Icon name={getIcon(msg)} size={18} color={colors.primary.main} />
                  )}
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[10px] font-bold opacity-40 mb-0.5"
                    style={{ color: colors.text }}
                  >
                    {msg.user?.name || msg.authorName || 'Member'}'s Message
                  </Text>
                  <Text
                    className="text-[13px] font-medium"
                    style={{ color: colors.text }}
                    numberOfLines={1}
                  >
                    {getMessagePreview(msg)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export const ParticipantsModal = ({ visible, onClose, chatId, leadId, isChannel }: any) => {
  const { colors, isDark } = useTheme();
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && (chatId || leadId)) {
      setLoading(true);
      const fetchAction = isChannel
        ? ChatService.getChannelParticipants(chatId)
        : ChatService.getLeadParticipants(chatId, leadId);

      fetchAction
        .then((res: any) => {
          const filtered = (res || []).filter((u: any) => {
            const perms = u.dashboardPermissions || [];
            return !perms.includes('vp_sales_dashboard');
          });
          setParticipants(filtered);
        })
        .catch((err: any) => console.error('Fetch participants error:', err))
        .finally(() => setLoading(false));
    }
  }, [visible, chatId, leadId, isChannel]);

  const getInitials = (u: any) => {
    return `${(u.firstName || u.name || '?')[0]}${(u.lastName || '')[0] || ''}`.toUpperCase();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View className="flex-1 bg-black/60 justify-end">
        <TouchableOpacity style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} activeOpacity={1} onPress={onClose} />
        <View
          className="rounded-t-[40px] pt-2 px-6 pb-12"
          style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', maxHeight: '85%' }}
        >
            {/* Drag Handle */}
            <View className="items-center mb-6">
              <View className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700" />
            </View>

            <View className="flex-row items-center justify-between mb-8">
              <View className="flex-row items-center">
                <Text className="text-2xl font-black mr-3" style={{ color: colors.text }}>
                  Members
                </Text>
                <View className="bg-blue-100 dark:bg-blue-900/30 rounded-full px-3 py-1">
                  <Text className="text-blue-600 dark:text-blue-400 font-black text-sm">
                    {participants?.length || 0}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={onClose}
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center"
              >
                <Icon name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View className="py-20 items-center">
                <ActivityIndicator size="large" color={colors.primary.main} />
                <Text
                  className="mt-4 font-bold opacity-40 tracking-widest text-[10px]"
                  style={{ color: colors.text }}
                >
                  Loading Roster...
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {participants?.length > 0 ? (
                  participants.map((u: any) => {
                    const name = `${u.firstName || u.name || 'User'} ${u.lastName || ''}`;
                    const avatarColor = stringToColor(name);
                    return (
                      <View key={u._id || u.id} className="flex-row items-center mb-6">
                        <View
                          className="w-14 h-14 rounded-[22px] items-center justify-center mr-4 shadow-sm"
                          style={{
                            backgroundColor: avatarColor,
                          }}
                        >
                          <Text className="text-lg font-black text-white">{getInitials(u)}</Text>
                        </View>
                        <View className="flex-1">
                          <Text className="font-black text-[17px]" style={{ color: colors.text }}>
                            {name}
                          </Text>
                          <View className="flex-row items-center mt-1">
                            <View className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                            <Text
                              className="text-[10px] font-black opacity-40 tracking-widest"
                              style={{ color: colors.text }}
                            >
                              {u.email || u.role || (u.isAdmin ? 'Admin' : 'Member')}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800/50 items-center justify-center">
                          <Icon name="chatbubble-outline" size={18} color={colors.primary.main} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                ) : (
                  <View className="items-center py-20">
                    <View className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center mb-4">
                      <Icon name="people" size={32} color={colors.textSecondary} />
                    </View>
                    <Text
                      style={{ color: colors.textSecondary }}
                      className="text-sm font-bold opacity-40"
                    >
                      No members joined yet
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
        </View>
      </View>
    </Modal>
  );
};

export const MentionSuggestions = ({ participants, onSelect, colors, isDark }: any) => {
  if (!participants?.length) return null;

  const getInitials = (u: any) => {
    return `${(u.firstName || u.name || '?')[0]}${(u.lastName || '')[0] || ''}`.toUpperCase();
  };

  return (
    <View
      style={{
        backgroundColor: isDark ? '#1C1C1E' : '#fff',
        maxHeight: 220,
        minHeight: 50,
        borderRadius: 16,
      }}
    >
      <ScrollView 
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingVertical: 8 }}
      >
        {participants.map((u: any) => {
          const name = `${u.firstName || u.name || 'User'} ${u.lastName || ''}`.trim();
          return (
            <TouchableOpacity
              key={u._id || u.id}
              onPress={() => onSelect(u)}
              className="flex-row items-center px-4 py-2.5"
            >
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: isDark ? '#3A3A3C' : '#CBD5E1' }}
              >
                <Text className="text-sm text-white font-black opacity-80">
                  {getInitials(u)}
                </Text>
              </View>
              <View className="flex-1">
                <Text 
                  className="text-[15px] font-semibold mb-0.5" 
                  style={{ color: isDark ? '#F8FAFC' : '#1E293B' }}
                >
                  {name}
                </Text>
                <Text 
                  className="text-[13px]" 
                  style={{ color: isDark ? '#94A3B8' : '#64748B' }}
                  numberOfLines={1}
                >
                  {u.email || `@${u.username || u.userName || name.toLowerCase().replace(' ', '')}`}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export const SearchBar = ({ onSearch, onClose, value, searchIndex, totalResults, onPrev, onNext }: any) => {
  const { colors, isDark } = useTheme();

  return (
    <View
      className="flex-row items-center px-4 py-3 border-b"
      style={{
        borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8',
        backgroundColor: isDark ? colors.surface : '#fff',
      }}
    >
      <TouchableOpacity onPress={onClose} className="mr-3 p-1">
        <Icon name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>
      
      <View 
        className="flex-1 flex-row items-center rounded-full px-4 h-10 border"
        style={{ 
          backgroundColor: isDark ? colors.card : '#F9FAFB',
          borderColor: isDark ? '#2A2A2A' : '#E5E7EB'
        }}
      >
        <Icon name="search-outline" size={18} color={colors.textSecondary} className="mr-2" />
        <TextInput
          autoFocus
          className="flex-1 h-full text-sm font-bold ml-2"
          placeholder="Search Messages..."
          placeholderTextColor={colors.textSecondary}
          value={value}
          onChangeText={onSearch}
          style={{ color: colors.text }}
        />
        
        {value.length > 0 && (
          <View className="flex-row items-center">
            <Text className="text-[11px] font-bold opacity-50 mr-2" style={{ color: colors.text }}>
              {totalResults > 0 ? `${searchIndex + 1}/${totalResults}` : '0/0'}
            </Text>
            
            <View className="flex-row items-center gap-1 border-l pl-2 border-gray-200 dark:border-zinc-800">
              <TouchableOpacity onPress={onPrev} className="p-1" disabled={totalResults === 0}>
                <Icon name="chevron-up" size={20} color={totalResults > 0 ? colors.text : colors.textSecondary + '40'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onNext} className="p-1" disabled={totalResults === 0}>
                <Icon name="chevron-down" size={20} color={totalResults > 0 ? colors.text : colors.textSecondary + '40'} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => onSearch('')} className="ml-2 p-1">
              <Icon name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

export const EditHistoryModal = ({ visible, onClose, history = [] }: any) => {
  const { colors, isDark } = useTheme();
  const sorted = [...history].reverse(); // Newest first

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <TouchableOpacity className="flex-1 bg-black/50" activeOpacity={1} onPress={onClose}>
        <View className="flex-1 justify-end">
          <TouchableOpacity
            activeOpacity={1}
            className="rounded-t-[40px] p-6 pb-12"
            style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', maxHeight: '70%' }}
          >
            <View className="items-center mb-6">
              <View className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700" />
            </View>

            <View className="flex-row items-center justify-between mb-8">
              <Text className="text-2xl font-black" style={{ color: colors.text }}>
                Edit History
              </Text>
              <TouchableOpacity
                onPress={onClose}
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center"
              >
                <Icon name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {sorted.length > 0 ? (
                sorted.map((item: any, idx: number) => (
                  <View
                    key={idx}
                    className="mb-6 pb-4 border-b border-zinc-50 dark:border-zinc-900"
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-[10px] font-black tracking-widest text-slate-400">
                        Version {sorted.length - idx}
                      </Text>
                      <Text className="text-[10px] font-bold text-slate-400">
                        {new Date(item.editedAt).toLocaleString()}
                      </Text>
                    </View>
                    <Text className="text-[15px] leading-6" style={{ color: colors.text }}>
                      {item.message || item.text || 'Message was cleared.'}
                    </Text>
                  </View>
                ))
              ) : (
                <View className="items-center py-10">
                  <Text className="text-slate-400 font-bold">No history records found.</Text>
                </View>
              )}
            </ScrollView>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};
