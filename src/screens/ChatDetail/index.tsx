import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Keyboard,
  TextInput,
  Modal,
} from 'react-native';
import { GiftedChat, IMessage, Send, InputToolbar, Composer, Day } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/Ionicons';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../hooks/useAuth';
import ChatService from '../../services/api/ChatService';
import { ChatReplyBar, ChatEditBar } from '../../widgets/components/chat/ChatBars';
import { ChatMessageBubble } from '../../widgets/components/chat/ChatMessageBubble';
import {
  SearchBar,
  ParticipantsModal,
  PinnedMessagesArea,
  MentionSuggestions,
  EditHistoryModal,
} from '../../widgets/components/chat/ChatModals';
import { RootStackParamList } from '../../navigation';
import Pin from '../../assets/svgs/icons/pin';
import SafeBottomSpacer from '../../widgets/common/SafeBottomSpacer';
import { useChatSession } from '../../hooks/useChatSession';
import { useVoiceNote, formatTime, formatMs } from '../../hooks/useVoiceNote';

const GiftedChatAny = GiftedChat as any;
// ─── Custom Message Type ──────────────────────────────────────────────────────
export interface ICustomMessage extends IMessage {
  reactions?: any[];
  isPinned?: boolean;
  replyTo?: string;
  replyToDetails?: any;
}

// ─── Sub-Component for Recorded Voice Playback ───────────────────────────────
// This isolates playback state updates to prevent the whole ChatDetail from re-rendering
const RecordedVoicePlayer = memo(({ uri, onSend, colors, isDark, onReset }: any) => {
  const { playbackState, playbackPos, playbackDuration, startPlayback, pausePlayback } =
    useVoiceNote();

  return (
    <View
      className="p-3 border-t flex-row items-center"
      style={{ backgroundColor: colors.card, borderTopColor: colors.border }}
    >
      <TouchableOpacity onPress={onReset} className="p-2 mr-2">
        <Icon name="trash-outline" size={24} color="#EF4444" />
      </TouchableOpacity>
      <View
        className="flex-1 flex-row items-center rounded-full px-4 h-12 shadow-sm"
        style={{ backgroundColor: colors.surface }}
      >
        <TouchableOpacity
          onPress={() => (playbackState === 'playing' ? pausePlayback() : startPlayback(uri))}
          className="mr-3"
        >
          <Icon
            name={playbackState === 'playing' ? 'pause-circle' : 'play-circle'}
            size={32}
            color={colors.primary.main}
          />
        </TouchableOpacity>
        <View className="flex-1">
          <View className="h-1 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
            <View
              className="h-full bg-emerald-500"
              style={{ width: `${(playbackPos / (playbackDuration || 1)) * 100}%` }}
            />
          </View>
          <View className="flex-row justify-between mt-1">
            <Text className="text-[10px] font-bold" style={{ color: colors.primary.main }}>
              {formatMs(playbackPos)}
            </Text>
            <Text className="text-[10px] opacity-40" style={{ color: colors.text }}>
              {formatMs(playbackDuration)}
            </Text>
          </View>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => onSend(uri)}
        className="ml-4 w-11 h-11 rounded-full items-center justify-center shadow-lg"
        style={{ backgroundColor: colors.primary.main }}
      >
        <Icon name="send" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
});

const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ('00' + value.toString(16)).substring(value.toString(16).length - 2);
  }
  return color;
};

const CHANNEL_SCHEMES: Record<string, { icon: string; color: string }> = {
  Announcements: { icon: '📢', color: '#FF6B6B' },
  'Sales Wins': { icon: '🎉', color: '#51CF66' },
  General: { icon: '💬', color: '#748FFC' },
  Files: { icon: '📁', color: '#339AF0' },
  Commission: { icon: '💰', color: '#FFC107' },
  'Commission Sheets': { icon: '💰', color: '#FFC107' },
  Questions: { icon: '❓', color: '#9775FA' },
};

import { useChatLogic } from '../../hooks/useChatLogic';
import { ChatHeader } from '../../widgets/components/chat/ChatHeader';

