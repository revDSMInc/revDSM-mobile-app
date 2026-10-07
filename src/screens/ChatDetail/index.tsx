import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Keyboard,
  Modal,
  Alert,
  Vibration,
} from 'react-native';
import { GiftedChat, IMessage, InputToolbar, Composer, Day, Message } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/Ionicons';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../hooks/useAuth';
import ChatService from '../../services/api/ChatService';
import { ChatReplyBar, ChatEditBar } from '../../widgets/components/chat/ChatBars';
import { ChatMessageBubble } from '../../widgets/components/chat/ChatMessageBubble';
import { LeadImagePickerModal } from '../../widgets/components/chat/LeadImagePickerModal';
import {
  ParticipantsModal,
  PinnedMessagesArea,
  MentionSuggestions,
  EditHistoryModal,
} from '../../widgets/components/chat/ChatModals';
import { JobChangeMessageCard } from '../../widgets/components/chat/JobChangeMessageCard';
import { JobChangeDetailsModal } from '../../widgets/components/chat/JobChangeDetailsModal';
import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { LeadService } from '../../services/api/leads';
import { FlashMessage } from '../../config/message';
import { JobChangeMeta, getJobChangeMeta } from '../../utils/job-change-summary';
import { isHttpStatus } from '../../utils/network-error';
import { RootStackParamList } from '../../navigation';
import { useChatSession } from '../../hooks/useChatSession';
import { useVoiceNote, formatTime, formatMs } from '../../hooks/useVoiceNote';
import { useTeamChannelPermission } from '../../hooks/useTeamChannelPermission';
import { useIsOnline } from '../../hooks/useIsOnline';
import { isClientId } from '../../utils/offline-lead-work';
import { offlineNoticeFor } from '../../utils/offline-capability';

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
const RecordedVoicePlayer = memo(({ uri, onSend, colors, onReset }: any) => {
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

import { useChatLogic } from '../../hooks/useChatLogic';
import { ChatHeader } from '../../widgets/components/chat/ChatHeader';
import { logEvent } from '../../services/api/LoggerService';

export default function ChatDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const route = useRoute<RouteProp<RootStackParamList, 'ChatDetail'>>();
  const { leadId, chatId: initialChatId, customerName, description, chatType = 'lead', initialParticipants = [], salesPhotos: routeSalesPhotos, previewImage: routePreviewImage, previewImages: routePreviewImages } = route.params;
  const isChannel = chatType === 'channel';

  // Log chat open
  React.useEffect(() => {
    if (user?._id) {
      logEvent('open', {
        user_id: user._id,
        module_type: isChannel ? 'team_channel' : 'chat',
        created_by: user._id,
        meta: {
          leadId,
          type: isChannel ? 'team_channel' : 'chat',
          action: 'opened chat',
          participantsCount: initialParticipants?.length || 0,
        },
      });
    }
  }, [user?._id, isChannel, leadId, initialParticipants?.length]);

  const {
    chatId,
    messages,
    setMessages,
    pinnedMessages,
    setPinnedMessages,
    participants,
    loading,
    currentUserId,
    imageUrls,
    typingUsers,
    setLimit,
    channel,
  } = useChatSession(initialChatId || null, leadId, isChannel, user, initialParticipants);

  const filteredParticipants = useMemo(() => {
    return (participants || []).filter((u: any) => {
      const perms = u.dashboardPermissions || [];
      return !perms.includes('vp_sales_dashboard');
    });
  }, [participants]);

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
    handleSend,
    handleAttach,
    handleDocumentAttach,
    pendingAttachments,
    addPendingAppointmentPhotos,
    removePendingAttachment,
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
    filteredParticipants,
    leadId
  );

  // Dynamically resolve channel details and permissions
  const channelObj = useMemo(() => {
    return channel || {
      _id: chatId,
      id: chatId,
      channelType: description?.toLowerCase().includes('announcement') || customerName?.toLowerCase().includes('announcement')
        ? 'announcements'
        : description?.toLowerCase().includes('commission') || customerName?.toLowerCase().includes('commission')
          ? 'commission-sheets'
          : description?.toLowerCase().includes('file') || customerName?.toLowerCase().includes('file')
            ? 'files'
            : 'general'
    };
  }, [channel, chatId, description, customerName]);

  const { canPost } = useTeamChannelPermission(isChannel ? channelObj : null);
  const isManager = user?.role === 'Manager' || user?.role === 'Admin' || user?.isAdmin;
  const isViewOnly = isChannel ? (!canPost && !isManager) : false;

  /**
   * ⚠️ A SECOND, separate lock — deliberately not folded into `isViewOnly`.
   *
   * They are different facts and the rep must be told which one applies: view-only means "this
   * channel is not yours to post in", which no amount of waiting changes, while offline means
   * "try again in a minute". Merging them would tell a rep with no signal they lack permission.
   *
   * The Lead Center blocks the ENTRY to a thread offline; this covers the connection dropping
   * while the rep is already inside one — the composer would otherwise look ready and swallow
   * whatever they typed, since nothing here queues a message.
   */
  const online = useIsOnline();

  /**
   * ⚠️ A lead created at the door has NO THREAD YET, and that is a second reason the
   * composer cannot send — one that has nothing to do with the current signal.
   *
   * A thread is addressed by the lead's SERVER id. Until the queued lead create lands,
   * the only id that exists is the client one (`lead-…`), `getChatByLeadId` finds
   * nothing for it, and `chatId` stays null. `handleSend` then bails on
   * `if (!chatId) return` — reported as **"I press send and nothing happens"**, on a
   * device showing full 5G.
   *
   * Reusing the existing lock is the point: the composer already knows how to explain
   * itself. What was missing was this reason, not the mechanism.
   */
  const threadNotCreatedYet = !isChannel && !chatId && isClientId(leadId);
  const offlineLocked = !online || threadNotCreatedYet;

  const handleDisabledClick = useCallback(() => {
    Alert.alert('Info', 'You are not allowed to post in this channel.');
  }, []);

  const handleOfflineClick = useCallback(() => {
    // ⚠️ Two different reasons, two different messages. Telling a rep on full signal
    // that "messages need a connection" is wrong and unactionable — the thread is
    // simply not on the server yet, and it will be shortly.
    if (threadNotCreatedYet) {
      FlashMessage.info(
        'This lead is still uploading',
        'Messages open once the lead reaches the office. Nothing you type now would be saved.',
      );
      return;
    }
    const notice = offlineNoticeFor('chat-send');
    if (notice) FlashMessage.info(notice.title, notice.message);
  }, [threadNotCreatedYet]);

  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  const [showLeadImagePicker, setShowLeadImagePicker] = useState(false);
  // Action queued while the attachment menu closes. A native picker (gallery /
  // files) or another modal (annotated photos) cannot be presented on iOS until
  // the menu's own modal has fully dismissed, so we defer it to onDismiss.
  const pendingAttachmentAction = useRef<null | (() => void)>(null);

  const runPendingAttachmentAction = useCallback(() => {
    const action = pendingAttachmentAction.current;
    pendingAttachmentAction.current = null;
    action?.();
  }, []);

  // Close the menu, then run the chosen action once it's off-screen.
  const selectAttachmentOption = useCallback((action: () => void) => {
    pendingAttachmentAction.current = action;
    setShowAttachmentSheet(false);
    // Android's <Modal> has no onDismiss; run after it unmounts.
    if (Platform.OS === 'android') {
      setTimeout(runPendingAttachmentAction, 220);
    }
  }, [runPendingAttachmentAction]);
  const [participantModalVisible, setParticipantModalVisible] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);

  // ─── Job-change addendum cards (SALES-APP-ADDENDUM-CHAT.md) ────────────────
  // `jobChangeDraftId` drives the changes modal. `addendumPdfPending` is BOTH the
  // spinner and the double-tap guard — `/amendment-pdf` generates the document on
  // demand for addendums approved before the feature existed, so two taps would
  // mean two PDF builds and two uploads for one addendum.
  //
  // ⚠️ It carries `cardId` (the MESSAGE id) as well as `draftId`, and the spinner
  // is keyed on `cardId`. One addendum posts up to THREE cards (proposed →
  // approved/declined) which all share the same `draftId`, so keying the spinner
  // on the draft lights up every card of that addendum instead of the tapped one.
  const [jobChangeDraftId, setJobChangeDraftId] = useState<string | null>(null);
  const [addendumPdfPending, setAddendumPdfPending] = useState<
    { draftId: string; cardId: string } | null
  >(null);
  const [addendumPdf, setAddendumPdf] = useState<{ visible: boolean; uri: string }>({
    visible: false,
    uri: '',
  });

  const pendingScrollTargetIdRef = useRef<string | null>(null);

  const isRecording = recordingState === 'recording';
  const isRecorded = recordingState === 'recorded';

  const chatRef = useRef<any>(null);
  const listRef = useRef<any>(null);

  const handleNavigateToMessage = useCallback((msg: any) => {
    Vibration.vibrate(70);
    const targetId = typeof msg === 'string' ? msg : String(msg._id || msg.id || "");
    if (!targetId) return;

    const index = filteredMessages.findIndex(
      (m: any) => String(m._id) === targetId || String(m.id) === targetId
    );

    console.log('[Navigate] targetId:', targetId);
    console.log('[Navigate] Calculated index:', index);
    console.log('[Navigate] listRef current exists:', !!listRef.current);
    console.log('[Navigate] chatRef current exists:', !!chatRef.current);

    if (index !== -1) {
      setShowPinned(false);
      setHighlightedMessageId(targetId);
      setTimeout(() => setHighlightedMessageId(null), 2500);

      let attempts = 0;
      const scrollInterval = setInterval(() => {
        const container = listRef.current || chatRef.current?._messageContainerRef?.current;
        const engine = container?.scrollToIndex ? container : (container?.getNode ? container.getNode() : (container?.flatListRef?.current || container?.flatListRef || container?._flatListRef || container));

        if (engine && typeof engine.scrollToIndex === 'function') {
          try {
            console.log('[Navigate] Scrolling to index:', index);
            engine.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
            clearInterval(scrollInterval);
          } catch (e) {
            console.log('[Navigate] ScrollToIndex failed, attempting offset fallback:', e);
            try {
              engine.scrollToOffset({ offset: index * 180, animated: true });
              clearInterval(scrollInterval);
            } catch (err) {
              console.log('[Navigate] Fallback offset scroll failed:', err);
            }
          }
        } else if (engine && typeof engine.scrollToOffset === 'function') {
          try {
            engine.scrollToOffset({ offset: index * 180, animated: true });
            clearInterval(scrollInterval);
          } catch { }
        }

        attempts++;
        if (attempts > 10) clearInterval(scrollInterval);
      }, 100);
    } else {
      console.log('[Navigate] Message not in local batch. Triggering pagination load...');
      pendingScrollTargetIdRef.current = targetId;
      setLimit((prev) => Math.min(prev + 100, 1000));
    }
  }, [filteredMessages, setLimit]);

  useEffect(() => {
    if (pendingScrollTargetIdRef.current) {
      const targetId = pendingScrollTargetIdRef.current;
      const index = filteredMessages.findIndex(
        (m: any) => String(m._id) === targetId || String(m.id) === targetId
      );
      if (index !== -1) {
        console.log('[Pagination Auto-Scroll] Found target message in new batch! Scrolling...');
        pendingScrollTargetIdRef.current = null;
        setTimeout(() => {
          handleNavigateToMessage(targetId);
        }, 300);
      }
    }
  }, [filteredMessages, handleNavigateToMessage]);

  useEffect(() => {
    if (searchResults.length > 0) {
      const matchId = searchResults[searchIndex];
      const match = filteredMessages.find((m: any) => m._id === matchId);
      if (match) {
        setTimeout(() => handleNavigateToMessage(match), 100);
      }
    }
  }, [filteredMessages, handleNavigateToMessage, searchIndex, searchResults]);

  const mentionResults = useMemo(() => {
    console.log('[Mentions Debug] mentionResults recalculating... showMentions:', showMentions, 'composerText:', JSON.stringify(composerText));
    if (!showMentions) return [];
    // Use state-based composerText for reactive filtering
    const lastWord = composerText.split(/\s/).pop() || '';
    console.log('[Mentions Debug] Recalculating lastWord:', JSON.stringify(lastWord));
    if (!lastWord.startsWith('@')) return [];
    const query = lastWord.slice(1).toLowerCase();
    console.log('[Mentions Debug] Recalculating query:', JSON.stringify(query));

    const res = (filteredParticipants || []).filter((u) => {
      if (!u) return false;
      const perms = u.dashboardPermissions || [];
      if (perms.includes('vp_sales_dashboard')) return false;
      if (currentUserId && String(u._id || u.id) === String(currentUserId)) return false;

      const fullName = `${u.firstName || u.name || ''} ${u.lastName || ''}`.toLowerCase();
      const userName = (u.userName || '').toLowerCase();
      const matches = fullName.includes(query) || userName.includes(query);
      console.log(`[Mentions Debug] Checking user "${fullName}" | userName: "${userName}" | Matches:`, matches);
      return matches;
    });
    console.log('[Mentions Debug] Filtered Results count:', res.length, 'from', filteredParticipants?.length || 0, 'participants');
    return res;
  }, [showMentions, filteredParticipants, composerText, currentUserId]);

  const handleMentionSelect = (u: any) => {
    const rawName = u.username || u.userName || u.firstName || u.name || 'User';
    const name = rawName.trim().replace(/\s+/g, '_');
    const words = composerTextRef.current.split(' ');
    // Replace the last word (the @query) with the full mention
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

  const handleVoicePress = useCallback(async () => {
    if (recordingState === 'recording') await stopRecording();
    else await startRecording();
  }, [recordingState, stopRecording, startRecording]);

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
    [colors.surface, colors.textSecondary]
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
      <View className="flex-1 flex-row items-center">
        {/* Attachment "+" — opens the action sheet (Photos / Files / Annotated / Voice) */}
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            setShowAttachmentSheet(true);
          }}
          accessibilityLabel="AttachmentPlus"
          className="w-11 h-11 rounded-full items-center justify-center mr-2"
          style={{ backgroundColor: colors.surface }}
        >
          <Icon name="add" size={28} color={colors.text} />
        </TouchableOpacity>
        <View
          className="flex-1 flex-row items-center rounded-[28px] px-4 min-h-[44px]"
          style={{ backgroundColor: colors.surface }}
        >
          <Composer
            {...composerProps}
            textInputProps={{
              ...composerProps.textInputProps,
              accessibilityLabel: 'ChatInput',
              inputAccessoryViewID: '',
              onChangeText: (text: string) => {
                composerProps.onTextChanged?.(text);
                handleComposerChange(text);
              }
            }}
            textInputStyle={{
              color: colors.text,
              fontSize: 15,
              flex: 1,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          />
        </View>
      </View>
    ),
    [colors.surface, colors.text, handleComposerChange]
  );

  const renderBubble = useCallback(
    (props: any) => {
      const handlePin = async (msg: any) => {
        if (!chatId) return;
        const action = msg.isPinned ? 'unpin' : 'pin';
        try {
          if (user?._id) {
            logEvent('pin', {
              user_id: user._id,
              module_type: isChannel ? 'team_channel' : 'chat',
              created_by: user._id,
              meta: {
                leadId,
                type: isChannel ? 'team_channel' : 'chat',
                action: action === 'pin' ? 'pinned message' : 'unpinned message',
                messageId: msg._id,
              },
            });
          }
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
          if (user?._id) {
            logEvent('reaction', {
              user_id: user._id,
              module_type: isChannel ? 'team_channel' : 'chat',
              created_by: user._id,
              meta: {
                leadId,
                type: isChannel ? 'team_channel' : 'chat',
                action: myPrevReaction ? 'removed reaction' : 'added reaction',
                emoji: e,
                messageId: m._id,
              },
            });
          }
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
          participants={filteredParticipants}
          onReply={setReplyingTo}
          onEdit={handleEdit}
          onReact={handleReact}
          onPin={handlePin}
          onViewHistory={handleViewHistory}
          onNavigateToMessage={handleNavigateToMessage}
          onDelete={(id: string) => {
            // Optimistic UI: remove immediately from local state
            setMessages((prev: any[]) => prev.filter((m: any) => m._id?.toString() !== id?.toString()));
            setPinnedMessages((prev: any[]) => prev.filter((m: any) => m._id?.toString() !== id?.toString()));
            // Emit to server
            ChatService.deleteMessage(id);
          }}
          imageUrls={imageUrls}
          isViewOnly={isViewOnly}
          onDisabledClick={handleDisabledClick}
          searchQuery={searchQuery}
          activeMatchId={highlightedMessageId || searchResults[searchIndex]}
        />
      );
    },
    [currentUserId, filteredParticipants, setReplyingTo, handleNavigateToMessage, imageUrls, isViewOnly, handleDisabledClick, searchQuery, highlightedMessageId, searchResults, searchIndex, chatId, user._id, setMessages, isChannel, leadId, setEditingMessage, setComposerText, setShowMentions, setPinnedMessages]
  );

  // ─── Job-change addendum cards ─────────────────────────────────────────────

  /**
   * Fetch and open an addendum's SIGNED PDF (spec §4.1).
   *
   * The url is a short-lived pre-signed S3 link, so it is fetched at tap time and
   * never cached. Guarded against a double tap: the endpoint GENERATES the
   * document on demand for addendums approved before this feature shipped, so a
   * second concurrent tap costs a duplicate build + upload.
   */
  const openAddendumPdf = useCallback(
    async (draftId: string, cardId: string) => {
      if (!draftId || addendumPdfPending) return;
      setAddendumPdfPending({ draftId, cardId });
      try {
        const res = await LeadService.getDraftAmendmentPdf(draftId);
        const body = res?.data;
        const url = body?.data?.url || body?.url || null;
        if (!url) throw new Error('No PDF returned');
        // ⚠️ The changes modal is deliberately LEFT OPEN when the PDF is opened
        // from inside it (the accepted-fallback button). Dismissing one Modal and
        // presenting another in the same tick is unreliable on iOS — the second
        // can silently fail to appear. The PDF stacks on top instead, and closing
        // it returns to the "customer approved" card, which reads correctly.
        setAddendumPdf({ visible: true, uri: url });
      } catch (err: any) {
        // 409 = the draft is not accepted. It shouldn't reach here from an
        // ACCEPTED card, but fall back to the changes view rather than dead-end.
        if (isHttpStatus(err, 409)) {
          setJobChangeDraftId(draftId);
        } else {
          console.warn('[ChatDetail] addendum PDF failed:', err);
          FlashMessage.error('Error', 'Failed to open the signed addendum. Please try again.');
        }
      } finally {
        setAddendumPdfPending(null);
      }
    },
    [addendumPdfPending]
  );

  /**
   * View on an addendum card. Approved ⇒ the signed PDF, always; anything still
   * open (proposed / declined) ⇒ the before/after the customer was asked to sign.
   * Deliberate, and specified by the client.
   */
  const handleViewJobChange = useCallback(
    (meta: JobChangeMeta, cardId: string) => {
      // Always the tapped card's OWN draftId — a lead can carry several
      // addendums, so "the lead's addendum" is never a valid lookup.
      if (meta.action === 'ACCEPTED') openAddendumPdf(meta.draftId, cardId);
      else setJobChangeDraftId(meta.draftId);
    },
    [openAddendumPdf]
  );

  const renderMessage = useCallback(
    (props: any) => {
      // allow empty messages to render

      // Addendum lifecycle events render as a CARD, not a bubble — bypassing
      // `Message` also drops the avatar, me/them alignment, reactions, the
      // long-press menu and the read-receipt row, all of which web suppresses
      // here. `getJobChangeMeta` returns null for every other message (including
      // unknown future `metadata.type` values), so those fall through unchanged.
      const jobChangeMeta = getJobChangeMeta(props.currentMessage);
      if (jobChangeMeta) {
        return (
          <JobChangeMessageCard
            message={props.currentMessage}
            meta={jobChangeMeta}
            onView={handleViewJobChange}
            // Keyed on the MESSAGE id, not the draft: the proposed and the
            // approved card of one addendum share a draftId, so matching on that
            // would spin BOTH when only one was tapped.
            isLoading={
              !!addendumPdfPending &&
              addendumPdfPending.cardId === String(props.currentMessage?._id)
            }
            colors={colors}
            isDark={isDark}
          />
        );
      }

      const isSameUser =
        props.currentMessage?.user?._id === props.nextMessage?.user?._id;
      const marginBot = isSameUser ? 2 : 10;
      return (
        <Message
          {...props}
          containerStyle={{
            left: { marginBottom: marginBot, marginTop: 0 },
            right: { marginBottom: marginBot, marginTop: 0 },
          }}
        />
      );
    },
    [handleViewJobChange, addendumPdfPending, colors, isDark]
  );

  const renderInputToolbar = useCallback(
    (props: any) => {
      // ⚠️ Offline is tested FIRST. A rep with no signal in a channel they cannot post in has two
      // reasons they cannot type; the one they can act on is the one worth telling them.
      if (offlineLocked) {
        return (
          <TouchableOpacity
            onPress={handleOfflineClick}
            activeOpacity={0.85}
            className="p-4 items-center justify-center border-t flex-row"
            style={{ backgroundColor: colors.card, borderTopColor: colors.border }}
          >
            <MCIcon name="cloud-off-outline" size={15} color={colors.textSecondary} />
            <Text
              className="text-[13px] font-bold ml-2"
              style={{ color: colors.textSecondary }}
            >
              Messages can't be sent offline
            </Text>
          </TouchableOpacity>
        );
      }
      if (isViewOnly) {
        return (
          <TouchableOpacity
            onPress={handleDisabledClick}
            activeOpacity={0.85}
            className="p-4 items-center justify-center border-t"
            style={{ backgroundColor: colors.card, borderTopColor: colors.border }}
          >
            <Text className="text-[13px] font-bold" style={{ color: colors.textSecondary }}>
              You are not allowed to post in this channel.
            </Text>
          </TouchableOpacity>
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

      // Selected-attachment previews — rendered ABOVE the input bar (gifted-chat's
      // renderAccessory sits BELOW the composer row, so it can't go there).
      const pendingStrip =
        pendingAttachments.length > 0 ? (
          <View
            className="px-2 pt-3 pb-1 border-t"
            style={{ backgroundColor: colors.card, borderTopColor: colors.border }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingRight: 8, paddingTop: 4 }}
            >
              {pendingAttachments.map((att: any) => {
                const showImg = att.previewUri && (att.kind === 'appointment' || att.isImage);
                return (
                  <View key={att.id} style={{ marginRight: 10, width: 56 }}>
                    <View
                      className="rounded-xl overflow-hidden"
                      style={{ width: 56, height: 56, backgroundColor: colors.surface }}
                    >
                      {showImg ? (
                        <Image
                          source={{ uri: att.previewUri }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="flex-1 items-center justify-center">
                          <Icon
                            name={att.kind === 'gallery' ? 'videocam' : 'document'}
                            size={22}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => removePendingAttachment(att.id)}
                      className="absolute w-5 h-5 rounded-full items-center justify-center"
                      style={{ top: -2, right: -2, backgroundColor: '#1f2937' }}
                    >
                      <Icon name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                    {att.kind === 'appointment' && !!att.label && (
                      <Text
                        numberOfLines={1}
                        className="text-[8px] font-bold mt-1 text-center"
                        style={{ color: colors.textSecondary }}
                      >
                        {att.label}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null;

      return (
        <View style={{ overflow: 'visible' }}>
          {pendingStrip}
          <InputToolbar
            {...props}
            containerStyle={{
              backgroundColor: colors.card,
              borderTopWidth: pendingStrip ? 0 : 1,
              borderTopColor: colors.border,
              paddingHorizontal: 8,
              paddingVertical: 4,
              overflow: 'visible',
            }}
            primaryStyle={{ overflow: 'visible' }}
            renderAccessory={() => (
              <View style={{ overflow: 'visible' }}>
                <ChatReplyBar replyingTo={replyingTo} currentUserId={currentUserId || ''} onCancel={() => setReplyingTo(null)} />
                <ChatEditBar
                  editingMessage={editingMessage}
                  onCancel={() => setEditingMessage(null)}
                />
              </View>
            )}
            renderComposer={renderComposer}
            renderSend={(sendProps: any) => {
              const hasContent = !!sendProps.text?.trim() || pendingAttachments.length > 0;
              if (!hasContent) return null;
              return (
                <TouchableOpacity
                  onPress={handleSend}
                  accessibilityLabel="SendMessage"
                  style={{ marginLeft: 10, justifyContent: 'center', marginBottom: 5 }}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: colors.primary.main }}
                  >
                    <Icon name="send" size={20} color="#fff" />
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      );
    },
    [offlineLocked, handleOfflineClick, isViewOnly, isRecording, isRecorded, recordedUri, pendingAttachments, colors, renderComposer, handleDisabledClick, cancelRecording, recordingTime, handleVoicePress, handleSendVoiceNote, isDark, reset, removePendingAttachment, replyingTo, currentUserId, editingMessage, setReplyingTo, setEditingMessage, handleSend]
  );

  const renderFooter = useCallback(() => {
    return (
      <View>
        {typingUsers.length > 0 && (
          <View className="px-5 pb-2 mt-1">
            <Text
              className="text-[10px] italic font-bold"
              style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}
            >
              {typingUsers.map((u) => u.name).join(', ')} typing...
            </Text>
          </View>
        )}
      </View>
    );
  }, [typingUsers, isDark]);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      className="flex-1"
      style={{ backgroundColor: colors.background }}
    >
      <ChatHeader
        customerName={customerName}
        description={description}
        leadPreview={{ previewImage: routePreviewImage, previewImages: routePreviewImages }}
        isChannel={isChannel}
        isViewOnly={isViewOnly}
        colors={colors}
        isDark={isDark}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        pinnedMessages={pinnedMessages}
        setShowPinned={setShowPinned}
        participants={filteredParticipants}
        setParticipantModalVisible={setParticipantModalVisible}
        searchIndex={searchIndex}
        totalResults={searchResults.length}
        onPrev={() => setSearchIndex((prev: number) => Math.min(searchResults.length - 1, prev + 1))}
        onNext={() => setSearchIndex((prev: number) => Math.max(0, prev - 1))}
      />

      {loading && messages.length === 0 ? (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
          <ActivityIndicator size="large" color={colors.primary.main} />
          <Text className="mt-4 font-bold opacity-40 tracking-widest text-[10px]" style={{ color: colors.text }}>
            Syncing Secure Room...
          </Text>
        </View>
      ) : Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 64}>
          <View style={{ flex: 1, overflow: 'visible' }}>
            <GiftedChatAny
              ref={chatRef}
              text={composerText}
              messagesContainerRef={listRef}
              messages={filteredMessages}
              onSend={onSend}
              user={{ _id: currentUserId || '' }}
              renderAvatar={null}
              renderBubble={renderBubble}
              renderMessage={renderMessage}
              renderSystemMessage={renderSystemMessage}
              renderDay={renderDay}
              renderInputToolbar={renderInputToolbar}
              onInputTextChanged={handleComposerChange}
              extraData={{ filteredMessages, imageUrls, filteredParticipants, highlightedMessageId }}
              renderChatFooter={renderFooter}
              inverted={true}
              flatListProps={{
                keyboardShouldPersistTaps: 'never',
                contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 20 },
                keyExtractor: (item: any) => (item?._id || item?.id || Math.random()).toString(),
                getItemLayout: (data: any, index: number) => ({
                  length: 160,
                  offset: 160 * index,
                  index,
                }),
                onScrollToIndexFailed: (info: any) => {
                  const container = listRef.current || chatRef.current?._messageContainerRef?.current;
                  const engine = container?.scrollToOffset ? container : (container?.getNode ? container.getNode() : (container?.flatListRef?.current || container?.flatListRef || container?._flatListRef || container));
                  try {
                    console.log('[FlatList] iOS onScrollToIndexFailed index:', info.index);
                    engine?.scrollToOffset?.({
                      offset: info.highestMeasuredFrameIndex * 160 + (info.index - info.highestMeasuredFrameIndex) * 160,
                      animated: true,
                    });
                  } catch (err) {
                    console.log('onScrollToIndexFailed iOS fallback failed:', err);
                  }
                },
              }}
            />
            {showMentions && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 64,
                  left: 16,
                  right: 16,
                  zIndex: 99999,
                  elevation: 20,
                  backgroundColor: colors.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: -4 },
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  overflow: 'hidden'
                }}
              >
                <MentionSuggestions
                  participants={(mentionResults.length > 0 ? mentionResults : filteredParticipants).filter((u: any) => String(u._id || u.id) !== String(currentUserId))}
                  onSelect={handleMentionSelect}
                  colors={colors}
                  isDark={isDark}
                />
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      ) : (
        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
          keyboardVerticalOffset={isKeyboardVisible ? -insets.bottom : 0}
        >
          <View style={{ flex: 1, overflow: 'visible' }}>
            <GiftedChatAny
              ref={chatRef}
              text={composerText}
              messagesContainerRef={listRef}
              messages={filteredMessages}
              onSend={onSend}
              user={{ _id: currentUserId || '' }}
              renderAvatar={null}
              renderBubble={renderBubble}
              renderMessage={renderMessage}
              renderSystemMessage={renderSystemMessage}
              renderDay={renderDay}
              renderInputToolbar={renderInputToolbar}
              onInputTextChanged={handleComposerChange}
              extraData={{ filteredMessages, imageUrls, filteredParticipants, highlightedMessageId }}
              renderChatFooter={renderFooter}
              isKeyboardInternallyHandled={false}
              bottomOffset={0}
              inverted={true}
              flatListProps={{
                keyboardShouldPersistTaps: 'handled',
                contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 20 },
                keyExtractor: (item: any) => (item?._id || item?.id || Math.random()).toString(),
                getItemLayout: (data: any, index: number) => ({
                  length: 160,
                  offset: 160 * index,
                  index,
                }),
                onScrollToIndexFailed: (info: any) => {
                  const container = listRef.current || chatRef.current?._messageContainerRef?.current;
                  const engine = container?.scrollToOffset ? container : (container?.getNode ? container.getNode() : (container?.flatListRef?.current || container?.flatListRef || container?._flatListRef || container));
                  try {
                    console.log('[FlatList] Android onScrollToIndexFailed index:', info.index);
                    engine?.scrollToOffset?.({
                      offset: info.highestMeasuredFrameIndex * 160 + (info.index - info.highestMeasuredFrameIndex) * 160,
                      animated: true,
                    });
                  } catch (err) {
                    console.log('onScrollToIndexFailed Android fallback failed:', err);
                  }
                },
              }}
            />
            {showMentions && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 64,
                  left: 16,
                  right: 16,
                  zIndex: 99999,
                  elevation: 20,
                  backgroundColor: colors.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: -4 },
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  overflow: 'hidden'
                }}
              >
                <MentionSuggestions
                  participants={(mentionResults.length > 0 ? mentionResults : filteredParticipants).filter((u: any) => String(u._id || u.id) !== String(currentUserId))}
                  onSelect={handleMentionSelect}
                  colors={colors}
                  isDark={isDark}
                />
              </View>
            )}
          </View>
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
        {/* Use a plain View wrapper — backdrop and card are SIBLINGS, not parent/child.
            This prevents tap events on the card from bubbling up to the backdrop and
            triggering setShowPinned(false), which in production caused the beforeRemove
            listener to fire and navigate back. */}
        <View style={{ flex: 1 }}>
          {/* Backdrop — sits below the card and closes the modal on tap */}
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setShowPinned(false)}
          />
          {/* Card — floats above backdrop; touches here do NOT reach the backdrop */}
          <View
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              top: Platform.OS === 'ios' ? insets.top + 120 : 110,
              zIndex: 9999,
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: '60%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 16,
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
        </View>
      </Modal>


      <EditHistoryModal
        visible={historyModalVisible}
        onClose={() => setHistoryModalVisible(false)}
        history={historyData}
      />

      {/* Attachment menu — floating context card anchored above the composer */}
      <Modal
        visible={showAttachmentSheet}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setShowAttachmentSheet(false)}
        onDismiss={runPendingAttachmentAction}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowAttachmentSheet(false)}
          style={StyleSheet.absoluteFillObject}
          className="justify-end items-start"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="ml-3 rounded-[26px] overflow-hidden"
            style={{
              backgroundColor: 'rgba(28,28,30,0.98)',
              width: '78%',
              maxWidth: 340,
              marginBottom: insets.bottom + 72,
            }}
          >
            {[
              // "Appointment Photos" surfaces the lead's annotated photos —
              // only meaningful in a lead chat (needs a leadId).
              ...(leadId && !isChannel
                ? [
                  {
                    key: 'annotated',
                    label: 'Appointment Photos',
                    render: (c: string) => <Icon name="apps-outline" size={24} color={c} />,
                    onPress: () => selectAttachmentOption(() => setShowLeadImagePicker(true)),
                  },
                ]
                : []),
              {
                key: 'gallery',
                label: 'Personal Gallery Photos',
                render: (c: string) => <Icon name="images-outline" size={24} color={c} />,
                onPress: () => selectAttachmentOption(handleAttach),
              },
              {
                key: 'files',
                label: 'Files',
                render: (c: string) => <Icon name="document-outline" size={24} color={c} />,
                onPress: () => selectAttachmentOption(handleDocumentAttach),
              },
              {
                key: 'voice',
                label: 'Voice Memo',
                render: (c: string) => (
                  <View
                    className="w-[24px] h-[24px] rounded-full items-center justify-center"
                    style={{ borderWidth: 2, borderColor: c }}
                  >
                    <MCIcon name="waveform" size={12} color={c} />
                  </View>
                ),
                onPress: () => selectAttachmentOption(handleVoicePress),
              },
            ].map((opt, idx, arr) => (
              <TouchableOpacity
                key={opt.key}
                onPress={opt.onPress}
                activeOpacity={0.6}
                className="flex-row items-center px-5 py-4"
                style={
                  idx < arr.length - 1
                    ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' }
                    : undefined
                }
              >
                <View className="w-9 items-center justify-center mr-4">
                  {opt.render('#FFFFFF')}
                </View>
                <Text
                  className="flex-1 text-md text-white"
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Addendum "View" — the before/after for a proposed/declined change… */}
      <JobChangeDetailsModal
        visible={!!jobChangeDraftId}
        draftId={jobChangeDraftId}
        onClose={() => setJobChangeDraftId(null)}
        // The modal has a single button, so there is no card to disambiguate —
        // it gets its own sentinel id and reads `pdfLoading` rather than the
        // per-card match.
        onOpenPdf={(draftId) => openAddendumPdf(draftId, `modal:${draftId}`)}
        pdfLoading={!!addendumPdfPending}
      />

      {/* …and the signed document once the customer has approved. */}
      <PdfPreviewModal
        visible={addendumPdf.visible}
        uri={addendumPdf.uri}
        title="Signed Addendum"
        onClose={() => setAddendumPdf({ visible: false, uri: '' })}
      />

      <LeadImagePickerModal
        visible={showLeadImagePicker}
        onClose={() => setShowLeadImagePicker(false)}
        leadId={leadId}
        initialSalesPhotos={routeSalesPhotos}
        onConfirm={(photos) => {
          setShowLeadImagePicker(false);
          // Stage the photos as composer previews — the user can add a caption
          // and then Send (images upload first, then the message).
          addPendingAppointmentPhotos(photos);
        }}
      />
    </SafeAreaView>
  );
}
