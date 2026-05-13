/**
 * SocketManager — Global persistent socket connection
 *
 * Architecture:
 *  - ONE socket per authenticated session, shared across ALL screens.
 *  - Connects on login, disconnects on logout.
 *  - ChatDetail joins/leaves "rooms" but never owns the socket.
 *  - AppState changes trigger reconnect without tearing down the socket.
 *
 * Why this matters for mobile:
 *  - Before: socket was created in useChatSession (per-screen). When user left
 *    ChatDetail, the socket was DESTROYED. On re-entry it had to reconnect from
 *    scratch — this window is where pin/react would fail.
 *  - Now: socket lives as long as the user is logged in.
 */

import { io, Socket } from 'socket.io-client';
import { AppState, AppStateStatus } from 'react-native';
import { ENV } from '../config/env';

const HOST_API = ENV.API_URL;

type RoomEvent = 'join-chat' | 'join-team-channel';

class SocketManager {
  private socket: Socket | null = null;
  private token: string | null = null;

  // Track which rooms we've joined so we can re-join on reconnect
  private joinedRooms: Map<string, RoomEvent> = new Map();

  // Pending queue: emits that arrived while socket was reconnecting
  private pendingQueue: Array<{ event: string; payload: any }> = [];

  // AppState subscription
  private appStateSub: any = null;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Call on user login — starts the persistent connection */
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
      // Re-join every room we were in before the reconnect
      this.rejoinAllRooms();
      // Flush any emits that were queued during the reconnect window
      this.flushPendingQueue();
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[SocketManager] Disconnected:', reason);
      // socket.io auto-reconnects for all reasons except 'io client disconnect'
      // which is triggered by our own socket.disconnect() call
    });

    this.socket.on('connect_error', (err) => {
      console.warn('[SocketManager] Connection error:', err.message);
    });

    // Watch AppState so we can reconnect when app comes to foreground
    this.startAppStateWatcher();
  }

  /** Call on user logout — tears down everything */
  disconnect(): void {
    console.log('[SocketManager] Disconnecting (logout)');
    this.stopAppStateWatcher();
    this.joinedRooms.clear();
    this.pendingQueue = [];
    this.token = null;

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ─── Room management ───────────────────────────────────────────────────────

  /** Join a chat or channel room. Called by useChatSession on mount. */
  joinRoom(roomId: string, event: RoomEvent = 'join-chat', userId?: string): void {
    // Always track room so it gets re-joined on reconnect
    this.joinedRooms.set(roomId, event);

    if (!this.socket?.connected) {
      console.log('[SocketManager] Socket not ready, room queued:', roomId);
      // If socket exists but temporarily disconnected, trigger reconnect
      if (this.socket && !this.socket.connected) {
        this.socket.connect();
      }
      return;
    }

    this.socket.emit(event, roomId, () => {
      console.log(`[SocketManager] Joined room "${roomId}" via "${event}"`);
      this.socket?.emit('get-pinned-messages', roomId);
      if (event === 'join-team-channel' && userId) {
        this.socket?.emit('mark-channel-read', { channelId: roomId, userId });
      }
    });

    // Fallback if server doesn't send ack
    setTimeout(() => {
      if (this.socket?.connected) {
        this.socket.emit('get-pinned-messages', roomId);
      }
    }, 800);
  }

  /**
   * Leave a chat room. Called by useChatSession on unmount.
   * NOTE: We do NOT disconnect the socket — it stays alive for the session.
   */
  leaveRoom(roomId: string): void {
    this.joinedRooms.delete(roomId);
    // Optionally notify the server we're leaving (depends on server support)
    // this.socket?.emit('leave-chat', roomId);
  }

  // ─── Event emitters ────────────────────────────────────────────────────────

  /** Emit an event. Queues if temporarily disconnected (e.g., brief network blip). */
  emit(event: string, payload: any): void {
    if (this.socket?.connected) {
      this.socket.emit(event, payload);
    } else {
      console.warn(`[SocketManager] Not connected – queuing "${event}"`);
      this.pendingQueue.push({ event, payload });
      // Kick off reconnect if socket exists but is disconnected
      if (this.socket && !this.socket.connected) {
        this.socket.connect();
      }
    }
  }

  /** Subscribe to a socket event. Returns an unsubscribe function. */
  on(event: string, handler: (...args: any[]) => void): () => void {
    this.socket?.on(event, handler);
    return () => this.socket?.off(event, handler);
  }

  /** Subscribe to a socket event only once. */
  once(event: string, handler: (...args: any[]) => void): void {
    this.socket?.once(event, handler);
  }

  /** Remove a specific event handler. */
  off(event: string, handler: (...args: any[]) => void): void {
    this.socket?.off(event, handler);
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected === true;
  }

  get connected(): boolean {
    return this.isConnected();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private rejoinAllRooms(): void {
    if (this.joinedRooms.size === 0) return;
    console.log(`[SocketManager] Re-joining ${this.joinedRooms.size} room(s) after reconnect`);
    this.joinedRooms.forEach((event, roomId) => {
      this.socket?.emit(event, roomId, () => {
        console.log(`[SocketManager] Re-joined room "${roomId}"`);
        this.socket?.emit('get-pinned-messages', roomId);
      });
    });
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

// Singleton — one socket for the entire app session
export default new SocketManager();