export default function ChatDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const route = useRoute<RouteProp<RootStackParamList, 'ChatDetail'>>();
  const navigation = useNavigation<any>();
  const { leadId, chatId: initialChatId, customerName, chatType = 'lead' } = route.params;
  const isChannel = chatType === 'channel';

  const {
    chatId,
    messages,
    setMessages,
    pinnedMessages,
    participants,
    loading,
    currentUserId,
    imageUrls,
  } = useChatSession(initialChatId || null, leadId, isChannel, user);

  const {
    filteredMessages,
    searchQuery,
    setSearchQuery,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    showMentions,
    setShowMentions,
    composerText,
    setComposerText,
    composerTextRef,
    isKeyboardVisible,
    handleComposerChange,
    onSend,
    handleAttach,
    handleSendVoiceNote,
    recordingState,
    recordingTime,
    recordedUri,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
    searchIndex,
    setSearchIndex,
    searchResults,
  } = useChatLogic(
    chatId,
    messages,
    setMessages,
    currentUserId || '',
    user,
    isChannel,
    participants
  );

  const isAnnouncement = isChannel && customerName?.toLowerCase().includes('announcement');
  const isManager = user?.role === 'Manager' || user?.role === 'Admin' || user?.isAdmin;
  const isViewOnly = isAnnouncement && !isManager;

  const [isSearching, setIsSearching] = useState(false);
  const [participantModalVisible, setParticipantModalVisible] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const flatListRef = useRef<any>(null);

  const isRecording = recordingState === 'recording';
  const isRecorded = recordingState === 'recorded';

  const handleNavigateToMessage = (msg: any) => {
    const index = filteredMessages.findIndex((m: any) => m._id === msg._id);
    if (index !== -1 && flatListRef.current) {
      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0.5,
        });
      } catch (e) {
        console.log('Scroll to index failed:', e);
      }
    }
  };

  useEffect(() => {
    if (searchResults.length > 0) {
      const matchId = searchResults[searchIndex];
      const match = filteredMessages.find((m: any) => m._id === matchId);
      if (match) {
        setTimeout(() => handleNavigateToMessage(match), 100);
      }
    }
  }, [searchIndex, searchResults]);

  const handleMentionSelect = (u: any) => {
    const name = u.firstName || u.name;
    const words = composerTextRef.current.split(' ');
    words[words.length - 1] = `@${name} `;
    const newText = words.join(' ');
    setComposerText(newText);
    composerTextRef.current = newText;
    setShowMentions(false);
  };

  const handleViewHistory = (msg: any) => {
    setHistoryData(msg.editHistory || []);
    setHistoryModalVisible(true);
  };

  const handleVoicePress = async () => {
    if (recordingState === 'recording') await stopRecording();
    else await startRecording();
  };

  // ─── Render Functions ───────────────────────────────────────────────────────

  const renderSystemMessage = useCallback(
    (props: any) => {
      const { currentMessage } = props;
      const name = currentMessage.user?.name || 'Member';
      const userId = currentMessage.user?._id || 'unknown';
      const initial = name.charAt(0).toUpperCase();

      // Priority Hash color
      let bgColor = stringToColor(userId);

      if (name.includes('Operational Manager')) bgColor = '#67e8f9'; // OM (Cyan)
      if (name.includes('Assi')) bgColor = '#fca5a5'; // AOM (Red/Coral)

      return (
        <View className="items-center justify-center my-2">
          <View
            className="flex-row items-center px-4 py-1.5 rounded-2xl shadow-sm"
            style={{ backgroundColor: colors.surface }}
          >
            <View
              className="w-7 h-7 rounded-full items-center justify-center mr-2 shadow-sm"
              style={{ backgroundColor: bgColor }}
            >
              <Text className="text-[11px] font-black text-slate-800">{initial}</Text>
            </View>
            <Text className="text-xs font-bold" style={{ color: colors.textSecondary }}>
              {currentMessage.text}
            </Text>
          </View>
        </View>
      );
    },
    [isDark]
  );

  const renderDay = useCallback(
    (props: any) => {
      // Don't show the date separator for the initial onboarding system messages
      if (
        props.currentMessage?.system &&
        props.currentMessage?._id?.toString().startsWith('sys-')
      ) {
        return null;
      }
      return (
        <Day
          {...props}
          textStyle={{ color: isDark ? '#94a3b8' : '#94a3b8', fontSize: 13, fontWeight: '800' }}
          containerStyle={{ marginTop: 24, marginBottom: 16 }}
        />
      );
    },
    [isDark]
  );

  const renderComposer = useCallback(
    (composerProps: any) => (
      <View
        className="flex-1 flex-row items-center rounded-[28px] px-4 min-h-[44px]"
        style={{ backgroundColor: colors.surface }}
      >
        <Composer
          {...composerProps}
          textInputStyle={{
            color: colors.text,
            fontSize: 15,
            flex: 1,
            paddingTop: 8,
            paddingBottom: 8,
          }}
        />
        <View className="flex-row items-center gap-4 ml-2">
          <TouchableOpacity onPress={handleAttach}>
            <Icon name="attach" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleVoicePress}>
            <Icon name="mic" size={24} color="#4CBB17" />
          </TouchableOpacity>
        </View>
      </View>
    ),
    [isDark, colors.textSecondary, handleAttach, handleVoicePress]
  );

  const renderBubble = useCallback(
    (props: any) => {
      const handlePin = async (msg: any) => {
        if (!chatId) return;
        const action = msg.isPinned ? 'unpin' : 'pin';
        try {
          // Optimistic update
          setMessages((prev) =>
            prev.map((m) => (m._id === msg._id ? { ...m, isPinned: !msg.isPinned } : m))
          );

          if (action === 'pin') {
            ChatService.pinMessage(chatId, msg._id, isChannel);
          } else {
            ChatService.unpinMessage(chatId, msg._id, isChannel);
          }
        } catch (err) {
          console.error('Pinning failed:', err);
          // Revert optimistic update
          setMessages((prev) =>
            prev.map((m) => (m._id === msg._id ? { ...m, isPinned: msg.isPinned } : m))
          );
        }
      };

      const handleEdit = (msg: any) => {
        setEditingMessage(msg);
        setComposerText(msg.text || '');
        setShowMentions(false);
      };

      const handleReact = async (m: any, e: string) => {
        if (!chatId) return;

        // Find if I have ANY existing reaction on this message
        const myPrevReaction = m.reactions?.find((r: any) =>
          r.users?.some((u: any) => String(u.userId) === String(currentUserId))
        );

        const alreadyReactedSameEmoji = myPrevReaction?.emoji === e;

        try {
          // Optimistic update
          setMessages((prev) =>
            prev.map((msgItem: ICustomMessage) => {
              if (msgItem._id !== m._id) return msgItem;
              let newReactions = [...(msgItem.reactions || [])];

              // 1. Remove my existing reaction from ANY emoji group
              newReactions = newReactions
                .map((r) => ({
                  ...r,
                  users: r.users.filter((u: any) => String(u.userId) !== String(currentUserId)),
                }))
                .filter((r) => r.users.length > 0);

              // 2. If it was a different emoji (or no emoji), add the new one
              if (!alreadyReactedSameEmoji) {
                const rIdx = newReactions.findIndex((r) => r.emoji === e);
                if (rIdx !== -1) {
                  newReactions[rIdx] = {
                    ...newReactions[rIdx],
                    users: [...newReactions[rIdx].users, { userId: currentUserId }],
                  };
                } else {
                  newReactions.push({ emoji: e, users: [{ userId: currentUserId }] });
                }
              }

              return { ...msgItem, reactions: newReactions };
            })
          );

          // 3. Socket emits
          if (myPrevReaction) {
            ChatService.removeReaction(chatId, m._id, myPrevReaction.emoji);
          }
          if (!alreadyReactedSameEmoji) {
            ChatService.addReaction(chatId, m._id, e);
          }
        } catch (err) {
          console.error('Reaction failed:', err);
        }
      };

      return (
        <ChatMessageBubble
          bubbleProps={props}
          currentUserId={currentUserId || ''}
          participants={participants}
          onReply={setReplyingTo}
          onEdit={handleEdit}
          onReact={handleReact}
          onPin={handlePin}
          onViewHistory={handleViewHistory}
          onNavigateToMessage={handleNavigateToMessage}
          onDelete={(id: string) => ChatService.deleteMessage(id)}
          imageUrls={imageUrls}
          isViewOnly={isViewOnly}
          searchQuery={searchQuery}
          activeMatchId={searchResults[searchIndex]}
        />
      );
    },
    [chatId, currentUserId, isChannel, imageUrls, isViewOnly]
  );

  const renderInputToolbar = useCallback(
    (props: any) => {
      if (isViewOnly) {
        return (
          <View className="p-4 items-center justify-center bg-gray-50 border-t border-gray-100">
            <Text className="text-[10px] font-black text-gray-400">
              Only Managers can message here
            </Text>
          </View>
        );
      }
      if (isRecording) {
        return (
          <View
            className="p-3 border-t flex-row items-center"
            style={{ backgroundColor: colors.card, borderTopColor: colors.border }}
          >
            <TouchableOpacity onPress={cancelRecording} className="p-2 mr-2">
              <Icon name="trash-outline" size={24} color="#EF4444" />
            </TouchableOpacity>
            <View
              className="flex-1 flex-row items-center rounded-full px-6 h-12"
              style={{ backgroundColor: colors.surface }}
            >
              <View className="w-2 h-2 rounded-full bg-red-500 mr-2" />
              <Text style={{ color: '#EF4444', fontSize: 14, fontWeight: '700' }}>
                Recording... {formatTime(recordingTime)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleVoicePress}
              className="ml-3 w-11 h-11 rounded-full items-center justify-center"
              style={{ backgroundColor: '#EF4444' }}
            >
              <Icon name="stop" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      }

      if (isRecorded && recordedUri) {
        return (
          <RecordedVoicePlayer
            uri={recordedUri}
            onSend={handleSendVoiceNote}
            colors={colors}
            isDark={isDark}
            onReset={reset}
          />
        );
      }

      return (
        <InputToolbar
          {...props}
          containerStyle={{
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingHorizontal: 4,
            paddingVertical: 4,
            overflow: 'visible',
          }}
          primaryStyle={{ overflow: 'visible' }}
          renderAccessory={() => (
            <View style={{ overflow: 'visible' }}>
              {showMentions && (
                <View style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 9999, elevation: 10 }}>
                  <MentionSuggestions
                    participants={(participants || []).filter((u) => {
                      if (!u) return false;
                      const query = (composerTextRef.current.split(' ').pop() || '')
                        .slice(1)
                        .toLowerCase();
                      const fullName = `${u.firstName || u.name || ''} ${u.lastName || ''}`.toLowerCase();
                      return fullName.includes(query) || (u.userName || '').toLowerCase().includes(query);
                    })}
                    onSelect={handleMentionSelect}
                    colors={colors}
                    isDark={isDark}
                  />
                </View>
              )}
              <ChatReplyBar replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
              <ChatEditBar
                editingMessage={editingMessage}
                onCancel={() => setEditingMessage(null)}
              />
            </View>
          )}
          renderComposer={renderComposer}
          renderSend={(sendProps) => {
            if (!sendProps.text?.trim()) return null;
            return (
              <Send
                {...sendProps}
                containerStyle={{ marginLeft: 10, justifyContent: 'center', marginBottom: 5 }}
              >
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
      );
    },
    [
      isRecording,
      isRecorded,
      recordedUri,
      isDark,
      colors,
      recordingTime,
      showMentions,
      participants,
      replyingTo,
      editingMessage,
      handleMentionSelect,
      renderComposer,
      handleSendVoiceNote,
      cancelRecording,
      handleVoicePress,
      reset,
    ]
  );

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      className="flex-1"
      style={{ backgroundColor: colors.background }}
    >
      <ChatHeader
        customerName={customerName}
        isChannel={isChannel}
        colors={colors}
        isDark={isDark}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        pinnedMessages={pinnedMessages}
        setShowPinned={setShowPinned}
        participants={participants}
        setParticipantModalVisible={setParticipantModalVisible}
        searchIndex={searchIndex}
        totalResults={searchResults.length}
        onPrev={() => setSearchIndex((prev: number) => Math.min(searchResults.length - 1, prev + 1))}
        onNext={() => setSearchIndex((prev: number) => Math.max(0, prev - 1))}
      />

      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={64}>
          <GiftedChatAny
            messages={filteredMessages}
            onSend={onSend}
            user={{ _id: currentUserId || '' }}
            renderAvatar={null}
            renderBubble={renderBubble}
            renderSystemMessage={renderSystemMessage}
            renderDay={renderDay}
            renderInputToolbar={renderInputToolbar}
            onInputTextChanged={handleComposerChange}
            extraData={{ filteredMessages, imageUrls, showMentions, composerText }}
            inverted={true}
            listViewProps={{
              ref: (r: any) => {
                if (r) flatListRef.current = r;
              },
              keyboardShouldPersistTaps: 'never',
              contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 20 },
              keyExtractor: (item: any) => (item?._id || item?.id || Math.random()).toString(),
              getItemLayout: (data: any, index: number) => ({
                length: 100,
                offset: 100 * index,
                index,
              }),
              onScrollToIndexFailed: (info: any) => {
                flatListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
                setTimeout(() => {
                  try {
                    flatListRef.current?.scrollToIndex({
                      index: info.index,
                      animated: false,
                      viewPosition: 0.5,
                    });
                  } catch (e) {
                    console.log('Fallback scroll failed', e);
                  }
                }, 100);
              },
            }}
          />
        </KeyboardAvoidingView>
      ) : (
        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
          keyboardVerticalOffset={isKeyboardVisible ? -insets.bottom : 0}
        >
          <GiftedChatAny
            messages={filteredMessages}
            onSend={onSend}
            user={{ _id: currentUserId || '' }}
            renderAvatar={null}
            renderBubble={renderBubble}
            renderSystemMessage={renderSystemMessage}
            renderDay={renderDay}
            renderInputToolbar={renderInputToolbar}
            onInputTextChanged={handleComposerChange}
            extraData={{ filteredMessages, imageUrls, showMentions, composerText }}
            isKeyboardInternallyHandled={false}
            bottomOffset={0}
            inverted={true}
            listViewProps={{
              ref: (r: any) => {
                if (r) flatListRef.current = r;
              },
              keyboardShouldPersistTaps: 'handled',
              contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 20 },
              keyExtractor: (item: any) => (item?._id || item?.id || Math.random()).toString(),
              getItemLayout: (data: any, index: number) => ({
                length: 100,
                offset: 100 * index,
                index,
              }),
              onScrollToIndexFailed: (info: any) => {
                flatListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
                setTimeout(() => {
                  try {
                    flatListRef.current?.scrollToIndex({
                      index: info.index,
                      animated: false,
                      viewPosition: 0.5,
                    });
                  } catch (e) {
                    console.log('Fallback scroll failed', e);
                  }
                }, 100);
              },
            }}
          />
        </KeyboardAvoidingView>
      )}

      <ParticipantsModal
        visible={participantModalVisible}
        onClose={() => setParticipantModalVisible(false)}
        leadId={leadId}
        chatId={chatId!}
        isChannel={isChannel}
      />
      <Modal
        visible={showPinned}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPinned(false)}
      >
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setShowPinned(false)}>
          <View
            className="absolute left-4 right-4 z-[9999] rounded-2xl shadow-2xl border"
            style={{
              top: Platform.OS === 'ios' ? insets.top + 120 : 110,
              backgroundColor: colors.card,
              borderColor: colors.border,
              maxHeight: '60%',
            }}
          >
            <PinnedMessagesArea
              pinnedMessages={pinnedMessages}
              imageUrls={imageUrls}
              onUnpin={(msg: any) => ChatService.unpinMessage(chatId!, msg._id, isChannel)}
              onNavigate={(msg: any) => {
                handleNavigateToMessage(msg);
                setShowPinned(false);
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <EditHistoryModal
        visible={historyModalVisible}
        onClose={() => setHistoryModalVisible(false)}
        history={historyData}
      />
    </SafeAreaView>
  );
}
