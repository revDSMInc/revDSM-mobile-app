import { storage } from './storage';
import Geolocation from 'react-native-geolocation-service';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { LeadService } from '../services/api/leads';
import { logEvent } from '../services/api/LoggerService';
import { queryClient } from '../services/api/queryClient';

export interface UploadQueueItem {
  id: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  uri: string;
  type: string;
  name: string;
  timestamp: string;
  retryCount?: number;
  userId?: string;
}

class UploadQueueManager {
  private queue: UploadQueueItem[] = [];
  private isProcessing = false;
  private onQueueChangeListeners: (() => void)[] = [];

  constructor() {
    this.loadQueue();
  }

  private loadQueue() {
    try {
      const saved = storage.getString('upload_photo_queue');
      if (saved) {
        this.queue = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('[UploadQueue] Failed to load upload queue from MMKV:', e);
      this.queue = [];
    }
  }

  private saveQueue() {
    try {
      storage.set('upload_photo_queue', JSON.stringify(this.queue));
      this.notifyListeners();
    } catch (e) {
      console.warn('[UploadQueue] Failed to save upload queue to MMKV:', e);
    }
  }

  public getQueue() {
    return this.queue;
  }

  public addListener(listener: () => void) {
    this.onQueueChangeListeners.push(listener);
    return () => {
      this.onQueueChangeListeners = this.onQueueChangeListeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.onQueueChangeListeners.forEach(l => {
      try { l(); } catch (e) { console.error('[UploadQueue] Listener error:', e); }
    });
  }

  public async addToQueue(item: Omit<UploadQueueItem, 'id' | 'timestamp'>) {
    const newItem: UploadQueueItem = {
      ...item,
      id: `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    this.queue.push(newItem);
    this.saveQueue();
    
    // Process queue in the background (fire and forget)
    this.processQueue();
    return newItem.id;
  }

  private async checkOnline(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      clearTimeout(timeoutId);
      return true;
    } catch (e) {
      return false;
    }
  }

  public async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    console.log(`[UploadQueue] Processing started. Queue length: ${this.queue.length}`);

    // Connectivity is checked ONCE here, not before every item. The old code ran a
    // `fetch('https://www.google.com')` HEAD round-trip (up to 3s) BEFORE every
    // single upload, so a burst of N photos paid N extra round-trips and felt slow.
    // Now: one pre-flight check, then all queued items upload back-to-back; any
    // connectivity loss mid-burst is caught by the per-item catch below (which
    // re-checks and pauses without burning a retry).
    if (!(await this.checkOnline())) {
      console.log('[UploadQueue] Device is offline. Pausing queue processing.');
      this.isProcessing = false;
      setTimeout(() => this.processQueue(), 5000);
      return;
    }

    while (this.queue.length > 0) {
      const activeItem = this.queue[0];
      try {
        console.log(`[UploadQueue] Uploading item: ${activeItem.id} for slot: ${activeItem.subcategory}`);
        await this.uploadItem(activeItem);
        
        // Remove completed item from queue
        this.queue.shift();
        this.saveQueue();
        console.log(`[UploadQueue] Upload success: ${activeItem.id}`);
      } catch (error) {
        // Double-check if we became offline during the upload attempt
        const stillOnline = await this.checkOnline();
        if (!stillOnline) {
          console.log('[UploadQueue] Connection lost during upload. Retrying without incrementing retry count.');
          // Schedule next check in 5 seconds
          setTimeout(() => this.processQueue(), 5000);
          break;
        }

        const retryCount = (activeItem.retryCount || 0) + 1;
        console.error(`[UploadQueue] Upload failed for item: ${activeItem.id} (attempt ${retryCount}):`, error);

        if (retryCount >= 5) {
          // Permanent failure after 5 attempts while online (e.g. invalid file, server rejection) — drop this item
          console.warn(`[UploadQueue] Giving up on item ${activeItem.id} after ${retryCount} attempts. Dropping.`);
          this.queue.shift();
          this.saveQueue();
        } else {
          // Update retry count in place and persist
          this.queue[0] = { ...activeItem, retryCount };
          this.saveQueue();
          // Wait before retrying (exponential backoff 3s, 6s, 12s...)
          const backoffMs = Math.min(3000 * retryCount, 15000);
          console.log(`[UploadQueue] Waiting ${backoffMs}ms before retry...`);
          await new Promise<void>(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    this.isProcessing = false;
    console.log('[UploadQueue] Processing finished.');
  }


  private async uploadItem(item: UploadQueueItem): Promise<void> {
    // 1. Get location with 5 mins cache
    let coords = { latitude: 0, longitude: 0 };
    try {
      const position = await new Promise<any>((resolve, reject) => {
        Geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 300000, // 5 minutes cache
        });
      });
      coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (e) {
      console.warn('[UploadQueue] Could not get location for queue upload:', e);
    }

    // 2. Prepare Form Data
    const formData = new FormData();
    formData.append('files', {
      uri: item.uri,
      type: item.type,
      name: item.name,
    } as any);

    const imageInfo = [
      {
        category: item.categoryName,
        subcategory: item.subcategory,
        timestampTaken: item.timestamp,
        coordinates: coords,
      },
    ];
    formData.append('images', JSON.stringify(imageInfo));
    formData.append('category', 'salesPhotos');

    // Fetch existing photo URLs before upload to prevent matching them in the success handler
    const existingUrls = new Set<string>();
    const userId = item.userId;
    if (userId) {
      try {
        const beforeLeadRes = await LeadService.workLead(item.leadId, userId);
        const beforeLead = beforeLeadRes.data?.data || beforeLeadRes.data;
        if (beforeLead?.salesPhotos && Array.isArray(beforeLead.salesPhotos)) {
          beforeLead.salesPhotos.forEach((p: any) => {
            if (p.s3url) existingUrls.add(p.s3url);
          });
        }
      } catch (err) {
        console.warn('[UploadQueue] Failed to fetch existing photos before upload:', err);
      }
    }

    // 3. Upload S3 image
    const response = await LeadService.uploadImages(item.leadId, formData);

    // 3b. Log analytical event on upload success
    try {
      const isAnnotated = item.subcategory?.includes('(Annotated)');
      if (userId) {
        let s3url = '';
        let bucketName = '';

        // Try to match the photo from the upload response first
        const responseSalesPhotos = response.data?.salesPhotos || response.data?.data?.salesPhotos || [];
        const immediateMatch = [...responseSalesPhotos].reverse().find(
          (p: any) =>
            p.category?.toLowerCase() === item.categoryName?.toLowerCase() &&
            p.subcategory?.toLowerCase() === item.subcategory?.toLowerCase() &&
            p.s3url &&
            !existingUrls.has(p.s3url)
        );

        if (immediateMatch && immediateMatch.s3url) {
          s3url = immediateMatch.s3url;
          bucketName = immediateMatch.bucketName || '';
        } else {
          // Fallback to polling
          let refreshAttempt = 0;
          const maxRefreshAttempts = 5;
          let waitTime = 1000;
          let foundPhoto = false;

          while (!foundPhoto && refreshAttempt < maxRefreshAttempts) {
            await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
            try {
              const leadRes = await LeadService.workLead(item.leadId, userId);
              const refreshedLead = leadRes.data?.data || leadRes.data;
              if (refreshedLead?.salesPhotos && Array.isArray(refreshedLead.salesPhotos)) {
                const matched = [...refreshedLead.salesPhotos].reverse().find(
                  (p: any) =>
                    p.category?.toLowerCase() === item.categoryName?.toLowerCase() &&
                    p.subcategory?.toLowerCase() === item.subcategory?.toLowerCase() &&
                    p.s3url &&
                    !existingUrls.has(p.s3url)
                );
                if (matched && matched.s3url) {
                  s3url = matched.s3url;
                  bucketName = matched.bucketName || '';
                  foundPhoto = true;
                  break;
                }
              }
            } catch (err) {
              console.warn(`[UploadQueue] Refresh attempt ${refreshAttempt + 1} failed:`, err);
            }
            refreshAttempt++;
            waitTime = Math.min(waitTime + 1000, 5000);
          }
        }

        // Refresh React Query and WAIT for the lead to actually come back before
        // this item is retired from the queue (the caller shifts it as soon as we
        // return). `invalidateQueries` is fire-and-forget, so the optimistic queue
        // entry used to disappear while the server photo had not landed yet — the
        // count visibly dropped 1 → 0 → 1. Awaiting the refetch closes that gap so
        // the optimistic item hands over to real data with no flicker.
        try {
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          await queryClient.refetchQueries({ queryKey: ['lead', item.leadId] });
        } catch (qcErr) {
          console.warn('[UploadQueue] Failed to refresh queries:', qcErr);
        }

        logEvent('add', {
          user_id: userId,
          module_type: isAnnotated ? 'annotated_photos' : 'inspection_photo',
          created_by: userId,
          meta: {
            leadId: item.leadId,
            category: item.categoryName,
            subcategory: item.subcategory,
            timestamp: item.timestamp,
            coordinates: coords,
            size: 0,
            action: isAnnotated ? 'annotated_photo_uploaded' : 'photo_uploaded',
            image_url: s3url,
            imageData: {
              s3url,
              bucketName,
              category: item.categoryName,
              subcategory: item.subcategory,
              timestampTaken: item.timestamp,
              coordinates: coords,
            },
          },
        });
      }
    } catch (logErr) {
      console.warn('[UploadQueue] Analytics logging failed:', logErr);
    }


    // 4. Cleanup local cache file if applicable
    try {
      if (item.uri.includes('Cache') || item.uri.includes('tmp')) {
        const cleanPath = item.uri.replace('file://', '');
        await ReactNativeBlobUtil.fs.unlink(cleanPath);
      }
    } catch (cleanupError) {
      console.warn('[UploadQueue] Failed to delete temporary cache file:', cleanupError);
    }
  }
}

export const uploadQueueManager = new UploadQueueManager();
