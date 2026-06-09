import { storage } from './storage';
import Geolocation from 'react-native-geolocation-service';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { LeadService } from '../services/api/leads';

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

  public async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    console.log(`[UploadQueue] Processing started. Queue length: ${this.queue.length}`);

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
        const retryCount = (activeItem.retryCount || 0) + 1;
        console.error(`[UploadQueue] Upload failed for item: ${activeItem.id} (attempt ${retryCount}):`, error);

        if (retryCount >= 5) {
          // Permanent failure after 5 attempts — drop this item to unblock the queue
          console.warn(`[UploadQueue] Giving up on item ${activeItem.id} after ${retryCount} attempts. Dropping.`);
          this.queue.shift();
          this.saveQueue();
        } else {
          // Update retry count in place and persist
          this.queue[0] = { ...activeItem, retryCount };
          this.saveQueue();
          // Wait before retrying, using exponential backoff (5s, 10s, 20s...)
          const backoffMs = Math.min(5000 * retryCount, 30000);
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

    // 3. Upload S3 image
    await LeadService.uploadImages(item.leadId, formData);

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
