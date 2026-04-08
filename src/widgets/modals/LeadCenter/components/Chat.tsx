import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { GiftedChat, IMessage, Send, InputToolbar } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../../theme/ThemeProvider';
import { useAuth } from '../../../../hooks/useAuth';
import ChatService from '../../../../services/api/ChatService';
import { ModalContainer, ModalHeader } from './SharedElements';
import { ChatReplyBar, ChatEditBar } from './ChatBars';
import { ChatMessageBubble } from './ChatMessageBubble';

interface Props {
  visible: boolean;
  onClose: () => void;
  lead: any;
}

// Map raw API/socket message → GiftedChat IMessage + extra fields
const toGifted = (msg: any): IMessage & any => ({
  _id: msg._id || msg.id,
  text: msg.message || '',
  createdAt: new Date(msg.createdAt),
  user: {
    _id: msg.senderId || msg.sender?._id || 'ghost',
    name:
      msg.senderDetails?.name ||
      [msg.senderDetails?.firstName, msg.senderDetails?.lastName].filter(Boolean).join(' ') ||
      'User',
    avatar: msg.senderDetails?.avatarUrl || undefined,
  },
  sent: true,
  received: !!msg.seenBy?.length,
  // Preserve extra web-app fields
  reactions: msg.reactions || [],
  replyTo: msg.replyTo,
  replyToDetails: msg.replyToDetails,
  isEdited: !!msg.oldMessage,
  isPinned: msg.isPinned || false,
  tempId: msg.tempId,
});

