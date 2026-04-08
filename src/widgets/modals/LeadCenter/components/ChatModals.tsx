import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import ChatService from '../../../../services/api/ChatService';

export const PinnedMessagesArea = ({ pinnedMessages, onUnpin, onNavigate }: any) => {
  const { colors, isDark } = useTheme();
  if (pinnedMessages.length === 0) return null;

  return (
    <View
      className="px-6 py-2 border-b flex-row items-center"
      style={{
        borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8',
        backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
      }}
    >
      <Icon name="pin" size={12} color={colors.primary.main} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="ml-3">
        {pinnedMessages.map((msg: any) => (
          <TouchableOpacity
            key={msg._id || msg.id}
            onPress={() => onNavigate(msg)}
            className="mr-4 h-6 flex-row items-center"
          >
            <Text
              className="text-[10px] font-bold opacity-60 max-w-[150px]"
              style={{ color: colors.text }}
              numberOfLines={1}
            >
              {msg.message || 'Pinned Message'}
            </Text>
            <TouchableOpacity
              onPress={() => onUnpin(msg)}
              className="ml-2 w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center"
            >
              <Icon name="close" size={10} color={colors.textSecondary} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

export const ParticipantsModal = ({ visible, onClose, chatId, isChannel }: any) => {
  const { colors, isDark } = useTheme();
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && chatId) {
      if (isChannel) {
        setLoading(true);
        ChatService.getChannelParticipants(chatId)
          .then((res) => setParticipants(res))
          .catch((err) => console.error('Fetch participants error:', err))
          .finally(() => setLoading(false));
      } else {
        // For lead chats, participants are usually just the sender and receiver
        // If there's a specific endpoint for lead participants, call it here.
        setParticipants([]);
      }
    }
  }, [visible, chatId, isChannel]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="h-3/4 rounded-t-[32px] p-6" style={{ backgroundColor: colors.background }}>
          <View className="flex-row items-center justify-between mb-8">
            <Text className="text-2xl font-black" style={{ color: colors.text }}>
              Participants
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center"
            >
              <Icon name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={colors.primary.main} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {participants?.length > 0 ? (
                participants.map((u: any) => (
                  <View key={u._id || u.id} className="flex-row items-center mb-6">
                    <View className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 items-center justify-center mr-4">
                      <Text className="text-lg">👤</Text>
                    </View>
                    <View>
                      <Text className="font-black text-[15px]" style={{ color: colors.text }}>
                        {u.firstName || u.name} {u.lastName || ''}
                      </Text>
                      <Text
                        className="text-[10px] font-black uppercase opacity-40 tracking-widest"
                        style={{ color: colors.text }}
                      >
                        {u.role || (u.isAdmin ? 'Admin' : 'Member')}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <View className="items-center py-10">
                  <Text style={{ color: colors.textSecondary }} className="text-sm">
                    No participants found
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

export const SearchBar = ({ onSearch, onClose, value }: any) => {
  const { colors, isDark } = useTheme();

  return (
    <View
      className="flex-row items-center px-6 py-4 border-b"
      style={{
        borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8',
        backgroundColor: isDark ? colors.surface : '#fff',
      }}
    >
      <TouchableOpacity onPress={onClose} className="mr-4">
        <Icon name="chevron-back" size={20} color={colors.text} />
      </TouchableOpacity>
      <TextInput
        autoFocus
        className="flex-1 h-10 text-sm font-bold"
        placeholder="Search Messages..."
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={onSearch}
        style={{ color: colors.text }}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onSearch('')} className="ml-2">
          <Icon name="close-circle" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
};
