import api from './index';
import SocketManager from '../SocketManager';
import RNFS from 'react-native-fs';
import { Platform, Alert } from 'react-native';
import { readChatId } from '../../utils/chat-response';
import { isHttpStatus } from '../../utils/network-error';

const CHAT_FALLBACK_BUCKET = 'np-revdsm-staging';

type FileRef = { filePath: string; bucketName?: string };

class ChatService {
  private urlCache: Record<string, { url: string; expiresAt: number }> = {};
  private CACHE_DURATION = 55 * 60 * 1000; // 55 minutes

  // ─── REST ───────────────────────────────────────────────────────────────────

  /**
   * The lead's thread id, creating the thread if the server says there isn't one.
   *
   * ⚠️ **404 is a normal answer here, not an error** — it is what the web app keys off too
   * (`GET /chat/v1/lead/{id}` → 404 → `POST /chat/v1/create`). A thread is opened by the
   * start-appointment flow; any lead where that never ran — created offline, imported, or
   * started before chat existed — has no thread until someone asks for one.
   *
   * ⚠️ The status MUST come from `httpStatusOf`. This used to read `err.response?.status`, but
   * `normalizeApiError` rejects with a PLAIN OBJECT that has no `.response`, so the comparison was
   * `undefined === 404` and the fallback below never ran once. The visible symptom was a chat
   * screen that opened empty and could not be used, on exactly those leads.
   */
  async getChatByLeadId(leadId: string): Promise<string | null> {
    try {
      const res = await api.get<any>(`/chat/v1/lead/${leadId}`);
      const existing = readChatId(res.data);
      // A 200 with no id in it means the same thing as a 404: there is no thread yet.
      return existing || (await this.createChatForLead(leadId).catch(() => null));
    } catch (err: any) {
      if (isHttpStatus(err, 404)) {
        // ⚠️ Never let a failed create throw out of here. Every caller treats this as "open the
        // chat", and a rejection would take down the screen rather than degrade it.
        return await this.createChatForLead(leadId).catch(() => null);
      }
      return null;
    }
  }

  /**
   * Opens the lead's thread. Returns its id, or null if the server answered without one.
   *
   * Safe to call more than once: the backend answers an existing thread rather than duplicating
   * it, which is what lets `getChatByLeadId` fall back to this unconditionally.
   */
  async createChatForLead(leadId: string): Promise<string | null> {
    const res = await api.post<any>('/chat/v1/create', { leadId });
    return readChatId(res.data);
  }

  async getMessages(chatId: string, limit = 20): Promise<any[]> {
    const res = await api.get<any>(`/chat/v1/${chatId}/messages`, {
      params: { limit },
    });
    const messages = res.data?.data?.messages || [];
    return messages.map((m: any) => this.normalizeMessage(m));
  }

  async getChatDetails(chatId: string): Promise<any> {
    const res = await api.get<any>(`/chat/v1/${chatId}`);
    return res.data?.data?.chat || res.data?.data;
  }

  async getSecureFileUrls(
    refs: Array<string | FileRef>
  ): Promise<Record<string, string>> {
    const now = Date.now();
    const links: Record<string, string> = {};
    const toFetch: FileRef[] = [];

    const seen = new Set<string>();
    refs.forEach((r) => {
      const ref: FileRef = typeof r === 'string' ? { filePath: r } : r;
      if (!ref.filePath || seen.has(ref.filePath)) return;
      seen.add(ref.filePath);
      const cached = this.urlCache[ref.filePath];
      if (cached && cached.expiresAt > now) {
        links[ref.filePath] = cached.url;
      } else {
        toFetch.push(ref);
      }
    });

    if (toFetch.length === 0) return links;

    const payload = {
      filePaths: toFetch.map((r) => ({
        bucketName: r.bucketName || CHAT_FALLBACK_BUCKET,
        filePath: r.filePath,
      })),
    };

    try {
      const res = await api.post<any>('url/v1/secure/multiple', payload);
      const rawData = res.data?.data || res.data;

      if (Array.isArray(rawData)) {
        rawData.forEach((item: any, idx: number) => {
          const val = item?.secureUrl || item?.url;
          if (!val) return;
          const key = item?.filePath || item?.path || toFetch[idx]?.filePath;
          if (key) {
            links[key] = val;
            this.urlCache[key] = { url: val, expiresAt: now + this.CACHE_DURATION };
          }
        });
      } else if (rawData && typeof rawData === 'object') {
        Object.entries(rawData).forEach(([k, v]) => {
          if (typeof v === 'string') {
            links[k] = v;
            this.urlCache[k] = { url: v, expiresAt: now + this.CACHE_DURATION };
          }
        });
      }
    } catch (e) {
      console.error('[ChatService] Failed to fetch secure URLs:', e);
    }
    return links;
  }

