import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Socket } from 'socket.io-client';
import { GiftedChat } from 'react-native-gifted-chat';
import ChatService from '../services/api/ChatService';

export const useChatSession = (
  initialChatId: string | null,
  leadId: string | undefined,
  isChannel: boolean,
  user: any
) => {
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [messages, setMessages] = useState<any[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [limit, setLimit] = useState(20);
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const currentUserId = user?._id || user?.id || 'ghost';

  const patchMessage = useCallback((id: string, patch: any) => {
    setMessages((prev) => prev.map((m) => (m._id === id || m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const loadMessages = useCallback(async (id: string, lim: number) => {
    try {
      const raw = await ChatService.getMessages(id, lim);
      setHasMore(raw.length >= lim);
      const gifted = raw
        .map((m: any) => ({
          ...m, // Keep original fields for bubble detection (files, etc.)
          _id: m._id || m.id,
          text: m.message || m.content || '',
          createdAt: new Date(m.createdAt),
          user: {
            _id: m.senderId || m.sender?._id || 'ghost',
            name: m.senderDetails?.name || 'User',
            avatar: m.senderDetails?.image || undefined,
          },
          sent: true,
          received: !!m.seenBy?.length,
          reactions: m.reactions || [],
          replyTo: m.replyTo,
          replyToDetails: m.replyToDetails,
          isEdited: !!m.oldMessage,
          isPinned: m.isPinned || false,
          tempId: m.tempId,
        }))
        .reverse();
      setMessages(gifted);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      let activeId = chatId;
      if (!activeId && leadId && !isChannel) {
        const chat = await ChatService.getChatByLeadId(leadId);
        activeId = chat?._id || chat?.id;
      }
      if (!activeId || !mounted) {
        setLoading(false);
        return;
      }
      setChatId(activeId);
      await loadMessages(activeId, limit);
      const token = await AsyncStorage.getItem('accessToken');
      if (token && mounted) {
        const socket = ChatService.connect(token, activeId);
        socketRef.current = socket;
        socket.on('connect', () => {
          setLoading(false);
          if (isChannel) {
            socket.emit('join-team-channel', activeId);
            ChatService.getPinnedMessages(activeId as string);
          } else socket.emit('join-chat', activeId);
        });
        socket.on(
          'pinned-messages-response',
          (data) => data.pinnedMessages && setPinnedMessages(data.pinnedMessages)
        );
        socket.on('message-pinned', () => ChatService.getPinnedMessages(activeId as string));
        socket.on('message-unpinned', () => ChatService.getPinnedMessages(activeId as string));
        socket.on(isChannel ? 'new-channel-message' : 'new-message', (data) => {
          const m = data.message || data;
          setMessages((prev) => {
            if (prev.some((p) => p._id === (m._id || m.id))) return prev;
            const normalized = {
              ...m,
              _id: m._id || m.id,
              text: m.message || m.content || '',
              createdAt: new Date(m.createdAt || Date.now()),
              user: {
                _id: m.senderId || m.sender?._id || 'ghost',
                name: m.senderDetails?.name || 'User',
                avatar: m.senderDetails?.image || undefined,
              },
            };
            return GiftedChat.append(prev, [normalized]);
          });
        });
      }
    };
    init();
    return () => {
      mounted = false;
      ChatService.disconnect();
    };
  }, [chatId, leadId, isChannel]);

  return {
    chatId,
    messages,
    setMessages,
    pinnedMessages,
    loading,
    hasMore,
    limit,
    setLimit,
    typingUsers,
    currentUserId,
  };
};
