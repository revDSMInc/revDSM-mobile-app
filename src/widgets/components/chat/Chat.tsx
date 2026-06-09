import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  ImageBackground,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { GiftedChat, IMessage, Send, InputToolbar, Composer, Message } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/Ionicons';
import { Storage } from '../../../utils/storage';
import { useTheme } from '../../../theme/ThemeProvider';
import { useAuth } from '../../../hooks/useAuth';
import ChatService from '../../../services/api/ChatService';
import { ModalContainer, ModalHeader } from '../LeadCenter/SharedElements';
import { ChatReplyBar, ChatEditBar } from './ChatBars';
import { ChatMessageBubble } from './ChatMessageBubble';
import { MentionSuggestions, EditHistoryModal } from './ChatModals';

interface Props {
  visible: boolean;
  onClose: () => void;
  lead: any;
}

export default function Chat({ onClose, lead }: Props) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const currentUserId = user?._id || user?.id || 'ghost';

  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [limit, setLimit] = useState(30);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [filteredParticipants, setFilteredParticipants] = useState<any[]>([]);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const composerTextRef = useRef('');

  const socketRef = useRef<any>(null);
  const typingTimers = useRef<Map<string, any>>(new Map());

  // Wallpaper mapping
  const wallpaperColor = isDark ? '#0B141A' : '#E5DDD5';

  // ── helpers ─────────────────────────────────────────────────────────────────

  const refreshChatParticipants = useCallback(async (id: string) => {
    try {
      const parts = await ChatService.getLeadParticipants(id);
      setParticipants(parts);
    } catch (e) {
      console.error('Refresh participants failed:', e);
    }
  }, []);

  const cleanFilePath = (filePath: string): string => {
    let p = filePath;
    if (!p) return '';
    p = p.replace(/^(file:\/\/|content:\/\/|data:)/, '');
    const roots = ['chat/', 'leads/', 'files/', 'customer/', 'revdsm/'];
    for (const root of roots) {
      const idx = p.indexOf(root);
      if (idx !== -1) return p.substring(idx);
    }
    return p.replace(/^\/+/, '');
  };

  const fetchSecureUrls = async (newMessages: any[]) => {
    try {
      const rawPaths = ChatService.extractFilePaths(newMessages);
      const cleanedPaths = Array.from(new Set(rawPaths.map(cleanFilePath)));
      if (cleanedPaths.length === 0) return;

      const links = await ChatService.getSecureFileUrls(cleanedPaths).catch(() => ({}));
      setImageUrls((prev) => ({ ...prev, ...links }));
    } catch (error) {
      console.error('Failed to fetch secure links:', error);
    }
  };

  const loadMessages = useCallback(async (id: string, lim: number) => {
    try {
      const raw = await ChatService.getMessages(id, lim);
      setHasMore(raw.length >= lim);
      
      // Stable sort: newest-first (b - a) for bottom-to-top flow
      const sorted = [...raw].sort((a, b) => {
        const dA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const dB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return dB.getTime() - dA.getTime();
      });

      setMessages(sorted);
      fetchSecureUrls(sorted);
    } catch (e) {
      console.error('Load messages:', e);
    }
  }, []);

  // ── socket setup ─────────────────────────────────────────────────────────────

  const attachSocketListeners = useCallback(
    (socket: any, id: string) => {
      // Pinned Messages Sync
      socket.on('message-pinned', (data: any) => {
        const mId = (data.messageId || data.id || data.message?._id)?.toString();
        setMessages((prev) => prev.map((m) => (m._id === mId ? { ...m, isPinned: true } : m)));
      });

      socket.on('message-unpinned', (data: any) => {
        const mId = (data.messageId || data.id || data.message?._id)?.toString();
        setMessages((prev) => prev.map((m) => (m._id === mId ? { ...m, isPinned: false } : m)));
      });

      socket.on('pinned-messages-response', (data: any) => {
        if (data?.pinnedMessages) {
          const pinnedIds = new Set(
            data.pinnedMessages.map((m: any) => (m._id || m.id)?.toString())
          );
          setMessages((prev) => prev.map((m) => ({ ...m, isPinned: pinnedIds.has(m._id) })));
        }
      });

      socket.on('new-message', (data: any) => {
        const msg = data.message || data;
        const normalized = ChatService.normalizeMessage(msg);
        ChatService.markSeen(id, [normalized._id]);

        setMessages((prev) => {
          if (prev.some((m) => m._id === normalized._id)) return prev;
          fetchSecureUrls([normalized]);
          return [normalized, ...prev];
        });
      });

      socket.on('user-joined', () => refreshChatParticipants(id));

      socket.on('message-seen', ({ messageId, seenBy }: any) => {
        setMessages((prev) =>
          prev.map((m) => (m._id === messageId ? { ...m, seenBy, received: true } : m))
        );
      });

      socket.on('user-typing', (data: any) => {
        if (data.userId === currentUserId) return;
        if (data.isTyping) {
          setTypingUsers((prev) =>
            prev.find((u) => u.id === data.userId)
              ? prev
              : [...prev, { id: data.userId, name: data.userName || 'User' }]
          );
          if (typingTimers.current.has(data.userId)) {
            clearTimeout(typingTimers.current.get(data.userId));
          }
          typingTimers.current.set(
            data.userId,
            setTimeout(() => setTypingUsers((p) => p.filter((u) => u.id !== data.userId)), 3000)
          );
        } else {
          setTypingUsers((prev) => prev.filter((u) => u.id !== data.userId));
        }
      });

      socket.on('reaction-added', ({ messageId, reactions }: any) => {
        setMessages((prev) => prev.map((m) => (m._id === messageId ? { ...m, reactions } : m)));
      });

      socket.on('message-edited', (m: any) => {
        const normalized = ChatService.normalizeMessage(m);
        setMessages((prev) => prev.map((msg) => (msg._id === normalized._id ? normalized : msg)));
      });

      // Initial fetch
      ChatService.getPinnedMessages(id);
    },
    [currentUserId, refreshChatParticipants]
  );

  // ── init ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        let activeId = chatId;
        if (!activeId && lead?._id) {
          activeId = await ChatService.getChatByLeadId(lead._id);
          if (mounted) setChatId(activeId);
        }
        if (activeId && mounted) {
          // Clear previous messages to ensure a fresh, correctly ordered load
          setMessages([]);
          await loadMessages(activeId, 30);

          // Participant Logic (Auto-join sync)
          const parts = await ChatService.getLeadParticipants(activeId);
          setParticipants(parts);
          const isPart = parts.some((p) => (p?._id || p?.id || p) === currentUserId);
          if (!isPart && currentUserId) {
            await ChatService.addParticipant(activeId, currentUserId);
          }

          const token = Storage.getItem('accessToken');
          if (token && mounted) {
            const socket = ChatService.connect(token, activeId);
            socketRef.current = socket;
            attachSocketListeners(socket, activeId);
          }
        }
      } finally {
        if (mounted) {
          const isAnnouncement = lead?.customerName?.toLowerCase().includes('announcement');
          const isManager = user?.role === 'Manager' || user?.role === 'Admin' || user?.isAdmin;
          setIsViewOnly(!!isAnnouncement && !isManager);
          setLoading(false);
        }
      }
    };
    init();
    return () => {
      mounted = false;
      ChatService.disconnect();
      typingTimers.current.forEach(clearTimeout);
    };
  }, [lead?._id, chatId, loadMessages, attachSocketListeners, currentUserId]);

  // ── actions ───────────────────────────────────────────────────────────────────

  const onSend = useCallback(
    async (newMsgs: IMessage[] = []) => {
      if (!chatId) return;
      const raw = newMsgs[0];

      try {
        if (editingMessage) {
          // Optimistic Edit
          const oldText = editingMessage.text;
          setMessages(prev => prev.map(m => m._id === editingMessage._id ? { ...m, text: raw.text, isEdited: true } : m));
          await ChatService.editMessage(editingMessage._id, raw.text).catch(err => {
            // Revert on failure
            setMessages(prev => prev.map(m => m._id === editingMessage._id ? { ...m, text: oldText } : m));
            throw err;
          });
          setEditingMessage(null);
        } else {
          // Optimistic Send
          const tempId = `temp_${Date.now()}`;
          const optimisticMsg = {
            ...raw,
            _id: tempId,
            createdAt: new Date(),
            user: { _id: currentUserId, name: user?.firstName || 'Me' },
            pending: true
          };
          setMessages(prev => [optimisticMsg, ...prev]);

          await ChatService.sendMessageREST({
            chatId,
            message: raw.text,
            replyTo: replyingTo?._id,
          });
        }
      } catch (err) {
        console.error('Send message failed:', err);
      } finally {
        setReplyingTo(null);
        ChatService.emitTyping(chatId, false);
      }
    },
    [chatId, replyingTo, editingMessage]
  );

  const handleLoadEarlier = async () => {
    if (loadingMore || !hasMore || !chatId) return;
    setLoadingMore(true);
    const newLimit = limit + 30;
    setLimit(newLimit);
    await loadMessages(chatId, newLimit);
    setLoadingMore(false);
  };

  const handleReact = async (msg: any, emoji: string) => {
    const existing = msg.reactions?.find((r: any) => r.emoji === emoji);
    const alreadyReacted = existing?.users?.some((u: any) => u.userId === currentUserId);
    const action = alreadyReacted ? 'remove' : 'add';

    try {
      if (action === 'add') {
        ChatService.addReaction(chatId || '', msg._id, emoji);
      } else {
        ChatService.removeReaction(chatId || '', msg._id, emoji);
      }
    } catch (err) {
      console.error('Reaction failed:', err);
    }
  };

  const handlePin = async (msg: any) => {
    if (!chatId) return;
    const action = msg.isPinned ? 'unpin' : 'pin';

    try {
      // Optimistic update
      setMessages((prev) =>
        prev.map((m) => (m._id === msg._id ? { ...m, isPinned: !msg.isPinned } : m))
      );
      if (action === 'pin') {
        ChatService.pinMessage(chatId, msg._id, false);
      } else {
        ChatService.unpinMessage(chatId, msg._id, false);
      }
    } catch (err) {
      console.error('Pinning failed:', err);
      // Revert optimistic
      setMessages((prev) =>
        prev.map((m) => (m._id === msg._id ? { ...m, isPinned: msg.isPinned } : m))
      );
    }
  };

  const handleDelete = (msgId: string) => {
    ChatService.deleteMessage(msgId);
    // Optimistic update
    setMessages((prev) => prev.filter((m) => m._id !== msgId));
  };

  // ── renderers ──────────────────────────────────────────────────────────────────

  const handleViewHistory = useCallback((msg: any) => {
    setHistoryData(msg.editHistory || []);
    setHistoryModalVisible(true);
  }, []);

  const renderBubble = useCallback(
    (props: any) => (
      <ChatMessageBubble
        bubbleProps={props}
        currentUserId={currentUserId}
        onReply={setReplyingTo}
        onEdit={setEditingMessage}
        onReact={handleReact}
        onPin={handlePin}
        onViewHistory={handleViewHistory}
        onDelete={handleDelete}
        imageUrls={imageUrls}
        isViewOnly={isViewOnly}
      />
    ),
    [currentUserId, handleReact, handlePin, handleViewHistory, handleDelete, imageUrls, isViewOnly]
  );

  const renderMessage = useCallback(
    (props: any) => {
      const msg = props.currentMessage || {};
      const files = msg.files || [];
      const isMsgVoice = !!(msg.audio || msg.voice || msg.audioUrl || msg.voiceUrl || msg.isVoiceNote || msg.type === 'audio');
// allow empty messages to render

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
    []
  );

  const renderSend = (props: any) => (
    <Send {...props} containerStyle={{ justifyContent: 'center', alignItems: 'center' }}>
      <View
        className="w-10 h-10 items-center justify-center rounded-full"
        style={{ backgroundColor: '#005C4B', marginRight: 5, marginBottom: 5 }}
      >
        <Icon name="send" size={18} color="white" />
      </View>
    </Send>
  );

  const renderActions = () => (
    <TouchableOpacity className="ml-2 mb-2 items-center justify-center h-10 w-10">
      <Icon name="add" size={28} color={isDark ? '#fff' : '#007AFF'} />
    </TouchableOpacity>
  );

  const handleInputTextChanged = useCallback(
    (text: string) => {
      composerTextRef.current = text;
      if (chatId) ChatService.emitTyping(chatId, text.length > 0);

      const lastAtIdx = text.lastIndexOf('@');
      if (lastAtIdx !== -1 && (lastAtIdx === 0 || text[lastAtIdx - 1] === ' ')) {
        const query = text.substring(lastAtIdx + 1).split(/\s/)[0];
        setMentionQuery(query);
        setShowMentions(true);
        const filtered = participants.filter((p) => {
          if (currentUserId && String(p._id || p.id || p) === String(currentUserId)) return false;
          const name = `${p.firstName || p.name || ''} ${p.lastName || ''}`.toLowerCase();
          return name.includes(query.toLowerCase());
        });
        setFilteredParticipants(filtered);
      } else {
        setShowMentions(false);
        setMentionQuery(null);
      }
    },
    [chatId, participants, currentUserId]
  );

  const renderInputToolbar = useCallback(
    (props: any) => (
      <View style={{ backgroundColor: isDark ? '#0B141A' : '#F0F2F5' }}>
        {showMentions && filteredParticipants.length > 0 && (
          <View style={{ position: 'absolute', bottom: '100%', width: '100%', zIndex: 1000 }}>
            <MentionSuggestions
              participants={filteredParticipants}
              onSelect={(u: any) => {
                const currentText = composerTextRef.current;
                const lastAtIdx = currentText.lastIndexOf('@');
                const name = `${u.firstName || u.name || 'User'}_${u.lastName || ''}`.replace(
                  /\s/g,
                  ''
                );
                const newText = currentText.substring(0, lastAtIdx) + `@${name} `;
                props.onTextChanged(newText);
                composerTextRef.current = newText;
                setShowMentions(false);
              }}
              colors={colors}
              isDark={isDark}
            />
          </View>
        )}
        <ChatReplyBar replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
        <ChatEditBar editingMessage={editingMessage} onCancel={() => setEditingMessage(null)} />
        {!isViewOnly && (
          <InputToolbar
            {...props}
            containerStyle={{
              backgroundColor: isDark ? '#1F2C34' : '#fff',
              marginHorizontal: 8,
              marginBottom: 8,
              borderRadius: 24,
              borderTopWidth: 0,
              paddingRight: 10,
              elevation: 2,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
            }}
          />
        )}
      </View>
    ),
    [isDark, showMentions, filteredParticipants, replyingTo, editingMessage, colors, isViewOnly]
  );

  const renderFooter = () => {
    if (!typingUsers.length) return null;
    return (
      <View className="px-5 pb-2 bg-black/10">
        <Text
          className="text-[10px] italic font-bold"
          style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}
        >
          {typingUsers.map((u) => u.name).join(', ')} typing...
        </Text>
      </View>
    );
  };

  return (
    <ModalContainer>
      <ModalHeader
        title="Chat"
        subtitle={`Ops · Lead: ${lead.leadId || lead._id}`}
        onClose={onClose}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: wallpaperColor }}>
          <View className="bg-white/10 dark:bg-black/20 p-8 rounded-3xl items-center shadow-xl">
            <ActivityIndicator size="large" color="#00A884" />
            <Text 
              className="mt-4 text-[13px] font-bold tracking-widest uppercase opacity-60"
              style={{ color: isDark ? '#fff' : '#000' }}
            >
              Loading History...
            </Text>
          </View>
        </View>
      ) : (
        <View className="flex-1 overflow-hidden" style={{ backgroundColor: wallpaperColor }}>
          <GiftedChat
            key={chatId || 'loading'}
            messages={messages}
            onSend={onSend}
            user={{ _id: currentUserId, name: user?.firstName || 'Me' }}
            inverted={true}
            {...({
              listProps: {
                extraData: { imageUrls, messages },
                contentContainerStyle: { paddingHorizontal: 16, paddingBottom: 20 },
              },
              onInputTextChanged: handleInputTextChanged,
              renderBubble,
              renderMessage,
              renderSend,
              renderActions,
              renderInputToolbar,
              renderChatFooter: renderFooter,
              loadEarlier: hasMore,
              onLoadEarlier: handleLoadEarlier,
              isLoadingEarlier: loadingMore,
              placeholder: 'Type a message...',
              alwaysShowSend: true,
              scrollToBottom: true,
              infiniteScroll: true,
              renderComposer: (composerProps: any) => (
                <Composer
                  {...composerProps}
                  textInputProps={{
                    ...composerProps.textInputProps,
                    accessibilityLabel: 'ChatInput',
                  }}
                  textInputStyle={{
                    color: isDark ? '#fff' : '#000',
                    fontSize: 15,
                    marginTop: 10,
                  }}
                />
              ),
              scrollToBottomStyle: { backgroundColor: '#005C4B', borderRadius: 30, bottom: 85 },
              scrollToBottomComponent: () => <Icon name="chevron-down" size={20} color="white" />,
            } as any)}
          />
          <EditHistoryModal
            visible={historyModalVisible}
            onClose={() => setHistoryModalVisible(false)}
            history={historyData}
            isDark={isDark}
            colors={colors}
          />
        </View>
      )}
    </ModalContainer>
  );
}