  async getSecureLinks(
    refs: FileRef[]
  ): Promise<Array<{ secureUrl?: string; url?: string } | null>> {
    if (!refs?.length) return [];
    const payload = {
      filePaths: refs.map((r) => ({
        bucketName: r.bucketName || CHAT_FALLBACK_BUCKET,
        filePath: r.filePath,
      })),
    };
    try {
      const res = await api.post<any>('url/v1/secure/multiple', payload);
      const rawData = res.data?.data || res.data;
      return Array.isArray(rawData) ? rawData : [];
    } catch (e) {
      console.error('[ChatService] getSecureLinks failed:', e);
      return [];
    }
  }

  extractFilePaths(messages: any[]): string[] {
    const paths: string[] = [];
    messages.forEach((m) => {
      const files = m.files || m.messageFiles || [];
      files.forEach((f: any) => {
        if (f.filePath || f.path) paths.push(f.filePath || f.path);
        else if (f.url && !f.url.startsWith('http')) paths.push(f.url);
        if (f.imageUrl) paths.push(f.imageUrl);
        if (f.s3_path) paths.push(f.s3_path);
        if (f.voiceUrl) paths.push(f.voiceUrl);
        if (f.mediaUrl) paths.push(f.mediaUrl);
        if (f.thumbnailUrl) paths.push(f.thumbnailUrl);
      });
      if (m.audio) paths.push(m.audio);
      if (m.voice) paths.push(m.voice);
      if (m.voiceUrl) paths.push(m.voiceUrl);
      if (m.audioUrl) paths.push(m.audioUrl);
      if (m.image) paths.push(m.image);
      if (m.video) paths.push(m.video);
      if (m.imageUrl) paths.push(m.imageUrl);
      if (m.s3_path) paths.push(m.s3_path);
      if (m.voiceUrl) paths.push(m.voiceUrl);
      if (m.mediaUrl) paths.push(m.mediaUrl);
      const isMsgVoice =
        m.isVoiceNote === true || m.messageType === 'voice' || m.contentType === 'audio';
      if (isMsgVoice && m.body && typeof m.body === 'string' && !m.body.includes(' ')) {
        paths.push(m.body);
      }
    });
    return paths
      .filter(
        (p) =>
          typeof p === 'string' && p.length > 0 && !p.startsWith('data:') && !p.startsWith('http')
      )
      .filter(Boolean);
  }

  extractFileRefs(messages: any[]): FileRef[] {
    const refs: FileRef[] = [];
    const push = (p: any, bucketName?: string) => {
      if (typeof p === 'string' && p.length > 0 && !p.startsWith('data:') && !p.startsWith('http')) {
        refs.push({ filePath: p, bucketName });
      }
    };
    messages.forEach((m) => {
      const files = m.files || m.messageFiles || [];
      files.forEach((f: any) => {
        const bn = f.bucketName || undefined;
        if (f.filePath || f.path) push(f.filePath || f.path, bn);
        else if (f.url && !f.url.startsWith('http')) push(f.url, bn);
        if (f.imageUrl) push(f.imageUrl, bn);
        if (f.s3_path) push(f.s3_path, bn);
        if (f.voiceUrl) push(f.voiceUrl, bn);
        if (f.mediaUrl) push(f.mediaUrl, bn);
        if (f.thumbnailUrl) push(f.thumbnailUrl, bn);
      });
      if (m.audio) push(m.audio);
      if (m.voice) push(m.voice);
      if (m.voiceUrl) push(m.voiceUrl);
      if (m.audioUrl) push(m.audioUrl);
      if (m.image) push(m.image);
      if (m.video) push(m.video);
      if (m.imageUrl) push(m.imageUrl);
      if (m.s3_path) push(m.s3_path);
      if (m.mediaUrl) push(m.mediaUrl);
      const isMsgVoice =
        m.isVoiceNote === true || m.messageType === 'voice' || m.contentType === 'audio';
      if (isMsgVoice && m.body && typeof m.body === 'string' && !m.body.includes(' ')) {
        push(m.body);
      }
    });
    return refs;
  }

