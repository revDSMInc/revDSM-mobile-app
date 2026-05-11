/**
 * useChatSession — Room-level subscription hook
 *
 * Does NOT own the socket. The socket is managed globally by SocketManager.
 * This hook only:
 *   1. Joins/leaves the specific chat room
 *   2. Subscribes to room events (messages, reactions, pins)
 *   3. Loads messages via REST
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Vibration } from 'react-native';
import { IMessage } from 'react-native-gifted-chat';
import ChatService from '../services/api/ChatService';
import SocketManager from '../services/SocketManager';

export const useChatSession = (
  initialChatId: string | null,
  leadId: string | undefined,
  isChannel: boolean = false,
  user: any
) => {
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(SocketManager.isConnected());
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(true);
  const [limit, setLimit] = useState(30);

  const currentUserId = user?._id || user?.id || 'ghost';

  const cleanFilePath = (filePath: string): string => {
    let p = filePath;
    if (!p) return '';
    p = p.replace(/^(file:\/\/|content:\/\/|data:)/, '');
    const roots = ['chat/', 'leads/', 'files/', 'customer/', 'revdsm/'];
    for (const root of roots) {
      if (p.includes(root)) return p.substring(p.indexOf(root));
    }
    return p.replace(/^\/+/, '');
  };

  const fetchSecureUrls = async (newMessages: IMessage[]) => {
    try {
      const paths = ChatService.extractFilePaths(newMessages).map(cleanFilePath);
      const cleaned = Array.from(new Set(paths)).filter(Boolean);
      if (cleaned.length === 0) return;
      const links = await ChatService.getSecureFileUrls(cleaned).catch(() => ({}));
      setImageUrls((prev) => ({ ...prev, ...links }));
    } catch (error) {
      console.error('Fetch secure URLs error:', error);
    }
  };

  const loadMessages = useCallback(async (id: string, lim: number) => {
    setLoading(true);
    try {
      const raw = await ChatService.getMessages(id, lim);
      setHasMore(raw.length >= lim);
      const normalized = raw.map((m) => ChatService.normalizeMessage(m)).reverse();
      setMessages(normalized);
      fetchSecureUrls(normalized);

      // Pre-populate pinned from REST (before socket responds)
      const initialPinned = normalized.filter((m: any) => m.isPinned === true);
      if (initialPinned.length > 0) {
        setPinnedMessages(initialPinned);
      }
    } catch (err) {
      console.error('Load messages error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Load messages + fetch participants ─────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        let activeId = chatId;
        if (!activeId && leadId && !isChannel) {
          activeId = await ChatService.getChatByLeadId(leadId);
          setChatId(activeId);
        }
        if (activeId) {
          await loadMessages(activeId, limit);
          const fetchAction = isChannel
            ? ChatService.getChannelParticipants(activeId)
            : ChatService.getLeadParticipants(activeId);
          fetchAction.then(setParticipants).catch(console.error);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [chatId, leadId, isChannel, limit, loadMessages]);

  // ─── Room join/leave + socket event subscriptions ───────────────────────────
  useEffect(() => {
    if (!chatId) return;

    // Join the room via the global persistent socket
    const joinEvent = isChannel ? 'join-team-channel' : 'join-chat';
    SocketManager.joinRoom(chatId, joinEvent, currentUserId);

    // Auto-mark ALL currently loaded messages as read the instant user enters the chat
    setMessages((prev) => {
      const allIds = prev.map((m: any) => m._id?.toString()).filter(Boolean);
      if (allIds.length > 0) {
        if (isChannel) {
          SocketManager.emit('mark-channel-message-seen', {
            channelId: chatId,
            messageIds: allIds,
            userId: currentUserId,
          });
        } else {
          SocketManager.emit('mark-message-seen', { chatId, messageIds: allIds });
        }
      }
      return prev; // no mutation — purely a side-effect read
    });

    // Request pinned messages immediately after joining to sync state
    SocketManager.emit(isChannel ? 'get-channel-pinned-messages' : 'get-pinned-messages', {
      chatId,
      channelId: chatId,
    });

    // Track socket connection state
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const unsubConnect = SocketManager.on('connect', onConnect);
    const unsubDisconnect = SocketManager.on('disconnect', onDisconnect);

    // ── New messages ─────────────────────────────────────────────────────────
    const handleNewMessage = (m: any) => {
      const normalized = ChatService.normalizeMessage(m);

      // Always fetch secure URLs for new incoming messages — do this OUTSIDE setState
      // to ensure it always fires reliably regardless of React's batch strategy
      fetchSecureUrls([normalized]);

      setMessages((prev) => {
        if (prev.some((msg) => msg._id === normalized._id)) return prev;

        // Optimized replacement logic to avoid "double message" glitch
        // Matches on sender + text OR sender + media file (by filename, since URL changes local→S3)
        const normFiles = (normalized as any).files || [];

        const optimisticIndex = prev.findIndex((msg) => {
          const isPending =
            !msg.sent || (typeof msg._id === 'string' && msg._id.startsWith('temp_'));
          if (!isPending) return false;

          const sameUser = msg.user?._id === normalized.user?._id;
          if (!sameUser) return false;

          const sameText = msg.text === normalized.text && !!msg.text;

          const msgFiles = (msg as any).files || [];
          // Match by filename (server preserves original filename through S3 upload)
          // Fallback: same user + same file count + sent within 60s window
          const sameFiles =
            msgFiles.length > 0 &&
            normFiles.length > 0 &&
            (msgFiles.some((f: any) =>
              normFiles.some(
                (nf: any) =>
                  (nf.name && nf.name === f.name) ||
                  nf.path === f.path ||
                  nf.url === f.url
              )
            ) ||
              (msgFiles.length === normFiles.length &&
                Math.abs(
                  new Date(normalized.createdAt as any).getTime() -
                    new Date(msg.createdAt as any).getTime()
                ) < 60_000));

          return sameText || sameFiles;
        });

        if (optimisticIndex !== -1) {
          const updated = [...prev];
          updated[optimisticIndex] = normalized;
          return updated;
        }

        return [normalized, ...prev];
      });

      // Mark seen
      if (isChannel) {
        SocketManager.emit('mark-channel-message-seen', {
          channelId: chatId,
          messageIds: [normalized._id],
          userId: currentUserId,
        });
      } else {
        SocketManager.emit('mark-message-seen', {
          chatId,
          messageIds: [normalized._id],
        });
      }
    };

    const unsubNewMsg = SocketManager.on('new-message', handleNewMessage);
    const unsubNewChanMsg = SocketManager.on('new-channel-message', handleNewMessage);

    // ── Edits ────────────────────────────────────────────────────────────────
    const unsubEdited = SocketManager.on('message-edited', (m: any) => {
      const normalized = ChatService.normalizeMessage(m);
      const updater = (prev: any[]) =>
        prev.map((msg) => (msg._id === normalized._id ? normalized : msg));
      setMessages(updater);
      setPinnedMessages(updater);
    });

    // ── Reactions ────────────────────────────────────────────────────────────
    const handleReaction = (m: any) => {
      Vibration.vibrate(50);
      const msgId = (m.messageId || m.id || m.message?._id || m._id)?.toString();
      const reactions = m.reactions || [];
      const updater = (prev: any[]) =>
        prev.map((msg) => (msg._id?.toString() === msgId ? { ...msg, reactions } : msg));
      setMessages(updater);
      setPinnedMessages(updater);
    };

    const unsubReactAdded = SocketManager.on('reaction-added', handleReaction);
    const unsubReactRemoved = SocketManager.on('reaction-removed', handleReaction);

    // ── Delete ───────────────────────────────────────────────────────────────
    const unsubDeleted = SocketManager.on('message-deleted', (data: any) => {
      const deletedId = (data.messageId || data.id || data.message?._id || data._id)?.toString();
      setMessages((prev) => prev.filter((msg) => msg._id?.toString() !== deletedId));
      setPinnedMessages((prev) => prev.filter((msg) => (msg as any)._id?.toString() !== deletedId));
    });

    // ── Pin / Unpin ──────────────────────────────────────────────────────────
    const unsubPinned = SocketManager.on('message-pinned', (data: any) => {
      Vibration.vibrate(50);
      const msgId = (data.messageId || data.id || data.message?._id || data._id)?.toString();
      console.log('[useChatSession] message-pinned:', msgId);

      setMessages((prev) => {
        const updated = prev.map((m: any) =>
          m._id?.toString() === msgId ? { ...m, isPinned: true } : m
        );
        const pinned = updated.find((m: any) => m._id?.toString() === msgId);
        if (pinned) {
          setPinnedMessages((pv: any[]) => {
            const alreadyIn = pv.some((pm: any) => pm._id?.toString() === msgId);
            if (alreadyIn) return pv;
            return [...pv, { ...pinned, isPinned: true }];
          });
        }
        return updated;
      });
    });

    const unsubUnpinned = SocketManager.on('message-unpinned', (data: any) => {
      Vibration.vibrate(50);
      const msgId = (data.messageId || data.id || data.message?._id || data._id)?.toString();
      console.log('[useChatSession] message-unpinned:', msgId);
      setMessages((prev) =>
        prev.map((m: any) => (m._id?.toString() === msgId ? { ...m, isPinned: false } : m))
      );
      setPinnedMessages((prev) => prev.filter((m: any) => m._id?.toString() !== msgId));
    });

    // ── Pinned messages list (response to get-pinned-messages) ───────────────
    const unsubPinnedResponse = SocketManager.on('pinned-messages-response', (data: any) => {
      const pins = data?.pinnedMessages || (Array.isArray(data) ? data : []);
      const normalized = pins.map((m: any) => ChatService.normalizeMessage(m));
      fetchSecureUrls(normalized);
      const pinnedIds = new Set(normalized.map((m: any) => m._id));
      setMessages((prev) => prev.map((m) => ({ ...m, isPinned: pinnedIds.has(m._id as string) })));
      setPinnedMessages(normalized);
    });

    return () => {
      // Leave the room but DO NOT disconnect the global socket
      SocketManager.leaveRoom(chatId);

      // Unsubscribe all event handlers
      unsubConnect();
      unsubDisconnect();
      unsubNewMsg();
      unsubNewChanMsg();
      unsubEdited();
      unsubReactAdded();
      unsubReactRemoved();
      unsubDeleted();
      unsubPinned();
      unsubUnpinned();
      unsubPinnedResponse();
    };
  }, [chatId, isChannel, currentUserId]);

  return {
    chatId,
    messages,
    setMessages,
    pinnedMessages,
    setPinnedMessages,
    participants,
    loading,
    isConnected,
    currentUserId,
    imageUrls,
    hasMore,
    setLimit,
  };
};
