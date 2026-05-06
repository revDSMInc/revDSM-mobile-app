/**
 * ChatService — REST + socket operations for the chat module.
 *
 * The socket lifecycle is now managed by SocketManager (singleton).
 * ChatService only handles REST calls and wraps SocketManager.emit()
 * for chat-specific events.
 */

import api from './index';
import SocketManager from '../SocketManager';

class ChatService {
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

  async getSecureFileUrls(filePaths: string[]): Promise<Record<string, string>> {
    const payload = {
      filePaths: filePaths.map((p) => ({
        bucketName: 'np-revdsm-staging',
        filePath: p,
      })),
    };
    const res = await api.post<any>('url/v1/secure/multiple', payload);
    const rawData = res.data?.data || res.data;
    const links: Record<string, string> = {};

    if (Array.isArray(rawData)) {
      rawData.forEach((item: any) => {
        const key = item.filePath || item.path;
        const val = item.secureUrl || item.url;
        if (key && val) links[key] = val;
      });
    } else if (rawData && typeof rawData === 'object') {
      Object.entries(rawData).forEach(([k, v]) => {
        if (typeof v === 'string') links[k] = v;
      });
    }
    return links;
  }

  extractFilePaths(messages: any[]): string[] {
    const paths: string[] = [];
    messages.forEach((m) => {
      const files = m.files || m.messageFiles || [];
      files.forEach((f: any) => {
        if (f.filePath || f.path) paths.push(f.filePath || f.path);
        else if (f.url && !f.url.startsWith('http')) paths.push(f.url);
      });
      if (m.audio) paths.push(m.audio);
      if (m.voice) paths.push(m.voice);
      if (m.image) paths.push(m.image);
      if (m.video) paths.push(m.video);
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

  normalizeFileSize(file: any): number {
    const size = file.size || file.fileSize || file.file_size;
    if (size === undefined || size === null) return 0;
    const normalizedSize = Number(size);
    return isNaN(normalizedSize) ? 0 : normalizedSize;
  }

  normalizeMessage(m: any): any {
    const sender = m.senderDetails || m.user || m.sender || {};
    const senderId = m.senderId || sender._id || sender.id || 'ghost';
    const firstName = sender.firstName || '';
    const lastName = sender.lastName || '';
    const fullName = sender.fullName || `${firstName} ${lastName}`.trim() || 'User';

    return {
      ...m,
      _id: (
        m._id ||
        m.id ||
        `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      ).toString(),
      id: (
        m.id ||
        m._id ||
        `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      ).toString(),
      text: (() => {
        const raw = m.text || m.message || m.content || m.body || '';
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') return raw.body || raw.message || raw.text || '';
        return raw ? String(raw) : '';
      })(),
      createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
      user: {
        _id: senderId,
        name: fullName,
        avatar: sender.profilePicture || sender.image || undefined,
      },
      files: (m.files || m.messageFiles || []).map((f: any) => ({
        ...f,
        id: f._id || f.id,
        url: f.url || f.path || f.s3url || f.preview,
        size: this.normalizeFileSize(f),
        name:
          f.originalname ||
          f.original_name ||
          f.fileName ||
          f.name ||
          f.display_name ||
          f.filePath?.split('/').pop() ||
          'File',
      })),
      reactions: m.reactions || [],
      isPinned: m.isPinned || false,
      isEdited: m.isEdited || false,
      editHistory: m.editHistory || [],
      received: !!m.seenBy?.length,
      image: (() => {
        if (m.image) return m.image;
        if (m.contentType === 'image' && typeof m.content === 'string') return m.content;
        const files = m.files || m.messageFiles || [];
        const imgFile = files.find(
          (f: any) =>
            f.type?.startsWith('image') ||
            f.mimeType?.startsWith('image') ||
            f.contentType?.startsWith('image')
        );
        return imgFile?.path || imgFile?.url || undefined;
      })(),
      video: (() => {
        if (m.video) return m.video;
        if (m.contentType === 'video' && typeof m.content === 'string') return m.content;
        const files = m.files || m.messageFiles || [];
        const vidFile = files.find(
          (f: any) =>
            f.type?.startsWith('video') ||
            f.mimeType?.startsWith('video') ||
            f.contentType?.startsWith('video')
        );
        return vidFile?.path || vidFile?.url || undefined;
      })(),
      audio: (() => {
        if (m.audio) return m.audio;
        if (m.voice) return m.voice;
        if (
          (m.messageType === 'voice' || m.contentType === 'audio') &&
          typeof m.content === 'string'
        )
          return m.content;
        const files = m.files || m.messageFiles || [];
        const audFile = files.find(
          (f: any) =>
            f.type?.startsWith('audio') ||
            f.mimeType?.startsWith('audio') ||
            f.contentType?.startsWith('audio')
        );
        return audFile?.path || audFile?.url || undefined;
      })(),
      isVoiceNote: m.isVoiceNote || m.messageType === 'voice' || m.contentType === 'audio' || false,
    };
  }

  async sendFileMessage(chatId: string, file: any, message = '', replyTo?: string): Promise<void> {
    const formData = new FormData();
    formData.append('message', message || ' ');
    if (replyTo) formData.append('replyTo', replyTo);
    formData.append('files', file);
    await api.post<any>(`/chat/v1/${chatId}/messages`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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
    SocketManager.emit('mark-message-seen', { chatId, messageIds });
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

  emitChannelTyping(channelId: string, isTyping: boolean): void {
    if (!SocketManager.isConnected()) return;
    const now = Date.now();
    if (isTyping && now - this.lastTypingTime < 1000) return;
    this.lastTypingTime = now;
    SocketManager.emit('channel-typing', { channelId, isTyping });
  }

  async getLeadParticipants(chatId: string): Promise<any[]> {
    try {
      const res = await api.get<any>(`/chat/v1/${chatId}`);
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