  normalizeFileSize(file: any): number {
    const size = file.size || file.fileSize || file.file_size;
    if (size === undefined || size === null) return 0;
    const normalizedSize = Number(size);
    return isNaN(normalizedSize) ? 0 : normalizedSize;
  }

  normalizeMessage(raw: any): any {
    let m = raw || {};
    if (raw?.data && typeof raw.data === 'object') {
      m = raw.data.message || raw.data;
    } else if (raw?.chatMessage && typeof raw.chatMessage === 'object') {
      m = raw.chatMessage;
    } else if (raw?.message && typeof raw.message === 'object') {
      m = raw.message;
    }

    console.log('[Socket] Normalizing payload ID:', m._id || m.id || 'N/A');
    if (!m._id && !m.id && m !== raw) {
      console.warn('[Socket] Message payload missing ID after extraction, falling back to raw:', raw);
      m = raw;
    }

    const sender = m.senderDetails || m.user || m.sender || {};
    const senderId = String(m.senderId || sender._id || sender.id || 'ghost');
    const firstName = sender.firstName || '';
    const lastName = sender.lastName || '';
    const fullName = sender.fullName || `${firstName} ${lastName}`.trim() || 'User';

    const result = {
      ...m,
      _id: (m._id || m.id || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`).toString(),
      id: (m.id || m._id || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`).toString(),
      text: (() => {
        if (!m) return null;
        if (m.messageType === 'voice' || m.contentType === 'audio') {
          console.log('[ChatService] Normalizing Voice Note Raw Payload:', JSON.stringify(m, null, 2));
        }
        const raw = m.text || m.message || m.content || m.body || '';
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') return raw.body || raw.message || raw.text || '';
        return raw ? String(raw) : '';
      })(),
      createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
      user: {
        _id: senderId,
        name: fullName,
        avatar: (() => {
          const pic = sender.profilePicture || sender.image;
          if (!pic || typeof pic !== 'object') return pic || undefined;
          return undefined;
        })(),
      },
      files: (m.files || m.messageFiles || []).map((f: any) => ({
        ...f,
        id: f._id || f.id,
        name: f.fileName || f.originalname || f.original_name || f.name || f.display_name || f.filePath?.split('/').pop() || 'File',
        type: f.fileType || f.mimeType || f.type || f.contentType || 'application/octet-stream',
        mimeType: f.mimeType || f.fileType || f.type || 'application/octet-stream',
        size: this.normalizeFileSize(f),
        url: f.url || f.path || f.s3url || f.preview || undefined,
        filePath: f.filePath || f.path || undefined,
        bucketName: f.bucketName || undefined,
      })),
      reactions: m.reactions || [],
      // Backend may serialise the flag under any of these names; accept all so a rename does not silently drop pins.
      isPinned: !!(m.isPinned || m.pinned || m.is_pinned || m.pinnedMessage),
      isEdited: m.isEdited || false,
      editHistory: m.editHistory || [],
      received: !!m.seenBy?.length,
      sent: true,
      replyTo: m.replyTo || null,
      replyToDetails: (() => {
        const rd = m.replyToDetails;
        if (!rd) return null;
        const rdSender = rd.senderDetails || {};
        return {
          _id: rd._id || rd.id,
          text: rd.message || rd.text || '',
          createdAt: rd.createdAt ? new Date(rd.createdAt) : undefined,
          files: rd.files || [],
          user: {
            _id: rdSender._id || rdSender.id || rd.senderId,
            name: rdSender.fullName || `${rdSender.firstName || ''} ${rdSender.lastName || ''}`.trim() || 'User',
          },
          authorName: rdSender.fullName || `${rdSender.firstName || ''} ${rdSender.lastName || ''}`.trim() || 'User',
        };
      })(),
      image: (() => {
        if (m.image) return m.image;
        if (m.imageUrl) return m.imageUrl;
        if (m.contentType === 'image' && typeof m.content === 'string') return m.content;
        const files = m.files || m.messageFiles || [];
        const imgFile = files.find(
          (f: any) =>
            (f.fileType || f.mimeType || f.type || '').startsWith('image') ||
            f.imageUrl
        );
        return imgFile?.imageUrl || imgFile?.path || imgFile?.url || undefined;
      })(),
      video: (() => {
        if (m.video) return m.video;
        if (m.videoUrl) return m.videoUrl;
        if (m.contentType === 'video' && typeof m.content === 'string') return m.content;
        const files = m.files || m.messageFiles || [];
        const vidFile = files.find(
          (f: any) =>
            (f.fileType || f.mimeType || f.type || '').startsWith('video') ||
            f.videoUrl
        );
        return vidFile?.videoUrl || vidFile?.path || vidFile?.url || undefined;
      })(),
      audio: (() => {
        if (m.audio) return m.audio;
        if (m.audioUrl) return m.audioUrl;
        if (m.voice) return m.voice;
        if (m.voiceUrl) return m.voiceUrl;
        if (m.mediaUrl) return m.mediaUrl;
        if ((m.messageType === 'voice' || m.contentType === 'audio') && typeof m.content === 'string') return m.content;
        const files = m.files || m.messageFiles || m.attachments || [];
        const audFile = files.find(
          (f: any) =>
            (f.fileType || f.mimeType || f.type || '').startsWith('audio') ||
            f.audioUrl || f.voiceUrl || (f.name || f.fileName || '').endsWith('.m4a')
        );
        return audFile?.audioUrl || audFile?.voiceUrl || audFile?.mediaUrl || audFile?.path || audFile?.url || undefined;
      })(),
      isVoiceNote:
        m.isVoiceNote || m.messageType === 'voice' || m.contentType === 'audio' ||
        !!m.voiceUrl || !!m.audioUrl || !!m.audio || !!m.voice || false,
    };

    const type = result.image
      ? 'IMAGE'
      : result.video
      ? 'VIDEO'
      : result.audio
      ? 'AUDIO'
      : 'TEXT';
    console.log(`[Socket] Message Normalized ✓ [${type}]`, {
      id: result._id,
      text: result.text?.substring(0, 20),
      hasImage: !!result.image,
      hasVideo: !!result.video,
      hasAudio: !!result.audio,
    });

    return result;
  }

