/**
 * offlinePhotoDeleteQueue.ts — deferred photo deletes, replayed on reconnect.
 *
 * The binding half of `utils/offline-photo-deletes.ts`: MMKV persistence, the API call, the
 * reconnect drain and the listener fan-out. The rules themselves live in that pure module so they
 * can be tested without the native storage.
 *
 * Mirrors `uploadQueue`'s shape deliberately — same `addListener` contract, same session
 * ownership, same `rekeyLead` hook — so a screen that already reads one can read the other
 * without a new pattern.
 */

import { AppState } from 'react-native';
import { Storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { queryClient } from './api/queryClient';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import { isOwnedBy } from '../utils/session-scope';
import {
  addDelete,
  deletedUrlsFor,
  removeDelete,
  rekeyDeletes,
  shouldRetryDelete,
  type QueuedPhotoDelete,
} from '../utils/offline-photo-deletes';

const STORAGE_KEY = 'offline-photo-deletes';

/** Matches the photo upload queue and the lead store — all three sweep on the same cadence. */
const DELETE_RETRY_SWEEP_MS = 60_000;

class OfflinePhotoDeleteQueue {
  private queue: QueuedPhotoDelete[] = [];
  private draining = false;
  private listeners: (() => void)[] = [];

  constructor() {
    this.load();
    onReconnect(() => void this.drain());

    // ⚠️ The reconnect edge alone is not enough — same gap the photo upload queue had. If signal
    // returns while the app is backgrounded or killed there is no listener running to see the
    // edge, and on reopen the device is already online so none fires then either. The foreground
    // hook catches the reopen; the sweep catches a pass that failed while online throughout.
    AppState.addEventListener('change', (next) => {
      if (next === 'active') void this.drain();
    });

    setInterval(() => {
      // Two in-memory reads on a session with nothing queued, which is most of them.
      if (!isOnline()) return;
      if (this.mine().length === 0) return;
      void this.drain();
    }, DELETE_RETRY_SWEEP_MS);
  }

  private load() {
    try {
      const raw = Storage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.queue = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[photoDeletes] could not read the queue:', e);
      this.queue = [];
    }
  }

  private save() {
    try {
      Storage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      // A device with no space must not break the delete the rep just performed.
      console.warn('[photoDeletes] could not persist the queue:', e);
    }
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.warn('[photoDeletes] listener threw:', e);
      }
    });
  }

  public addListener(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** ⚠️ Only the signed-in rep's deletes — same rule as the upload queue. */
  private mine(): QueuedPhotoDelete[] {
    return this.queue.filter((q) => isOwnedBy(q.userId, getSessionOwner()));
  }

  public getQueue(): QueuedPhotoDelete[] {
    return this.mine();
  }

  /** s3urls deleted on this device but not yet on the server. Every lead read subtracts these. */
  public deletedUrls(leadId: string | null | undefined): Set<string> {
    return deletedUrlsFor(this.mine(), leadId);
  }

  /** File a delete for replay. Returns false when it was already queued. */
  public enqueue(entry: Omit<QueuedPhotoDelete, 'id' | 'queuedAt'>): boolean {
    const before = this.queue.length;
    this.queue = addDelete(this.queue, {
      ...entry,
      id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: Date.now(),
    });
    if (this.queue.length === before) return false;
    this.save();
    this.notify();
    if (isOnline()) void this.drain();
    return true;
  }

  /** See `rekeyDeletes` — a lead created at the door gets its real id. */
  public rekeyLead(fromLeadId: string, toLeadId: string) {
    const next = rekeyDeletes(this.queue, fromLeadId, toLeadId);
    if (next === this.queue) return;
    this.queue = next;
    this.save();
    this.notify();
    if (isOnline()) void this.drain();
  }

  /** Drop every entry for a lead — used when the lead itself is abandoned. */
  public dropLead(leadId: string): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.leadId !== leadId);
    const removed = before - this.queue.length;
    if (removed) {
      this.save();
      this.notify();
    }
    return removed;
  }

  public resetForNewSession() {
    this.queue = [];
    this.draining = false;
    this.notify();
  }

  /**
   * Replay every queued delete.
   *
   * ⚠️ Serial, not parallel. These are destructive writes against one lead; firing them together
   * means several concurrent mutations of the same `salesPhotos` array, and the backend merges
   * that array wholesale — two in flight at once can resurrect a photo the other just removed.
   */
  public async drain(): Promise<void> {
    if (this.draining) return;
    if (!isOnline()) return;
    const pending = this.mine();
    if (pending.length === 0) return;

    this.draining = true;
    const touchedLeads = new Set<string>();
    try {
      for (const entry of pending) {
        if (!isOnline()) break; // signal dropped mid-drain; the rest stays queued
        try {
          await LeadService.deleteImage(entry.leadId, {
            s3urls: [entry.s3url],
            category: entry.category || 'salesPhotos',
          });
          this.queue = removeDelete(this.queue, entry.id);
          this.save();
          touchedLeads.add(entry.leadId);
        } catch (err: any) {
          const status = err?.response?.status;
          const retryCount = (entry.retryCount || 0) + 1;
          if (!shouldRetryDelete(status, retryCount)) {
            // Either already gone (success in disguise) or permanently rejected. Either way it
            // must leave the queue, or it blocks every delete behind it forever.
            console.warn(
              `[photoDeletes] dropping ${entry.id} (status ${status ?? 'network'}, attempt ${retryCount})`
            );
            this.queue = removeDelete(this.queue, entry.id);
            this.save();
            touchedLeads.add(entry.leadId);
          } else {
            const at = this.queue.findIndex((q) => q.id === entry.id);
            if (at !== -1) this.queue[at] = { ...entry, retryCount };
            this.save();
          }
        }
      }
    } finally {
      this.draining = false;
      this.notify();
      // One refetch per lead at the END, not per delete — a lead with six removed photos
      // should cost one round trip, not six.
      touchedLeads.forEach((leadId) => {
        queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      });
      if (touchedLeads.size) queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  }
}

export const offlinePhotoDeleteQueue = new OfflinePhotoDeleteQueue();

// Signing out drops queued deletes along with every other session mirror.
registerSessionResetHook(() => offlinePhotoDeleteQueue.resetForNewSession());
