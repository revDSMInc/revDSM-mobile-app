/**
 * ChatService — REST + socket operations for the chat module.
 *
 * The socket lifecycle is now managed by SocketManager (singleton).
 * ChatService only handles REST calls and wraps SocketManager.emit()
 * for chat-specific events.
 */

import api from './index';
import SocketManager from '../SocketManager';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

// Bucket to sign against when a chat file carries no bucketName of its own.
// Mirrors the web ChatModule, which falls back to 'np-revdsm-staging'. The env
// bucket (mhalt-revdsm) is the WRONG bucket for chat uploads on this backend,
// which is why signed URLs came back empty and images reloaded blank.
const CHAT_FALLBACK_BUCKET = 'np-revdsm-staging';

type FileRef = { filePath: string; bucketName?: string };

class ChatService {
  private urlCache: Record<string, { url: string; expiresAt: number }> = {};
  private CACHE_DURATION = 55 * 60 * 1000; // 55 minutes

  // ─── REST ───────────────────────────────────────────────────────────────────

  async getChatByLeadId(leadId: string): Promise<string | null> {
    try {
      const res = await api.get<any>(`/chat/v1/lead/${leadId}`);
      const chatData = res.data?.data?.chat || res.data?.data || res.data;
      return chatData?.id || chatData?._id || (typeof chatData === 'string' ? chatData : null);
    } catch (err: any) {
      if (err.response?.status === 404) {
        const chatData = await this.createChatForLead(leadId);
        return chatData?.id || chatData?._id || (typeof chatData === 'string' ? chatData : null);
      }
      return null;
    }
  }