  async sendFileMessage(chatId: string, file: any, message = '', replyTo?: string, isChannel = false): Promise<any> {
    let resolvedUri = file?.uri ?? '';

    if (Platform.OS === 'android' && resolvedUri.startsWith('content://')) {
      try {
        const ext = file.name?.split('.').pop() || 'file';
        const dest = `${RNFS.CachesDirectoryPath}/upload_${Date.now()}.${ext}`;
        await RNFS.copyFile(resolvedUri, dest);
        resolvedUri = dest;
      } catch (e) {
        console.warn('[sendFileMessage] Android content copy failed, using original URI:', e);
      }
    }

    if (resolvedUri && !resolvedUri.startsWith('file://') && !resolvedUri.startsWith('content://') && !resolvedUri.startsWith('http')) {
      resolvedUri = `file://${resolvedUri}`;
    }

    const formData = new FormData();
    formData.append('message', message || ' ');
    if (replyTo) formData.append('replyTo', replyTo);
    formData.append('files', {
      uri: resolvedUri,
      name: file.name || `file_${Date.now()}`,
      type: file.type || 'application/octet-stream',
    } as any);

    if (isChannel) return this.postChannelFormData(chatId, formData);
    const res = await api.post<any>(`/chat/v1/${chatId}/messages`, formData);
    return res?.data?.data?.message || res?.data?.message || res?.data || null;
  }

