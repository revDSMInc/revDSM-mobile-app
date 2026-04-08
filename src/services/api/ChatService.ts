import { io, Socket } from 'socket.io-client';
import api from './index';
import { ENV } from '../../config/env';

const HOST_API = ENV.API_URL;

class ChatService {
  private socket: Socket | null = null;
  private lastTypingTime = 0;

  // ─── REST ───────────────────────────────────────────────────────────────────

  async getChatByLeadId(leadId: string): Promise<any> {
    try {
      const res = await api.get<any>(`/chat/v1/lead/${leadId}`);
      return res.data?.data?.chat;
    } catch (err: any) {
      if (err.response?.status === 404) {
        return this.createChatForLead(leadId);
      }
      throw err;
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
    return res.data?.data?.messages || [];
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

  // ─── Socket ─────────────────────────────────────────────────────────────────

  connect(token: string, chatId: string): Socket {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.socket = io(HOST_API, {
      auth: { token },
      query: { chatId },
      transports: ['websocket'],
    });
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Text message via socket (web parity)
  sendMessage(payload: { chatId: string; message: string; replyTo?: string }): void {
    this.socket?.emit('send-message', payload);
  }

  // Edit message via socket (web parity)
  editMessage(messageId: string, message: string): void {
    this.socket?.emit('edit-message', { messageId, message });
  }

  // Reactions via socket (web parity)
  addReaction(messageId: string, emoji: string): void {
    this.socket?.emit('add-reaction', { messageId, emoji });
  }

  removeReaction(messageId: string, emoji: string): void {
    this.socket?.emit('remove-reaction', { messageId, emoji });
  }

  // Fetch thread replies (web parity)
  getReplies(messageId: string, chatId: string): void {
    this.socket?.emit('get-replies', { messageId, chatId });
  }

  // Pinning (web parity)
  getPinnedMessages(chatId: string): void {
    this.socket?.emit('get-pinned-messages', chatId);
  }

  pinMessage(chatId: string, messageId: string): void {
    this.socket?.emit('pin-message', { chatId, messageId });
  }

  unpinMessage(chatId: string, messageId: string): void {
    this.socket?.emit('unpin-message', { chatId, messageId });
  }

  // Typing with 1-second throttle (web parity)
  emitTyping(chatId: string, isTyping: boolean): void {
    if (!this.socket) return;
    const now = Date.now();
    // Throttle typing events to 1s to save bandwidth
    if (isTyping && now - this.lastTypingTime < 1000) return;
    this.lastTypingTime = now;
    this.socket.emit('typing', { chatId, isTyping });
  }

  // Mark seen (web parity)
  markSeen(chatId: string, messageIds: string[]): void {
    this.socket?.emit('mark-message-seen', { chatId, messageIds });
  }

  // ─── Team Channels ──────────────────────────────────────────────────────────

  async getChannelParticipants(channelId: string): Promise<any[]> {
    const res = await api.get<any>(`/chat/v1/channels/${channelId}/participants`);
    return res.data?.data?.participants || [];
  }

  markChannelSeen(channelId: string, user: any): void {
    this.socket?.emit('mark-channel-as-read', {
      channelId,
      userId: user?.id || user?._id,
    });
  }

  emitChannelTyping(channelId: string, isTyping: boolean): void {
    if (!this.socket) return;
    const now = Date.now();
    if (isTyping && now - this.lastTypingTime < 1000) return;
    this.lastTypingTime = now;
    this.socket.emit('channel-typing', { channelId, isTyping });
  }
}

export default new ChatService();