  async createChatForLead(leadId: string): Promise<any> {
    const res = await api.post<any>('/chat/v1/create', { leadId });
    return res.data?.data?.chat;
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

    // 1. Check Memory Cache First (dedupe by filePath)
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

    // 2. Fetch from backend for remaining paths. Sign against each file's OWN
    // bucket (falling back to the chat bucket) — the env bucket is wrong here.
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
          // Prefer the echoed path; fall back to positional alignment with the
          // request (web parity — the endpoint may not echo filePath back).
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

  /**
   * Web parity: `getSecureLinks({ filePaths })` — POST the file paths and return the
   * raw response array in REQUEST ORDER. The caller aligns each entry positionally to
   * its source file and keys the signed URL by the file's stable id. This avoids the
   * S3-key round-trip problem (appointment-photo keys have spaces/em-dashes and often
   * an empty bucket, so object-key lookups miss and the tile shows a placeholder).
   */
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

  // Like extractFilePaths, but carries each file's own bucketName so signed URLs
  // are requested against the correct S3 bucket (web parity). Top-level media
  // fields (voice/image on the message itself) have no per-file bucket and fall
  // back to the chat bucket in getSecureFileUrls.
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
    // 1. Robust extraction: handle nested payloads ONLY if they are actual objects
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
        // Server uses `message` field; GiftedChat uses `text`
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
          // profilePicture is an object { bucketName, filePath } - return undefined for now; URL fetched separately
          return undefined;
        })(),
      },
      // Normalize files — server uses fileName/fileType/filePath/mimeType
      files: (m.files || m.messageFiles || []).map((f: any) => ({
        ...f,
        id: f._id || f.id,
        name: f.fileName || f.originalname || f.original_name || f.name || f.display_name || f.filePath?.split('/').pop() || 'File',
        type: f.fileType || f.mimeType || f.type || f.contentType || 'application/octet-stream',
        mimeType: f.mimeType || f.fileType || f.type || 'application/octet-stream',
        size: this.normalizeFileSize(f),
        // filePath is the S3 key; url will be fetched securely separately
        url: f.url || f.path || f.s3url || f.preview || undefined,
        filePath: f.filePath || f.path || undefined,
        bucketName: f.bucketName || undefined,
      })),
      reactions: m.reactions || [],
      isPinned: m.isPinned || false,
      isEdited: m.isEdited || false,
      editHistory: m.editHistory || [],
      received: !!m.seenBy?.length,
      sent: true,
      // Preserve reply linkage from server
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

    // Verbose logging for debug
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

  async sendFileMessage(chatId: string, file: any, message = '', replyTo?: string): Promise<void> {
    let resolvedUri = file?.uri ?? '';

    // Android: copy content:// URIs to a local cache file so FormData can read them.
    // content:// URIs are not supported by the native networking stack directly.
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

    // Normalize local file paths with the file:// prefix on both Android and iOS so that
    // React Native's FormData engine can correctly read the file data.
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

    // Do NOT set Content-Type — let React Native's networking layer append the
    // multipart boundary. Setting `multipart/form-data` here (as a merge did) sends it
    // WITHOUT the boundary, so the backend can't parse the body and the image never
    // uploads. This is the `main`-branch behavior that works; the boundary-less header
    // was the regression. (The web sets the header, but browsers rewrite it with the
    // boundary for FormData — React Native does not.)
    await api.post<any>(`/chat/v1/${chatId}/messages`, formData);
  }

  // Send MULTIPLE local files in ONE message (multipart) — so a batch of gallery
  // photos sent together lands as a single message and renders as a grid, just
  // like appointment photos. The backend accepts multiple `files` parts (same
  // multer-array pattern the offline image upload uses).
  async sendFilesMessage(
    chatId: string,
    files: Array<{ uri?: string; name?: string; fileName?: string; type?: string }>,
    message = '',
    replyTo?: string
  ): Promise<void> {
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

    // Do NOT set Content-Type — let React Native's networking layer append the
    // multipart boundary (same as sendFileMessage / the working `main` branch). A
    // boundary-less `multipart/form-data` header makes the backend fail to parse the
    // upload, so the image never sends.
    await api.post<any>(`/chat/v1/${chatId}/messages`, formData);
  }


  // Send already-in-S3 photos (the lead's appointment/sales photos) as ONE
  // message carrying an array of file REFERENCES — not a binary upload. Mirrors
  // the web MessageInput.handleSend appointment-photo branch: a single JSON POST
  // with `type: 'appointment_photo'` and `files: [{ filePath, bucketName, ... }]`.
  // The backend echoes these files back (with bucketName), so on reload the chat
  // signs each filePath against its own bucket and the grid renders correctly.
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
    replyTo?: string
  ): Promise<void> {
    const payload: any = {
      chatId,
      message: message || ' ',
      type: 'appointment_photo',
      files,
    };
    if (replyTo) payload.replyTo = replyTo;
    // Plain JSON body (default Content-Type) — NOT multipart.
    await api.post<any>(`/chat/v1/${chatId}/messages`, payload);
  }

  async sendMessageREST(payload: {
    chatId: string;
    message: string;
    replyTo?: string;
  }): Promise<any> {
    const res = await api.post(`/chat/v1/${payload.chatId}/messages`, {
      message: payload.message,
      replyTo: payload.replyTo,
    });
    return (res as any).data?.data?.message || (res as any).data;
  }

  // ─── Socket wrappers (delegate to SocketManager) ─────────────────────────

  /** @deprecated — socket lifecycle is now managed by SocketManager */
  connect(token: string, chatId: string, isChannel = false, userId?: string): any {
    // SocketManager.connect() is called at app level (in AppContent).
    // This method now just joins the room for backward compat.
    const event = isChannel ? 'join-team-channel' : 'join-chat';
    SocketManager.joinRoom(chatId, event, userId);
    return SocketManager.getSocket();
  }

  /** @deprecated — socket lifecycle is now managed by SocketManager */
  disconnect(): void {
    // Room cleanup only — SocketManager owns the socket
    // (actual disconnect on logout is handled by useSocketManager)
  }

  sendMessage(payload: { chatId: string; message: string; replyTo?: string }): void {
    SocketManager.emit('send-message', payload);
  }

  deleteMessage(messageId: string): void {
    SocketManager.emit('delete-message', { messageId });
  }

  getReplies(chatId: string, messageId: string): void {
    SocketManager.emit('get-replies', { messageId, chatId });
  }

  markSeen(chatId: string, messageIds: string[]): void {
    // `mark-messageS-seen` (PLURAL) is the object-taking event. The singular
    // `mark-message-seen` takes a bare messageId STRING and silently ignores an object,
    // which is why unread counts never cleared — CHAT-MOBILE-API.md §3.1.
    SocketManager.emit('mark-messages-seen', { chatId, messageIds });
  }

  async addParticipant(chatId: string, userId: string): Promise<void> {
    await api.post(`/chat/v1/${chatId}/participants`, { userId });
  }

  getPinnedMessages(chatId: string): void {
    SocketManager.emit('get-pinned-messages', chatId);
  }

  pinMessage(chatId: string, messageId: string, isChannel: boolean): void {
    const payload: any = { messageId };
    if (isChannel) payload.channelId = chatId;
    else payload.chatId = chatId;
    console.log('[ChatService] pin-message:', payload);
    SocketManager.emit('pin-message', payload);
  }

  unpinMessage(chatId: string, messageId: string, isChannel: boolean): void {
    const payload: any = { messageId };
    if (isChannel) payload.channelId = chatId;
    else payload.chatId = chatId;
    console.log('[ChatService] unpin-message:', payload);
    SocketManager.emit('unpin-message', payload);
  }

  addReaction(chatId: string, messageId: string, emoji: string): void {
    const payload = { messageId, emoji };
    console.log('[ChatService] add-reaction:', payload);
    SocketManager.emit('add-reaction', payload);
  }

  removeReaction(chatId: string, messageId: string, emoji: string): void {
    const payload = { messageId, emoji };
    console.log('[ChatService] remove-reaction:', payload);
    SocketManager.emit('remove-reaction', payload);
  }

  async editMessage(messageId: string, message: string): Promise<void> {
    const payload = { messageId, message };
    console.log('[ChatService] edit-message:', payload);
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

  // ─── Team Channels ──────────────────────────────────────────────────────────

  async getChannelParticipants(channelId: string): Promise<any[]> {
    try {
      const res = await api.get<any>(`/chat/v1/channels/${channelId}/members`);
      return res.data?.data?.participants || res.data?.data?.members || [];
    } catch {
      const details = await this.getChatDetails(channelId);
      return details?.participants || [];
    }
  }

  markChannelSeen(channelId: string, user: any): void {
    SocketManager.emit('mark-channel-as-read', {
      channelId,
      userId: user?.id || user?._id,
    });
  }

  /**
   * Create a new team channel.
   * Web parity: `use-team-channels.js` `createChannel` emits the `create-team-channel`
   * socket event with the channel payload built in the create-channel dialog. The
   * backend responds by broadcasting `team-channel-created`, which the threads screen
   * listens for to refresh the channel list.
   */
  createChannel(channelData: any): void {
    console.log('[ChatService] create-team-channel:', channelData);
    SocketManager.emit('create-team-channel', channelData);
  }



  emitChannelTyping(channelId: string, isTyping: boolean): void {
    if (!SocketManager.isConnected()) return;
    const now = Date.now();
    if (isTyping && now - this.lastTypingTime < 1000) return;
    this.lastTypingTime = now;
    SocketManager.emit('channel-typing', { channelId, isTyping });
  }

  /**
   * Resolves a lead's chat and makes sure `userId` is on its participant list.
   *
   * The backend seeds participants when the chat is first CREATED — rep, installer,
   * crew, managers. Anyone added to the crew after that is missing, which is the normal
   * case for an installer: the thread usually exists from the sales conversation long
   * before a crew is assigned. A non-participant can still read and post, but gets
   * **no unread badge, no chat-list refresh and no push notifications**
   * (CHAT-MOBILE-API.md §2.1) — most of the value of the thread.
   *
   * Safe to call repeatedly: `getChatByLeadId` falls back to create (itself idempotent),
   * and the POST only fires when the id is genuinely absent.
   *
   * Never throws. This runs behind a screen that has already opened, so a failure costs
   * notifications, not the chat.
   */
  async ensureParticipant(leadId: string, userId: string): Promise<string | null> {
    try {
      const chatId = await this.getChatByLeadId(leadId);
      if (!chatId || !userId) return chatId;

      const participants = await this.getLeadParticipants(chatId, leadId);
      // Participants come back as objects on some routes and bare ids on others.
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
