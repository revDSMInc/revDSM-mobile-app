import { io, Socket } from 'socket.io-client';
import { AppState, AppStateStatus } from 'react-native';
import { ENV } from '../config/env';

const HOST_API = ENV.API_URL;

type RoomEvent = 'join-chat' | 'join-team-channel';

class SocketManager {
  private socket: Socket | null = null;
  private token: string | null = null;

  private joinedRooms: Map<string, RoomEvent> = new Map();

  private onsiteLeadId: string | null = null;

  private pendingQueue: Array<{ event: string; payload?: any }> = [];

  private appStateSub: any = null;

  connect(token: string): void {
    if (this.socket?.connected && this.token === token) {
      console.log('[SocketManager] Already connected, skipping');
      return;
    }

    this.token = token;

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    console.log('[SocketManager] Creating persistent socket...');

    this.socket = io(HOST_API.replace(/\/$/, ''), {
      auth: { token },
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      console.log('[SocketManager] Connected ✓', this.socket?.id);
      this.rejoinAllRooms();
      this.rejoinLeadOnsiteWatch();
      this.flushPendingQueue();
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[SocketManager] Disconnected:', reason);
    });

    this.socket.on('connect_error', (err) => {
      console.warn('[SocketManager] Connection error:', err.message);
    });

    this.startAppStateWatcher();
  }

  disconnect(): void {
    console.log('[SocketManager] Disconnecting (logout)');
    this.stopAppStateWatcher();
    this.joinedRooms.clear();
    this.onsiteLeadId = null;
    this.pendingQueue = [];
    this.token = null;

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinRoom(roomId: string, event: RoomEvent = 'join-chat', userId?: string): void {
    this.joinedRooms.set(roomId, event);

    if (!this.socket?.connected) {
      console.log('[SocketManager] Socket not ready, room queued:', roomId);
      if (this.socket && !this.socket.connected) {
        this.socket.connect();
      }
      return;
    }

    this.socket.emit(event, roomId, () => {
      console.log(`[SocketManager] Joined room "${roomId}" via "${event}"`);
      if (event === 'join-chat') this.socket?.emit('get-pinned-messages', roomId);
    });

    if (event === 'join-chat') {
      setTimeout(() => {
        if (this.socket?.connected) {
          this.socket.emit('get-pinned-messages', roomId);
        }
      }, 800);
    }
  }

  leaveRoom(roomId: string): void {
    const event = this.joinedRooms.get(roomId);
    this.joinedRooms.delete(roomId);
    this.socket?.emit(event === 'join-team-channel' ? 'leave-team-channel' : 'leave-chat', roomId);
  }

  /** Emit with the server's ack callback ({ success, data? } | { success:false, message, code }). Rejects when offline. */
  emitWithAck(event: string, payload: any, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject({ message: 'Not connected', code: 'NOT_CONNECTED' });
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject({ message: 'Request timed out', code: 'TIMEOUT' });
      }, timeoutMs);
      this.socket.emit(event, payload, (res: any) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (res && res.success === false) reject(res);
        else resolve(res);
      });
    });
  }

  joinLeadOnsiteWatch(leadId: string): void {
    if (!leadId) return;
    this.onsiteLeadId = leadId;
    console.log('[SocketManager] join-lead-onsite-watch:', leadId);
    this.emit('join-lead-onsite-watch', leadId);
  }

  leaveLeadOnsiteWatch(leadId: string): void {
    if (!leadId) return;
    if (this.onsiteLeadId === leadId) this.onsiteLeadId = null;
    console.log('[SocketManager] leave-lead-onsite-watch:', leadId);
    this.emit('leave-lead-onsite-watch', leadId);
  }

  emit(event: string, payload?: any): void {
    if (this.socket?.connected) {
      this.socket.emit(event, payload);
    } else {
      console.warn(`[SocketManager] Not connected – queuing "${event}"`);
      this.pendingQueue.push({ event, payload });
      if (this.socket && !this.socket.connected) {
        this.socket.connect();
      }
    }
  }

  on(event: string, handler: (...args: any[]) => void): () => void {
    this.socket?.on(event, handler);
    return () => this.socket?.off(event, handler);
  }

  once(event: string, handler: (...args: any[]) => void): void {
    this.socket?.once(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.socket?.off(event, handler);
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected === true;
  }

  get connected(): boolean {
    return this.isConnected();
  }

  private rejoinAllRooms(): void {
    if (this.joinedRooms.size === 0) return;
    console.log(`[SocketManager] Re-joining ${this.joinedRooms.size} room(s) after reconnect`);
    this.joinedRooms.forEach((event, roomId) => {
      this.socket?.emit(event, roomId, () => {
        console.log(`[SocketManager] Re-joined room "${roomId}"`);
        if (event === 'join-chat') this.socket?.emit('get-pinned-messages', roomId);
      });
    });
  }

  private rejoinLeadOnsiteWatch(): void {
    if (!this.onsiteLeadId) return;
    console.log('[SocketManager] Re-joining lead on-site watch:', this.onsiteLeadId);
    this.socket?.emit('join-lead-onsite-watch', this.onsiteLeadId);
  }

  private flushPendingQueue(): void {
    if (this.pendingQueue.length === 0) return;
    console.log(`[SocketManager] Flushing ${this.pendingQueue.length} queued emit(s)`);
    const toFlush = [...this.pendingQueue];
    this.pendingQueue = [];
    toFlush.forEach(({ event, payload }) => {
      if (this.socket?.connected) {
        console.log(`[SocketManager] Replaying queued "${event}"`);
        this.socket.emit(event, payload);
      }
    });
  }

  private startAppStateWatcher(): void {
    this.stopAppStateWatcher();
    this.appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && this.socket && !this.socket.connected) {
        console.log('[SocketManager] App foregrounded — reconnecting socket');
        this.socket.connect();
      }
    });
  }

  private stopAppStateWatcher(): void {
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
  }
}

export default new SocketManager();
