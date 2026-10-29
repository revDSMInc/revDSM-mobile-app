import { storage } from '../utils/storage';
import { getLocalCachePath } from '../utils/imageFileCache';
import { LeadPhotoIndex, trackPaths } from '../utils/lead-photo-index';

const KEY = 'lead_photo_cache_index';

export const readLeadPhotoIndex = (): LeadPhotoIndex => {
  try {
    const saved = storage.getString(KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const writeLeadPhotoIndex = (index: LeadPhotoIndex): void => {
  try {
    storage.set(KEY, JSON.stringify(index));
  } catch (e) {
    console.warn('[leadPhotoIndex] could not save the index', e);
  }
};

/** Remember that these remote photo urls now have a file on disk that belongs to `leadId`. */
export const trackLeadPhotoUrls = (leadId: string | undefined, urls: Array<string | null | undefined>): void => {
  if (!leadId) return;
  const paths = urls.map((u) => (u ? getLocalCachePath(u) : null)).filter(Boolean) as string[];
  if (!paths.length) return;
  writeLeadPhotoIndex(trackPaths(readLeadPhotoIndex(), leadId, paths));
};