  async sendFilesMessage(
    chatId: string,
    files: Array<{ uri?: string; name?: string; fileName?: string; type?: string }>,
    message = '',
    replyTo?: string,
    isChannel = false
  ): Promise<any> {
    const formData = new FormData();
    formData.append('message', message || ' ');
    if (replyTo) formData.append('replyTo', replyTo);

    for (const file of files) {
      let resolvedUri = file?.uri ?? '';
      const name = file.name || file.fileName || `file_${Date.now()}`;

      if (Platform.OS === 'android' && resolvedUri.startsWith('content://')) {
        try {
          const ext = name.split('.').pop() || 'file';
          const dest = `${RNFS.CachesDirectoryPath}/upload_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}.${ext}`;
          await RNFS.copyFile(resolvedUri, dest);
          resolvedUri = dest;
        } catch (e) {
          console.warn('[sendFilesMessage] Android content copy failed, using original URI:', e);
        }
      }

      if (
        resolvedUri &&
        !resolvedUri.startsWith('file://') &&
        !resolvedUri.startsWith('content://') &&
        !resolvedUri.startsWith('http')
      ) {
        resolvedUri = `file://${resolvedUri}`;
      }

      formData.append('files', {
        uri: resolvedUri,
        name,
        type: file.type || 'application/octet-stream',
      } as any);
    }

    if (isChannel) return this.postChannelFormData(chatId, formData);
    const res = await api.post<any>(`/chat/v1/${chatId}/messages`, formData);
    return res?.data?.data?.message || res?.data?.message || res?.data || null;
  }


  async sendAppointmentPhotos(
    chatId: string,
    files: Array<{
      _id?: string;
      bucketName?: string;
      filePath: string;
      category?: string;
      subcategory?: string;
      fileName?: string;
      fileType?: string;
    }>,
    message = ' ',
    replyTo?: string,
    isChannel = false
  ): Promise<any> {
    if (isChannel) return this.sendChannelMessage({ channelId: chatId, message: message || ' ', replyTo, files });
    const payload: any = {
      chatId,
      message: message || ' ',
      type: 'appointment_photo',
      files,
    };
    if (replyTo) payload.replyTo = replyTo;
    const res = await api.post<any>(`/chat/v1/${chatId}/messages`, payload);
    return res?.data?.data?.message || res?.data?.message || res?.data || null;
  }

  async sendMessageREST(payload: {
    chatId: string;
    message: string;
    replyTo?: string;
    isChannel?: boolean;
    taggedUsers?: string[];
  }): Promise<any> {
    if (payload.isChannel) {
      return this.sendChannelMessage({
        channelId: payload.chatId,
        message: payload.message,
        replyTo: payload.replyTo,
        taggedUsers: payload.taggedUsers,
      });
    }
    const res = await api.post(`/chat/v1/${payload.chatId}/messages`, {
      message: payload.message,
      replyTo: payload.replyTo,
    });
    return (res as any).data?.data?.message || (res as any).data;
  }

  connect(token: string, chatId: string, isChannel = false, userId?: string): any {
    const event = isChannel ? 'join-team-channel' : 'join-chat';
    SocketManager.joinRoom(chatId, event, userId);
    return SocketManager.getSocket();
  }

  disconnect(): void {
  }

  sendMessage(payload: { chatId: string; message: string; replyTo?: string }): void {
    SocketManager.emit('send-message', payload);
  }

  deleteMessage(messageId: string, isChannel = false): void {
    if (isChannel) {
      api.delete(`/api/v1/channels/messages/${messageId}`).catch((e: any) => this.alertChannelRefusal(e));
      return;
    }
    SocketManager.emit('delete-message', { messageId });
  }

  getReplies(chatId: string, messageId: string): void {
    SocketManager.emit('get-replies', { messageId, chatId });
  }

  markSeen(chatId: string, messageIds: string[], isChannel = false): void {
    if (isChannel) {
      SocketManager.emit('mark-channel-messages-seen', { channelId: chatId, messageIds });
      return;
    }
    SocketManager.emit('mark-messages-seen', { chatId, messageIds });
  }

  async addParticipant(chatId: string, userId: string): Promise<void> {
    await api.post(`/chat/v1/${chatId}/participants`, { userId });
  }

  getPinnedMessages(chatId: string): void {
    SocketManager.emit('get-pinned-messages', chatId);
  }

