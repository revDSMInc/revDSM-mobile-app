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
      console.log('[useChatSession] Fetched Secure URLs:', JSON.stringify(links, null, 2));
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
      const normalized = raw.map((m) => ChatService.normalizeMessage(m)).sort((a, b) => {
        const dA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const dB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return dB.getTime() - dA.getTime();
      });
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
          SocketManager.emit('mark-channel-as-read', {
            channelId: chatId,
            userId: currentUserId,
          });
          SocketManager.emit('mark-channel-message-seen', {
            channelId: chatId,
            messageIds: allIds,
            userId: currentUserId,
          });
        } else {
          SocketManager.emit('mark-message-seen', { chatId, messageIds: allIds });
          SocketManager.emit('mark-all-messages-as-read', { chatId, userId: currentUserId });
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
      console.log('[Socket] handleNewMessage Raw Payload:', JSON.stringify(m, null, 2));
      const normalized = ChatService.normalizeMessage(m);
      if (normalized.audio || normalized.voice || normalized.isVoiceNote) {
        console.log('[Socket] Incoming Voice Note Detected:', normalized);
      }

      // Delay fetching secure URLs to ensure backend has finished processing the file
      setTimeout(() => {
        fetchSecureUrls([normalized]);
      }, 150);

      setMessages((prev) => {
        const existingIndex = prev.findIndex((msg) => msg._id === normalized._id);
        if (existingIndex !== -1) {
          const existing = prev[existingIndex];
          const hasNewMedia = normalized.image || normalized.video || (normalized as any).files?.length > 0;
          const hasOldMedia = existing?.image || existing?.video || (existing as any).files?.length > 0;

          if (hasNewMedia && !hasOldMedia) {
            console.log('[Socket] Updating existing message with media:', normalized._id);
            const updated = [...prev];
            updated[existingIndex] = { ...existing, ...normalized };
            fetchSecureUrls([normalized]); // Re-fetch URLs for the new media
            return updated;
          }
          return prev;
        }

        // Optimized replacement logic to avoid "double message" glitch
        const normFiles = (normalized as any).files || [];

        const optimisticIndex = prev.findIndex((msg) => {
          const isPending =
            msg.pending === true ||
            (typeof msg._id === 'string' && msg._id.startsWith('temp_'));
          if (!isPending) return false;

          // Use string comparison for IDs to be safe
          const msgUserId = String(msg.user?._id || '');
          const normUserId = String(normalized.user?._id || '');
          const sameUser = msgUserId === normUserId;

          if (!sameUser && msgUserId !== 'ghost' && normUserId !== 'ghost') {
            return false;
          }

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

          if (isPending) {
            console.log(`[Socket] Checking pending msg: ${msg._id} against incoming: ${normalized._id}`);
          }
          return sameText || sameFiles;
        });

        if (optimisticIndex !== -1) {
          console.log('[Socket] Replacing optimistic message:', normalized._id);
          const updated = [...prev];
          const localMsg = updated[optimisticIndex] as any;
          updated[optimisticIndex] = {
            ...normalized,
            user: localMsg.user, // Inherit local "Me" identity
            // Preserve local media URIs to prevent flicker
            image: localMsg.image || normalized.image,
            video: localMsg.video || normalized.video,
            voice: localMsg.voice || normalized.voice,
            audio: localMsg.audio || normalized.audio,
            files: normalized.files?.map((nf: any, i: number) => ({
              ...nf,
              url: localMsg.files?.[i]?.url || nf.url, // Keep local file:// or content://
            })),
          };
          return updated;
        }

        // If it's from "Me" but we didn't find an optimistic message, check ID mismatch
        const isFromMe = String(normalized.user?._id) === String(currentUserId);
        if (!isFromMe && normalized.text && prev.some(m => m.text === normalized.text && (!m.sent || m._id.toString().startsWith('temp_')))) {
           console.warn('[Socket] Possible duplicate detected but matching failed. ID mismatch?', {
             serverUserId: normalized.user?._id,
             localUserId: currentUserId
           });
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
