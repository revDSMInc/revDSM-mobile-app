import { useEffect, useMemo, useRef } from 'react';
import { useSecureUrls } from './useSecureUrls';
import { useIsOnline } from './useIsOnline';
import { warmToLocalCache } from '../utils/imageFileCache';

/**
 * usePrecacheLeadPhotos — pull a lead's photos onto the device WHILE THERE IS STILL SIGNAL.
 *
 * ⚠️ This is the piece that makes photos actually present offline rather than merely cacheable.
 * Everything else warms lazily: `PhotoPeekPressable` downloads a photo the first time the rep
 * holds it, `InspectionPhotosPanel` when its section is opened. All of that happens at the moment
 * the rep looks — which offline is exactly too late. A rep in a basement, a rural driveway or a
 * parking garage opens the lead they drove to and the grid is empty.
 *
 * So when a lead is opened ONLINE, its photos are fetched in the background against the moment
 * they are not.
 *
 * ⚠️ Pre-signed S3 urls expire in 60 minutes, so what is kept is the BYTES, never the url —
 * `warmToLocalCache` writes a real file and later reads resolve to `file://`. Caching the url
 * would cache something guaranteed dead. (Section 6 of CLAUDE.md; this repo has hit it on three
 * separate tickets.)
 */
export function usePrecacheLeadPhotos(lead: any, { enabled = true }: { enabled?: boolean } = {}) {
  const isOnline = useIsOnline();
  const leadId: string | undefined = lead?._id || lead?.id;

  // Deduped by `s3url`: the same photo can appear under several categories, and a lead carries
  // annotated copies alongside their originals.
  const photos = useMemo(() => {
    if (!enabled || !isOnline || !leadId) return [];
    const raw = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    const seen = new Set<string>();
    const out: { s3url: string; bucketName?: string }[] = [];
    raw.forEach((p: any) => {
      if (!p?.s3url || seen.has(p.s3url)) return;
      // A deleted photo is still on the record but never rendered — downloading it would spend
      // the rep's data on something no screen can show.
      if (p.deletedAt) return;
      seen.add(p.s3url);
      out.push({ s3url: p.s3url, bucketName: p.bucketName });
    });
    return out;
  }, [enabled, isOnline, leadId, lead?.salesPhotos]);

  // ⚠️ Shares `useSecureUrls`' query key with the screens that render these photos, so the
  // signing round trip is made ONCE and pre-caching costs no extra request — it rides on a
  // response the Lead Center was fetching anyway.
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
    // Fire them all: `warmToLocalCache` holds its own 3-at-a-time semaphore, so this queues
    // behind — and never starves — the thumbnails the rep is actually looking at.
    urls.forEach((uri) => {
      warmedRef.current.add(uri);
      void warmToLocalCache(uri).then((local) => {
        // Not cancellation of the download (the bytes are worth keeping either way) — just a
        // guard so a failed warm on an unmounted screen is not retried forever.
        if (cancelled || local) return;
        warmedRef.current.delete(uri);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, isOnline, secure]);

  // A different lead means a different set; the guard is per-lead, not per-session.
  useEffect(() => {
    warmedRef.current = new Set();
  }, [leadId]);
}