  pinMessage(chatId: string, messageId: string): void {
    const payload: any = { messageId, chatId };
    console.log('[ChatService] pin-message:', payload);
    SocketManager.emit('pin-message', payload);
  }

  unpinMessage(chatId: string, messageId: string): void {
    const payload: any = { messageId, chatId };
    console.log('[ChatService] unpin-message:', payload);
    SocketManager.emit('unpin-message', payload);
  }

  addReaction(chatId: string, messageId: string, emoji: string, isChannel = false): void {
    const payload = { messageId, emoji };
    console.log('[ChatService] add-reaction:', payload);
    SocketManager.emit(isChannel ? 'add-channel-reaction' : 'add-reaction', payload);
  }

  removeReaction(chatId: string, messageId: string, emoji: string, isChannel = false): void {
    const payload = { messageId, emoji };
    console.log('[ChatService] remove-reaction:', payload);
    SocketManager.emit(isChannel ? 'remove-channel-reaction' : 'remove-reaction', payload);
  }

  async editMessage(messageId: string, message: string, isChannel = false): Promise<void> {
    const payload = { messageId, message };
    console.log('[ChatService] edit-message:', payload);
    if (isChannel) {
      await SocketManager.emitWithAck('edit-channel-message', payload);
      return;
    }
    SocketManager.emit('edit-message', payload);
  }

  private lastTypingTime = 0;

  emitTyping(chatId: string, isTyping: boolean): void {
    if (!SocketManager.isConnected()) return;
    const now = Date.now();
    if (isTyping && now - this.lastTypingTime < 1000) return;
    this.lastTypingTime = now;
    SocketManager.emit('typing', { chatId, isTyping });
  }

  // ─── Team channels (REVDSM-1313): stored data over HTTP /api/v1/channels, live changes over sockets ──

  private channelsCache: any[] = [];
  private channelsInitialized = false;

  /** The channel currently open in ChatDetail (null when none). Lets the list skip unread bumps for it. */
  openChannelId: string | null = null;
  private openChannelListeners = new Set<(id: string | null) => void>();

  setOpenChannel(id: string | null): void {
    this.openChannelId = id;
    this.openChannelListeners.forEach((fn) => fn(id));
  }

  onOpenChannelChange(fn: (id: string | null) => void): () => void {
    this.openChannelListeners.add(fn);
    return () => {
      this.openChannelListeners.delete(fn);
    };
  }

  /** Machine code of a refusal, whether it came from an HTTP rejection or a socket ack. */
  channelErrorCode(err: any): string | undefined {
    return err?.data?.code ?? err?.response?.data?.data?.code ?? (typeof err?.code === 'string' ? err.code : undefined);
  }

  /** Shows the refusal alerts the channel UI has always shown (HTTP failures; socket ones also arrive as `error`). */
  alertChannelRefusal(err: any): void {
    const refusals = ['MANAGERS_ONLY', 'SLOW_MODE', 'UPLOADS_DISABLED', 'REPLIES_DISABLED', 'EDIT_DISABLED', 'ACK_NOT_REQUIRED'];
    const code = this.channelErrorCode(err);
    if (code && refusals.includes(code) && err?.message) Alert.alert('Not allowed', err.message);
  }

  /** `GET /api/v1/channels/` (the caller's office); `POST /api/v1/channels/initialize` once when it is empty. */
  async loadChannels(): Promise<any[]> {
    const read = (res: any) => res?.data?.data?.channels || [];
    let list = read(await api.get<any>('/api/v1/channels/'));
    if (list.length === 0 && !this.channelsInitialized) {
      this.channelsInitialized = true;
      try {
        list = read(await api.post<any>('/api/v1/channels/initialize'));
      } catch (e) {
        console.warn('[ChatService] channel initialize failed:', e);
      }
    }
    this.channelsCache = list;
    return list;
  }

  getCachedChannel(channelId: string): any | undefined {
    return this.channelsCache.find((c: any) => String(c.id) === String(channelId));
  }

  async getChannel(channelId: string): Promise<any | undefined> {
    return this.getCachedChannel(channelId) || (await this.loadChannels(), this.getCachedChannel(channelId));
  }

