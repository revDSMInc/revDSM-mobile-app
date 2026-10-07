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

const DELETE_RETRY_SWEEP_MS = 60_000;

class OfflinePhotoDeleteQueue {
  private queue: QueuedPhotoDelete[] = [];
  private draining = false;
  private listeners: (() => void)[] = [];

  constructor() {
    this.load();
    onReconnect(() => void this.drain());

    AppState.addEventListener('change', (next) => {
      if (next === 'active') void this.drain();
    });

    setInterval(() => {
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

  private mine(): QueuedPhotoDelete[] {
    return this.queue.filter((q) => isOwnedBy(q.userId, getSessionOwner()));
  }

  public getQueue(): QueuedPhotoDelete[] {
    return this.mine();
  }

  public deletedUrls(leadId: string | null | undefined): Set<string> {
    return deletedUrlsFor(this.mine(), leadId);
  }

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

  public rekeyLead(fromLeadId: string, toLeadId: string) {
    const next = rekeyDeletes(this.queue, fromLeadId, toLeadId);
    if (next === this.queue) return;
    this.queue = next;
    this.save();
    this.notify();
    if (isOnline()) void this.drain();
  }

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
      touchedLeads.forEach((leadId) => {
        queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      });
      if (touchedLeads.size) queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  }
}

export const offlinePhotoDeleteQueue = new OfflinePhotoDeleteQueue();

registerSessionResetHook(() => offlinePhotoDeleteQueue.resetForNewSession());