export default function Chat({ onClose, lead }: Props) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const currentUserId = user?._id || user?.id || 'ghost';

  const [messages, setMessages] = useState<(IMessage & any)[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [limit, setLimit] = useState(20);

  const socketRef = useRef<any>(null);
  const typingTimers = useRef<Map<string, any>>(new Map());

  // ── helpers ─────────────────────────────────────────────────────────────────

  const patchMessages = (id: string, patch: Partial<any>) =>
    setMessages((prev) =>
      prev.map((m) => (m._id === id || (m as any).id === id ? { ...m, ...patch } : m))
    );

  const updateReactions = useCallback((messageId: string, reactions: any[]) => {
    patchMessages(messageId, { reactions });
  }, []);

  const loadMessages = useCallback(async (id: string, lim: number) => {
    try {
      const raw = await ChatService.getMessages(id, lim);
      setHasMore(raw.length >= lim);
      setMessages(raw.map(toGifted).reverse());
    } catch (e) {
      console.error('Load messages:', e);
    }
  }, []);

  // ── socket setup ─────────────────────────────────────────────────────────────

  const attachSocketListeners = useCallback(
    (socket: any, id: string) => {
      // New message — with optimistic dedup (web parity)
      socket.on('new-message', (data: any) => {
        const msg = data.message || data;
        const msgId = msg._id || msg.id;

        // Immediately mark seen
        ChatService.markSeen(id, [msgId]);

        setMessages((prev) => {
          // Replace optimistic message if we sent it
          const optIdx = prev.findIndex(
            (m) =>
              (m.tempId || !m._id) &&
              (m.text || '').trim() === (msg.message || '').trim() &&
              m.user._id === currentUserId
          );
          if (optIdx !== -1) {
            const next = [...prev];
            next[optIdx] = toGifted(msg);
            return next;
          }
          // Dedup
          if (prev.some((m) => m._id === msgId)) return prev;
          return GiftedChat.append(prev, [toGifted(msg)]);
        });
      });

      // Seen receipt (web parity)
      socket.on('message-seen', ({ messageId, seenBy }: any) => {
        patchMessages(messageId, { seenBy, received: true });
      });

      // Typing indicator with 3-second auto-clear (web parity)
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

      // Reactions (web parity)
      socket.on('reaction-added', ({ messageId, reactions }: any) =>
        updateReactions(messageId, reactions)
      );
      socket.on('reaction-removed', ({ messageId, reactions }: any) =>
        updateReactions(messageId, reactions)
      );

      // Edit (web parity)
      socket.on('message-edited', ({ messageId, message: upd, oldMessage }: any) => {
        patchMessages(messageId, { ...upd, oldMessage, isEdited: true });
      });

      // Reply count (web parity)
      socket.on('reply-count-updated', ({ messageId, replyCount }: any) => {
        patchMessages(messageId, { replyCount });
      });

      // Pin / unpin (web parity)
      socket.on('message-pinned', (data: any) => {
        const mId = (data.messageId || data.id || data.message?._id)?.toString();
        if (mId) patchMessages(mId, { isPinned: true });
      });
      socket.on('message-unpinned', (data: any) => {
        const mId = (data.messageId || data.id || data.message?._id)?.toString();
        if (mId) patchMessages(mId, { isPinned: false });
      });
    },
    [currentUserId, updateReactions]
  );

  // ── init ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const chat = await ChatService.getChatByLeadId(lead._id);
        const id = chat?.id || chat?._id;
        if (!id || !mounted) return;
        setChatId(id);
        await loadMessages(id, 20);
        const token = await AsyncStorage.getItem('accessToken');
        if (token && mounted) {
          const socket = ChatService.connect(token, id);
          socketRef.current = socket;
          attachSocketListeners(socket, id);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    init();
    return () => {
      mounted = false;
      ChatService.disconnect();
      typingTimers.current.forEach(clearTimeout);
    };
  }, [lead._id]);

  // ── actions ───────────────────────────────────────────────────────────────────

  const onSend = useCallback(
    (newMsgs: IMessage[] = []) => {
      if (!chatId) return;
      const raw = newMsgs[0];
      const tempId = Date.now().toString();
      const optimistic: IMessage & any = {
        ...raw,
        _id: tempId,
        tempId,
        sent: false,
        replyTo: replyingTo?._id,
        replyToDetails: replyingTo,
      };
      setMessages((prev) => GiftedChat.append(prev, [optimistic]));

      if (editingMessage) {
        ChatService.editMessage(editingMessage._id, raw.text);
        setEditingMessage(null);
      } else {
        ChatService.sendMessage({
          chatId,
          message: raw.text,
          replyTo: replyingTo?._id,
        });
      }
      setReplyingTo(null);
      ChatService.emitTyping(chatId, false);
    },
    [chatId, replyingTo, editingMessage]
  );

  const handleLoadEarlier = async () => {
    if (loadingMore || !hasMore || !chatId) return;
    setLoadingMore(true);
    const newLimit = limit + 20;
    setLimit(newLimit);
    await loadMessages(chatId, newLimit);
    setLoadingMore(false);
  };

  const handleReact = (msg: any, emoji: string) => {
    const existing = msg.reactions?.find((r: any) => r.emoji === emoji);
    const alreadyReacted = existing?.users?.some((u: any) => u.userId === currentUserId);
    if (alreadyReacted) {
      ChatService.removeReaction(msg._id, emoji);
    } else {
      ChatService.addReaction(msg._id, emoji);
    }
  };

  // ── renderers ──────────────────────────────────────────────────────────────────

  const renderBubble = (props: any) => (
    <ChatMessageBubble
      bubbleProps={props}
      currentUserId={currentUserId}
      onReply={setReplyingTo}
      onEdit={setEditingMessage}
      onReact={handleReact}
    />
  );

  const renderSend = (props: any) => (
    <Send {...props}>
      <View
        className="mr-3 mb-1.5 w-10 h-10 items-center justify-center rounded-full"
        style={{ backgroundColor: '#007AFF' }}
      >
        <Icon name="arrow-up" size={18} color="white" />
      </View>
    </Send>
  );

  const renderInputToolbar = (props: any) => (
    <View>
      <ChatReplyBar replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />
      <ChatEditBar editingMessage={editingMessage} onCancel={() => setEditingMessage(null)} />
      <InputToolbar
        {...props}
        containerStyle={{
          backgroundColor: isDark ? '#1A1A1A' : '#fff',
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      />
    </View>
  );

  const renderFooter = () => {
    if (!typingUsers.length) return null;
    return (
      <View className="px-5 pb-2">
        <Text className="text-[10px] font-bold opacity-40" style={{ color: colors.textSecondary }}>
          {typingUsers.map((u) => u.name).join(', ')} typing...
        </Text>
      </View>
    );
  };

  // ── render ─────────────────────────────────────────────────────────────────────

  return (
    <ModalContainer>
      <ModalHeader
        title="Chat"
        subtitle={`Ops · Lead: ${lead.leadId || lead._id}`}
        onClose={onClose}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary.main} />
          <Text
            className="mt-4 text-[10px] font-black uppercase tracking-widest opacity-40"
            style={{ color: colors.text }}
          >
            Securing Link...
          </Text>
        </View>
      ) : (
        <View className="flex-1">
          <GiftedChat
            {...({
              messages,
              onSend,
              onInputTextChanged: (text: string) =>
                chatId && ChatService.emitTyping(chatId, text.length > 0),
              user: { _id: currentUserId, name: user?.firstName || 'Me' },
              renderBubble,
              renderSend,
              renderInputToolbar,
              renderChatFooter: renderFooter,
              loadEarlier: hasMore,
              onLoadEarlier: handleLoadEarlier,
              isLoadingEarlier: loadingMore,
              placeholder: 'Type a message...',
              alwaysShowSend: true,
              scrollToBottom: true,
              scrollToBottomStyle: { backgroundColor: '#007AFF', borderRadius: 30 },
              scrollToBottomComponent: () => (
                <Icon name="chevron-down" size={20} color="white" style={{ margin: 5 }} />
              ),
            } as any)}
          />
        </View>
      )}
    </ModalContainer>
  );
}
