import { useState, useEffect, useRef, useCallback } from 'react';
import { Vibration } from 'react-native';
import { IMessage } from 'react-native-gifted-chat';
import ChatService from '../services/api/ChatService';
import SocketManager from '../services/SocketManager';

export const useChatSession = (
  initialChatId: string | null,
  leadId: string | undefined,
  isChannel: boolean = false,
  user: any,
  initialParticipants: any[] = []
) => {
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>(initialParticipants);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(SocketManager.isConnected());
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(true);
  const [limit, setLimit] = useState(100);
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [channel, setChannel] = useState<any>(null);
  const typingTimers = useRef<Map<string, any>>(new Map());
  // Team channels page their history: `next_before` of the last page is the cursor for the next older one.
  const nextBeforeRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

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
      const entries: Array<{ id?: string; filePath: string; cleaned: string; bucketName?: string }> = [];
      const seen = new Set<string>();
      const push = (rawFp: any, bucketName?: string, id?: string) => {
        if (typeof rawFp !== 'string' || !rawFp) return;
        if (/^(https?:|data:|file:|content:)/i.test(rawFp)) return;
        if (seen.has(rawFp)) return;
        seen.add(rawFp);
        const cleaned = cleanFilePath(rawFp);
        if ((id && imageUrls[id]) || imageUrls[rawFp] || imageUrls[cleaned]) return;
        entries.push({ id, filePath: rawFp, cleaned, bucketName });
      };
      (newMessages as any[]).forEach((m) => {
        (m.files || m.messageFiles || []).forEach((f: any) => {
          const id = f.id || f._id;
          const bn = f.bucketName;
          push(f.filePath || f.path || (f.url && !String(f.url).startsWith('http') ? f.url : undefined), bn, id);
          push(f.imageUrl, bn, id);
          push(f.s3_path, bn, id);
          push(f.voiceUrl, bn, id);
          push(f.mediaUrl, bn, id);
          push(f.thumbnailUrl, bn, id);
        });
        [m.voice, m.voiceUrl, m.audio, m.audioUrl, m.image, m.imageUrl, m.video, m.s3_path, m.mediaUrl].forEach(
          (v: any) => push(v),
        );
      });
      if (entries.length === 0) return;

      const data = await ChatService.getSecureLinks(
        entries.map((e) => ({ filePath: e.filePath, bucketName: e.bucketName })),
      ).catch(() => [] as any[]);

      console.log(
        `[REVDSM-DIAG chat] requested=${entries.length} sampleKey=${entries[0]?.filePath?.slice(-50)} ` +
          `sampleBucket=${entries[0]?.bucketName} → sampleUrl=${(data[0]?.secureUrl || data[0]?.url || 'EMPTY')?.toString().slice(0, 70)}`,
      );

      const newUrls: Record<string, string> = {};
      entries.forEach((e, i) => {
        const url = data[i]?.secureUrl || data[i]?.url;
        if (!url) return;
        if (e.id) newUrls[e.id] = url;                      // id keying (robust for appointment photos)
        newUrls[e.filePath] = url;                          // raw filePath (display looks up f.filePath)
        if (e.cleaned && e.cleaned !== e.filePath) newUrls[e.cleaned] = url; // cleaned form too
      });
      if (Object.keys(newUrls).length) setImageUrls((prev) => ({ ...prev, ...newUrls }));
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
        const dA = new Date(a.createdAt).getTime();
        const dB = new Date(b.createdAt).getTime();
        return dB - dA;
      });
      setMessages(normalized);
      fetchSecureUrls(normalized);

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

  // Channel history: first page on open, then only socket events (plus older pages on scroll).
  const loadChannelMessages = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const page = await ChatService.getChannelMessages(id, { limit: 50 });
      nextBeforeRef.current = page.nextBefore;
      setHasMore(page.hasMore);
      setMessages(page.messages);
      fetchSecureUrls(page.messages);
    } catch (err) {
      console.error('Load channel messages error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (!isChannel || !chatId || !hasMore || loadingOlderRef.current || !nextBeforeRef.current) return;
    loadingOlderRef.current = true;
    try {
      const page = await ChatService.getChannelMessages(chatId, { limit: 50, before: nextBeforeRef.current });
      nextBeforeRef.current = page.nextBefore;
      setHasMore(page.hasMore);
      setMessages((prev) => {
        const have = new Set(prev.map((m) => String(m._id)));
        return [...prev, ...page.messages.filter((m: any) => !have.has(String(m._id)))];
      });
      fetchSecureUrls(page.messages);
    } catch (err) {
      console.error('Load older channel messages error:', err);
    } finally {
      loadingOlderRef.current = false;
    }
  }, [isChannel, chatId, hasMore]);

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
          if (isChannel) {
            await loadChannelMessages(activeId);
            ChatService.getChannel(activeId)
              .then((chan) => {
                if (chan) setChannel(chan);
              })
              .catch(console.error);
          } else {
            await loadMessages(activeId, limit);
          }
          const fetchAction = isChannel
            ? ChatService.getChannelParticipants(activeId)
            : ChatService.getLeadParticipants(activeId, leadId);
          fetchAction.then(setParticipants).catch(console.error);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [chatId, leadId, isChannel, limit, loadMessages, loadChannelMessages]);

  useEffect(() => {
    // Channels: opening the history (GET /channels/v1/:id/messages) already marks messages seen.
    if (messages.length > 0 && chatId && !isChannel) {
      SocketManager.emit('mark-all-messages-as-read', { chatId, userId: currentUserId });
    }
  }, [messages.length, chatId, isChannel, currentUserId]);

  useEffect(() => {
    if (!chatId) return;

    const joinEvent = isChannel ? 'join-team-channel' : 'join-chat';
    SocketManager.joinRoom(chatId, joinEvent, currentUserId);

    if (isChannel) {
      ChatService.setOpenChannel(chatId);
    } else {
      SocketManager.emit('get-pinned-messages', {
        chatId,
        channelId: chatId,
      });
    }

    // After a reconnect, pull what was missed while offline (latest page only) and merge it in.
    const resyncChannel = () => {
      ChatService.getChannelMessages(chatId, { limit: 50 })
        .then((page) => {
          fetchSecureUrls(page.messages);
          setMessages((prev) => {
            const fresh = new Map(page.messages.map((m: any) => [String(m._id), m]));
            const merged = prev.map((m) => (fresh.has(String(m._id)) ? fresh.get(String(m._id)) : m));
            const have = new Set(prev.map((m) => String(m._id)));
            const added = page.messages.filter((m: any) => !have.has(String(m._id)));
            return [...added, ...merged].sort(
              (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          });
        })
        .catch((e) => console.warn('[useChatSession] resync failed:', e));
    };

    const markAllRead = (msgs: any[]) => {
      const allIds = msgs.map((m: any) => m._id?.toString()).filter(Boolean);
      if (allIds.length === 0) return;
      
      if (isChannel) {
        ChatService.markSeen(chatId, allIds, true);
      } else {
        SocketManager.emit('mark-messages-seen', { chatId, messageIds: allIds });
        SocketManager.emit('mark-all-messages-as-read', { chatId, userId: currentUserId });
      }
    };

    markAllRead(messages);

    const onConnect = () => {
      setIsConnected(true);
      if (isChannel) resyncChannel();
    };
    const onDisconnect = () => setIsConnected(false);
    const unsubConnect = SocketManager.on('connect', onConnect);
    const unsubDisconnect = SocketManager.on('disconnect', onDisconnect);

    const handleNewMessage = (m: any) => {
      console.log('[Socket] handleNewMessage Raw Payload:', JSON.stringify(m, null, 2));
      if (isChannel) {
        // Channel events carry their channel id; ignore other channels' traffic on the user room.
        const evChannel = m?.channelId || m?.message?.chatId;
        if (evChannel && String(evChannel) !== String(chatId)) return;
      }
      const normalized = ChatService.normalizeMessage(m);
      if (normalized.audio || normalized.voice || normalized.isVoiceNote) {
        console.log('[Socket] Incoming Voice Note Detected:', normalized);
      }

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

        const normFiles = (normalized as any).files || [];

        const optimisticIndex = prev.findIndex((msg) => {
          const isPending =
            msg.pending === true ||
            (typeof msg._id === 'string' && msg._id.startsWith('temp_'));
          if (!isPending) return false;

          const msgUserId = String(msg.user?._id || '');
          const normUserId = String(normalized.user?._id || '');
          const sameUser = msgUserId === normUserId;

          if (!sameUser && msgUserId !== 'ghost' && normUserId !== 'ghost') {
            return false;
          }

          const sameText = msg.text === normalized.text && !!msg.text;

          const msgFiles = (msg as any).files || [];
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
            image: localMsg.image || normalized.image,
            video: localMsg.video || normalized.video,
            voice: localMsg.voice || normalized.voice,
            audio: localMsg.audio || normalized.audio,
            files: normalized.files?.map((nf: any, i: number) => {
              const lf: any = localMsg.files?.[i] || {};
              return {
                ...nf,
                url: lf.url || nf.url, // Keep local file:// or content://
                previewUrl: nf.previewUrl || lf.previewUrl,
                isAppointmentPhoto: nf.isAppointmentPhoto ?? lf.isAppointmentPhoto,
              };
            }),
          };
          return updated;
        }

        const isFromMe = String(normalized.user?._id) === String(currentUserId);
        if (!isFromMe && normalized.text && prev.some(m => m.text === normalized.text && (!m.sent || m._id.toString().startsWith('temp_')))) {
          console.warn('[Socket] Possible duplicate detected but matching failed. ID mismatch?', {
            serverUserId: normalized.user?._id,
            localUserId: currentUserId
          });
        }

        return [normalized, ...prev];
      });

      if (isChannel) {
        ChatService.markSeen(chatId, [normalized._id as string], true);
      } else {
        SocketManager.emit('mark-messages-seen', {
          chatId,
          messageIds: [normalized._id],
        });
      }
    };

    const unsubNewMsg = SocketManager.on('new-message', handleNewMessage);
    const unsubNewChanMsg = SocketManager.on('new-channel-message', handleNewMessage);

    const unsubEdited = SocketManager.on('message-edited', (m: any) => {
      const normalized = ChatService.normalizeMessage(m);
      const updater = (prev: any[]) =>
        prev.map((msg) => (msg._id === normalized._id ? normalized : msg));
      setMessages(updater);
      setPinnedMessages(updater);
    });

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

    const unsubDeleted = SocketManager.on('message-deleted', (data: any) => {
      const deletedId = (data.messageId || data.id || data.message?._id || data._id)?.toString();
      setMessages((prev) => prev.filter((msg) => msg._id?.toString() !== deletedId));
      setPinnedMessages((prev) => prev.filter((msg) => (msg as any)._id?.toString() !== deletedId));
    });

    // Pinning is lead-chat only: channels never subscribe to pin events.
    const onLeadOnly = (ev: string, fn: (d: any) => void) => (isChannel ? () => {} : SocketManager.on(ev, fn));

    const unsubPinned = onLeadOnly('message-pinned', (data: any) => {
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

    const unsubUnpinned = onLeadOnly('message-unpinned', (data: any) => {
      Vibration.vibrate(50);
      const msgId = (data.messageId || data.id || data.message?._id || data._id)?.toString();
      console.log('[useChatSession] message-unpinned:', msgId);
      setMessages((prev) =>
        prev.map((m: any) => (m._id?.toString() === msgId ? { ...m, isPinned: false } : m))
      );
      setPinnedMessages((prev) => prev.filter((m: any) => m._id?.toString() !== msgId));
    });

    const unsubPinnedResponse = onLeadOnly('pinned-messages-response', (data: any) => {
      const pins = data?.pinnedMessages || (Array.isArray(data) ? data : []);
      const normalized = pins.map((m: any) => ChatService.normalizeMessage(m));
      fetchSecureUrls(normalized);
      const pinnedIds = new Set(normalized.map((m: any) => m._id));
      setMessages((prev) => prev.map((m) => ({ ...m, isPinned: pinnedIds.has(m._id as string) })));
      setPinnedMessages(normalized);
    });

    const handleMessageSeen = (data: any) => {
      console.log('[Socket] message-seen/channel-message-seen received:', data);
      const { messageId, messageIds, seenBy } = data || {};
      const idsToUpdate = Array.isArray(messageIds)
        ? messageIds.map(String)
        : messageId
          ? [String(messageId)]
          : [];
      if (idsToUpdate.length === 0) return;

      const updater = (prev: any[]) =>
        prev.map((m) =>
          idsToUpdate.includes(String(m._id))
            ? { ...m, seenBy: seenBy || (m as any).seenBy, received: true }
            : m
        );
      setMessages(updater);
    };

    const handleChatRead = (data: any) => {
      console.log('[Socket] chat read event received:', data);
      const { chatId: eventChatId, channelId, userId, seenAt } = data || {};
      const activeRoomId = eventChatId || channelId;
      if (activeRoomId && String(activeRoomId) !== String(chatId)) return;
      if (userId && String(userId) === String(currentUserId)) return; // Skip my own read events

      const dateSeen = seenAt ? new Date(seenAt) : new Date();

      setMessages((prev) =>
        prev.map((m) => {
          const isFromMe = String(m.user?._id) === String(currentUserId);
          if (isFromMe) {
            const hasUser = ((m as any).seenBy || []).some((u: any) => String(u.userId || u.id) === String(userId));
            if (!hasUser) {
              return {
                ...m,
                seenBy: [...((m as any).seenBy || []), { userId, id: userId, seenAt: dateSeen.toISOString() }],
                received: true,
              };
            }
          }
          return m;
        })
      );
    };

    const unsubMsgSeen = SocketManager.on('message-seen', handleMessageSeen);
    const unsubChanMsgSeen = SocketManager.on('channel-message-seen', handleMessageSeen);
    const unsubChanRead = SocketManager.on('channel-read', handleChatRead);
    const unsubLeadRead = SocketManager.on('lead-chat-read', handleChatRead);
    const unsubAllRead = SocketManager.on('mark-as-read-response', handleChatRead);

    const handleTyping = (data: any) => {
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
    };

    const unsubTyping = SocketManager.on('user-typing', handleTyping);
    const unsubChanTyping = SocketManager.on('user-typing-channel', handleTyping);

    return () => {
      // Leave the room but DO NOT disconnect the global socket
      SocketManager.leaveRoom(chatId);
      if (isChannel) ChatService.setOpenChannel(null);

      unsubConnect();
      unsubDisconnect();
      unsubNewMsg();
      unsubNewChanMsg();
      unsubMsgSeen();
      unsubChanMsgSeen();
      unsubChanRead();
      unsubLeadRead();
      unsubAllRead();
      unsubEdited();
      unsubReactAdded();
      unsubReactRemoved();
      unsubDeleted();
      unsubPinned();
      unsubUnpinned();
      unsubPinnedResponse();
      unsubTyping();
      unsubChanTyping();
      typingTimers.current.forEach(clearTimeout);
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
    typingUsers,
    channel,
    loadOlder,
  };
};
