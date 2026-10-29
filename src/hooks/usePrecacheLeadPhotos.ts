import { useEffect, useMemo, useRef, useState } from 'react';
import { useSecureUrls } from './useSecureUrls';
import { useIsOnline } from './useIsOnline';
import { warmToLocalCache } from '../utils/imageFileCache';
import { uploadQueueManager } from '../utils/uploadQueue';
import { subscribeOfflineWork } from '../services/offlineLeadStore';
import { leadHasOfflineWork } from '../services/leadPhotoCache';
import { trackLeadPhotoUrls } from '../services/leadPhotoIndex';

export function usePrecacheLeadPhotos(lead: any, options: { enabled?: boolean } = {}) {
  let enabled = options.enabled ?? true;
  const isOnline = useIsOnline();
  const leadId: string | undefined = lead?._id || lead?.id;

  // ⚠️ Photos are saved to disk ONLY for a lead that has offline work. One worked online comes from the
  // server (the photos are already on S3), so saving it just filled the device with data that is
  // delivered. See utils/lead-photo-index.ts.
  const [hasOfflineWork, setHasOfflineWork] = useState(() => leadHasOfflineWork(leadId));
  useEffect(() => {
    const recheck = () => setHasOfflineWork(leadHasOfflineWork(leadId));
    recheck();
    const offQueue = uploadQueueManager.addListener(recheck);
    const offWork = subscribeOfflineWork(recheck);
    return () => {
      offQueue();
      offWork();
    };
  }, [leadId]);
  enabled = enabled && hasOfflineWork;

  const photos = useMemo(() => {
    if (!enabled || !isOnline || !leadId) return [];
    const raw = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    const seen = new Set<string>();
    const out: { s3url: string; bucketName?: string }[] = [];
    raw.forEach((p: any) => {
      if (!p?.s3url || seen.has(p.s3url)) return;
      if (p.deletedAt) return;
      seen.add(p.s3url);
      out.push({ s3url: p.s3url, bucketName: p.bucketName });
    });
    return out;
  }, [enabled, isOnline, leadId, lead?.salesPhotos]);

  const { data: secure } = useSecureUrls(photos.length ? photos : null);

  const warmedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !isOnline || !secure) return;

    const urls: string[] = [];
    Object.values(secure as Record<string, any[]>).forEach((list) =>
      (list || []).forEach((entry) => {
        if (entry?.uri && !warmedRef.current.has(entry.uri)) urls.push(entry.uri);
      })
    );
    if (!urls.length) return;

    let cancelled = false;
    urls.forEach((uri) => {
      warmedRef.current.add(uri);
      void warmToLocalCache(uri).then((local) => {
        if (local) trackLeadPhotoUrls(leadId, [uri]);
        if (cancelled || local) return;
        warmedRef.current.delete(uri);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, isOnline, secure, leadId]);

  useEffect(() => {
    warmedRef.current = new Set();
  }, [leadId]);
}
