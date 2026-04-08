import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { GiftedChat, IMessage, Send, InputToolbar, Composer } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/Ionicons';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../hooks/useAuth';
import ChatService from '../../services/api/ChatService';
import { ChatReplyBar, ChatEditBar } from '../../widgets/modals/LeadCenter/components/ChatBars';
import { ChatMessageBubble } from '../../widgets/modals/LeadCenter/components/ChatMessageBubble';
import {
  SearchBar,
  ParticipantsModal,
  PinnedMessagesArea,
} from '../../widgets/modals/LeadCenter/components/ChatModals';
import { RootStackParamList } from '../../navigation';
import SafeBottomSpacer from '../../widgets/common/SafeBottomSpacer';
import { useChatSession } from '../../hooks/useChatSession';
import { useVoiceNote, formatTime } from '../../hooks/useVoiceNote';

export default function ChatDetailScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const route = useRoute<RouteProp<RootStackParamList, 'ChatDetail'>>();
  const navigation = useNavigation();
  const { leadId, chatId: initialChatId, customerName, chatType = 'lead' } = route.params;
  const isChannel = chatType === 'channel';

  const { chatId, messages, setMessages, pinnedMessages, loading, currentUserId } = useChatSession(
    initialChatId || null,
    leadId,
    isChannel,
    user
  );

  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [participantModalVisible, setParticipantModalVisible] = useState(false);

  // ─── Voice Note ──────────────────────────────────────────────────────────────
  const {
    recordingState,
    recordingTime,
    recordedUri,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  } = useVoiceNote();

  const isRecording = recordingState === 'recording';
  const isRecorded = recordingState === 'recorded';

  const handleVoicePress = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const handleSendVoiceNote = async () => {
    if (!recordedUri || !chatId) return;
    try {
      const fileName = recordedUri.split('/').pop() || 'voice_note.m4a';
      const file = { uri: recordedUri, name: fileName, type: 'audio/m4a' };
      // Adding text to help Identify
      await ChatService.sendFileMessage(chatId, file, '🎤 Voice Note');
      reset();
    } catch (e) {
      console.error('Voice send error:', e);
    }
  };

  // ─── Attachment ──────────────────────────────────────────────────────────────
  const handleAttach = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        quality: 0.8,
        selectionLimit: 1,
      });
      if (result.assets?.length) {
        const f = result.assets[0];
        const file = { uri: f.uri, name: f.fileName, type: f.type };
        await ChatService.sendFileMessage(chatId!, file, '');
      }
    } catch (error) {
      console.error('Attachment error:', error);
    }
  };

  // ─── Send message ─────────────────────────────────────────────────────────────
  const onSend = useCallback(
    (newMsgs: IMessage[] = []) => {
      if (!chatId) return;
      const raw = newMsgs[0];
      const tempId = Date.now().toString();
      const optimistic = {
        ...raw,
        _id: tempId,
        tempId,
        sent: false,
        received: false,
        replyTo: replyingTo?._id,
        replyToDetails: replyingTo,
        isPinned: false,
      };
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));

      if (editingMessage) {
        ChatService.editMessage(editingMessage._id, raw.text);
        setEditingMessage(null);
      } else {
        ChatService.sendMessage({ chatId, message: raw.text, replyTo: replyingTo?._id });
      }
      setReplyingTo(null);
      ChatService.emitTyping(chatId, false);
    },
    [chatId, replyingTo, editingMessage, setMessages]
  );

  const filteredMessages = useMemo(() => {
    if (!searchQuery) return messages;
    return messages.filter((m: IMessage) =>
      m.text?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [messages, searchQuery]);

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1"
      style={{ backgroundColor: isDark ? '#121212' : '#F8F9FA' }}
    >
      {/* Search Header */}
      {isSearching ? (
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          onClose={() => {
            setIsSearching(false);
            setSearchQuery('');
          }}
        />
      ) : (
        <View
          className="flex-row items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: isDark ? '#1A1A1A' : '#fff', borderBottomColor: colors.border }}
        >
          <View className="flex-row items-center flex-1">
            <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3">
              <Icon name="chevron-back" size={28} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setParticipantModalVisible(true)}
              className="flex-row items-center flex-1"
            >
              <View className="flex-1">
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
                  {customerName}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {isChannel ? 'Team Channel' : 'Lead Customer'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          <View className="flex-row items-center gap-4">
            <TouchableOpacity onPress={() => setIsSearching(true)}>
              <Icon name="search-outline" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            {isChannel && (
              <TouchableOpacity onPress={() => setParticipantModalVisible(true)}>
                <Icon name="people-outline" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <PinnedMessagesArea pinnedMessages={pinnedMessages} onUnpin={(msg) => ChatService.unpinMessage(chatId!, msg._id)} />

      <View className="flex-1">
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={colors.primary.main} />
          </View>
        ) : (
          <GiftedChat
            messages={filteredMessages}
            onSend={(newMsgs: any[]) => onSend(newMsgs)}
            user={{ _id: currentUserId || '' }}
            renderBubble={(props) => (
              <ChatMessageBubble
                bubbleProps={props}
                currentUserId={currentUserId || ''}
                onReply={setReplyingTo}
                onEdit={setEditingMessage}
                onReact={(m, e) => ChatService.addReaction(m._id, e)}
              />
            )}
            renderInputToolbar={(props) => {
              if (isRecorded && recordedUri) {
                return (
                  <View
                    className="p-4 border-t flex-row items-center justify-between"
                    style={{ backgroundColor: isDark ? '#1A1A1A' : '#fff', borderTopColor: colors.border }}
                  >
                    <TouchableOpacity onPress={reset} className="p-2">
                      <Icon name="trash-outline" size={24} color="#EF4444" />
                    </TouchableOpacity>

                    <View className="flex-1 px-4">
                      <View
                        className="flex-row items-center h-10 rounded-full px-3"
                        style={{ backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
                      >
                        <Icon name="mic" size={16} color={colors.primary.main} className="mr-2" />
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>Voice Note Ready</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{formatTime(recordingTime)}</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={handleSendVoiceNote}
                      className="w-10 h-10 rounded-full items-center justify-center shadow-lg"
                      style={{ backgroundColor: colors.primary.main }}
                    >
                      <Icon name="send" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <View>
                  <ChatReplyBar replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
                  <ChatEditBar editingMessage={editingMessage} onCancel={() => setEditingMessage(null)} />
                  <InputToolbar
                    {...props}
                    containerStyle={{
                      backgroundColor: isDark ? '#1A1A1A' : '#fff',
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                    }}
                    renderComposer={(composerProps) => (
                      <View
                        className="flex-1 flex-row items-center rounded-[28px] px-4 min-h-[44px]"
                        style={{ backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
                      >
                        <Composer
                          {...composerProps}
                        />
                        <View className="flex-row items-center gap-4 ml-2">
                          <TouchableOpacity onPress={handleAttach}>
                            <Icon name="attach" size={24} color={colors.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={handleVoicePress}>
                            {isRecording ? (
                              <View className="flex-row items-center">
                                <View className="w-2 h-2 rounded-full bg-red-500 mr-1" />
                                <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700' }}>
                                  {formatTime(recordingTime)}
                                </Text>
                                <Icon name="stop-circle" size={24} color="#EF4444" style={{ marginLeft: 4 }} />
                              </View>
                            ) : (
                              <Icon name="mic" size={24} color="#4CBB17" />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                    renderSend={(sendProps) => {
                      if (!sendProps.text?.trim()) return null;
                      return (
                        <Send {...sendProps} containerStyle={{ marginLeft: 10, justifyContent: 'center' }}>
                          <View
                            className="w-10 h-10 rounded-full items-center justify-center"
                            style={{ backgroundColor: colors.primary.main }}
                          >
                            <Icon name="send" size={20} color="#fff" />
                          </View>
                        </Send>
                      );
                    }}
                  />
                </View>
              );
            }}
            scrollToBottom
            infiniteScroll
            loadEarlier
            textInputStyle={{
              color: colors.text,
              fontSize: 14,
              lineHeight: 18,
            }}
          />
        )}
      </View>

      <ParticipantsModal
        visible={participantModalVisible}
        onClose={() => setParticipantModalVisible(false)}
        leadId={leadId}
        chatId={chatId!}
        isChannel={isChannel}
      />
      <SafeBottomSpacer />
    </SafeAreaView>
  );
}