  async getChannelParticipants(channelId: string): Promise<any[]> {
    const channel = await this.getChannel(channelId);
    return channel?.participants || [];
  }

  /** One page of history, newest first. Pass the previous `nextBefore` as `before` for older messages. */
  async getChannelMessages(
    channelId: string,
    opts: { limit?: number; before?: string | null } = {}
  ): Promise<{ messages: any[]; hasMore: boolean; nextBefore: string | null }> {
    const params: any = { limit: opts.limit ?? 50 };
    if (opts.before) params.before = opts.before;
    const res = await api.get<any>(`/api/v1/channels/${channelId}/messages`, { params });
    const data = res.data?.data || {};
    return {
      messages: (data.messages || []).map((m: any) => this.normalizeMessage(m)),
      hasMore: !!data.pagination?.has_more,
      nextBefore: data.pagination?.next_before ?? null,
    };
  }

  async getChannelReplies(messageId: string): Promise<any[]> {
    const res = await api.get<any>(`/api/v1/channels/messages/${messageId}/replies`);
    return (res.data?.data?.replies || []).map((m: any) => this.normalizeMessage(m));
  }

  /** Managers: who confirmed a read-ack message. */
  async getChannelAcks(messageId: string): Promise<{ confirmed: any[]; pending: any[] }> {
    const res = await api.get<any>(`/api/v1/channels/messages/${messageId}/acks`);
    const data = res.data?.data || {};
    return { confirmed: data.confirmed || [], pending: data.pending || [] };
  }

  private async postChannelFormData(channelId: string, formData: FormData): Promise<any> {
    try {
      const res = await api.post<any>(`/api/v1/channels/${channelId}/messages`, formData);
      return res?.data?.data?.message || null;
    } catch (e) {
      this.alertChannelRefusal(e);
      throw e;
    }
  }

  /** Text (or already-uploaded files) over the socket, resolved by the server's ack. */
  async sendChannelMessage(payload: {
    channelId: string;
    message: string;
    replyTo?: string;
    taggedUsers?: string[];
    files?: any[];
  }): Promise<any> {
    const res = await SocketManager.emitWithAck('send-channel-message', payload);
    return res?.data?.message || res?.data || null;
  }

  acknowledgeChannelMessage(messageId: string): void {
    SocketManager.emit('acknowledge-channel-message', { messageId });
  }

  /** Flat snake_case payload: { name, icon_emoji, description?, ...settings }. Resolves with the ack. */
  async createChannel(channelData: any): Promise<any> {
    console.log('[ChatService] create-team-channel:', channelData);
    return SocketManager.emitWithAck('create-team-channel', channelData);
  }



  emitChannelTyping(channelId: string, isTyping: boolean): void {
    if (!SocketManager.isConnected()) return;
    const now = Date.now();
    if (isTyping && now - this.lastTypingTime < 1000) return;
    this.lastTypingTime = now;
    SocketManager.emit('channel-typing', { channelId, isTyping });
  }

  async ensureParticipant(leadId: string, userId: string): Promise<string | null> {
    try {
      const chatId = await this.getChatByLeadId(leadId);
      if (!chatId || !userId) return chatId;

      const participants = await this.getLeadParticipants(chatId, leadId);
      const alreadyIn = participants.some((p: any) => {
        const id = typeof p === 'string' ? p : p?._id || p?.id || p?.userId;
        return String(id) === String(userId);
      });
      if (!alreadyIn) await this.addParticipant(chatId, userId);

      return chatId;
    } catch (err) {
      console.warn('[ChatService] Could not confirm chat participation:', err);
      return null;
    }
  }

  async getLeadParticipants(chatId: string, leadId?: string): Promise<any[]> {
    try {
      let res;
      if (leadId) {
        res = await api.get<any>(`/chat/v1/lead/${leadId}`);
      } else {
        res = await api.get<any>(`/chat/v1/${chatId}`);
      }
      const chat = res.data?.data?.chat || res.data?.data || res.data;
      return chat?.participants || [];
    } catch {
      return [];
    }
  }

  getSocket(): any {
    return SocketManager.getSocket();
  }
}

export default new ChatService();
