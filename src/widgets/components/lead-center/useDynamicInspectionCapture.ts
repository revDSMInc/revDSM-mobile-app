// ─── useDynamicInspectionCapture.ts ──────────────────────────────────────────
// Capture/upload/load/delete state for the DYNAMIC inspection photos flow
// (sales side, mobile). Adapted from the web reference
//   src/sections/job/components/dynamic-inspection-photos/use-dynamic-inspection-capture.js
//
// Differences from web (mobile parity, not divergence):
//  - Uploads go through the existing offline-capable MMKV upload queue
//    (`uploadQueueManager`) instead of a direct multipart POST, so photos taken
//    offline are queued and retried — the mobile app's core strength.
//  - Secure URLs are resolved via `LeadService.getSecureUrls`; deletes via
//    `LeadService.deleteImage` (both already used across the lead-center).
//  - Photos are the single source of truth from `lead.salesPhotos`; a lead
//    refetch (query invalidation from the queue) re-resolves the grid.
//
// Photos are addressed type-agnostically by (product-scoped category label,
// storageName). Any category type resolves its slot to that pair, so nothing
// schema-specific is persisted.
//
// NOTE (deferred vs web): move-photo and annotated sections are NOT implemented
// here — see the web file above for `movePhoto` / `getAnnotatedFor`. Core capture,
// categorized display, delete, and local tag-as-extra are complete.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LeadService } from '../../../services/api/leads';
import { queryClient } from '../../../services/api/queryClient';
import {
  indexPendingBySlot,
  mergePendingForSlot,
} from '../../../utils/pending-inspection-photos';
import { uploadQueueManager } from '../../../utils/uploadQueue';
import { offlinePhotoDeleteQueue } from '../../../services/offlinePhotoDeleteQueue';
import { resolveDeleteTarget } from '../../../utils/offline-photo-deletes';
import { isOnline } from '../../../services/connectivity';
import { getCaptureCoords } from '../../../utils/capture-location';
import { useIsOnline } from '../../../hooks/useIsOnline';
import { resolveS3Url } from '../../../utils/s3-utils';
import { logEvent } from '../../../services/api/LoggerService';
import {
  indexSchema,
  getCapturableSlots,
  norm,
  uiKey,
  extraSlotId,
  nextExtraLabel,
  type InspectionCategory,
  type InspectionSlot,
  type SchemaIndex,
} from './dynamic-inspection-schema-utils';

const subKey = (label: string, subcategory: string) => `${norm(label)}||${norm(subcategory)}`;

export interface CapturedPhoto {
  s3url?: string;
  bucketName?: string;
  category?: string;
  subcategory?: string;
  secureUrl?: string | null;
  timestampTaken?: string;
  coordinates?: any;
  _id?: string;
  isOptimistic?: boolean;
  [key: string]: any;
}

interface CaptureAsset {
  uri: string;
  type?: string;
  fileName?: string;
}

interface UseDynamicInspectionCaptureArgs {
  lead: any;
  categories: InspectionCategory[];
  productKey?: string;
  userId?: string;
  refreshLeadData?: (leadId: string) => void | Promise<void>;
}

const dedupeExtras = (...lists: (InspectionSlot | InspectionSlot[])[]): InspectionSlot[] => {
  const seen = new Set<string>();
  const out: InspectionSlot[] = [];
  lists.flat().forEach((e) => {
    if (!e) return;
    const k = norm(e.name);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  return out;
};

export interface DynamicInspectionCapture {
  leadId: string | undefined;
  loading: boolean;
  /** Live connectivity. Views use it to avoid claiming an upload is moving when nothing is. */
  online: boolean;
  getPhotos: (label: string, subcategory: string) => CapturedPhoto[];
  countUnderLabel: (label: string) => number;
  totalPhotos: number;
  capturedPreviews: Record<string, string>;
  uploadingKeys: Record<string, boolean>;
  deletingKeys: Record<string, boolean>;
  movingKeys: Record<string, boolean>;
  extrasFor: (category: InspectionCategory) => InspectionSlot[];
  addExtra: (category: InspectionCategory) => void;
  removeExtra: (category: InspectionCategory, extra: InspectionSlot) => void;
  tagAsExtraInCategory: (args: { category: InspectionCategory; asset: CaptureAsset }) => void;
  captureToSlot: (args: {
    categoryLabel: string;
    subcategory: string;
    key: string;
    asset: CaptureAsset;
  }) => void;
  deletePhoto: (args: {
    categoryLabel: string;
    subcategory: string;
    key: string;
    photo: CapturedPhoto;
  }) => Promise<void>;
  movePhoto: (args: {
    photo: CapturedPhoto;
    fromCategoryLabel: string;
    fromSubcategory: string;
    toCategoryLabel: string;
    toSubcategory: string;
    key?: string;
    /**
     * The photo's REAL stored category, used verbatim instead of `scopeCat(fromCategoryLabel)`.
     *
     * ⚠️ For an ORPHAN ("+ UNSORTED") the stored category is not scoped to a product — it is a
     * bare legacy name like `"Home"` — so scoping it would send a `currentPosition` that
     * matches nothing and the move would silently fail. The TO side is always scoped, which is
     * exactly what re-files the photo into the schema.
     */
    fromCategoryAbsolute?: string;
  }) => Promise<void>;
  getAnnotatedFor: (label: string) => { subcategory: string; photo: CapturedPhoto }[];
  progress: { total: number; filled: number; percent: number };
}

export function useDynamicInspectionCapture({
  lead,
  categories,
  productKey,
  userId,
  refreshLeadData,
}: UseDynamicInspectionCaptureArgs): DynamicInspectionCapture {
  const leadId: string | undefined = lead?._id || lead?.id;

  const index: SchemaIndex = useMemo(() => indexSchema(categories), [categories]);

  // Photos are stored/loaded per product: the saved salesPhoto.category is
  // prefixed with the product so each product owns its own images.
  const scopeCat = useCallback(
    (label: string) => (productKey ? `${productKey} — ${label}` : label),
    [productKey]
  );

  const [photosBySubcat, setPhotosBySubcat] = useState<Record<string, CapturedPhoto[]>>({});

  // ── not-yet-uploaded photos ────────────────────────────────────────────────
  // `capturedPreviews` below shows a just-shot photo instantly, but it is state on ONE mount of
  // this hook — and Manage Photos mounts its own. Offline there is nothing on the server yet, so
  // that screen rendered 0 photos and every tab 0/N for a lead the rep had just shot three times.
  // The MMKV upload queue is the source that survives the modal boundary and an app restart.
  const online = useIsOnline();
  // Deletes filed offline. Every read below subtracts them, or the server keeps returning a photo
  // the rep has already removed and the delete appears to undo itself on the next refetch.
  const [deletedUrls, setDeletedUrls] = useState<Set<string>>(() =>
    offlinePhotoDeleteQueue.deletedUrls(leadId)
  );
  useEffect(() => {
    const sync = () => setDeletedUrls(offlinePhotoDeleteQueue.deletedUrls(leadId));
    sync();
    return offlinePhotoDeleteQueue.addListener(sync);
  }, [leadId]);

  const [pendingUploads, setPendingUploads] = useState(() => uploadQueueManager.getQueue());
  useEffect(() => {
    setPendingUploads([...uploadQueueManager.getQueue()]);
    return uploadQueueManager.addListener(() => {
      setPendingUploads([...uploadQueueManager.getQueue()]);
    });
  }, []);
  const pendingBySlot = useMemo(
    () => indexPendingBySlot(pendingUploads as any, leadId),
    [pendingUploads, leadId]
  );

  /**
   * The display source for every read below — server photos with any pending upload the server
   * does not yet account for folded in, per slot.
   *
   * ⚠️ Reads only. `deletePhoto` / `movePhoto` still write through `setPhotosBySubcat`: a queued
   * photo has no `_id` and no `s3url`, so there is nothing for those endpoints to address.
   */
  const displayPhotos = useMemo(() => {
    if (pendingBySlot.size === 0) return photosBySubcat;
    const next: Record<string, CapturedPhoto[]> = { ...photosBySubcat };
    pendingBySlot.forEach((items, slot) => {
      next[slot] = mergePendingForSlot(photosBySubcat[slot], items) as CapturedPhoto[];
    });
    return next;
  }, [photosBySubcat, pendingBySlot]);
  const [localExtras, setLocalExtras] = useState<Record<string, InspectionSlot[]>>({});
  // Optimistic previews for a just-captured photo, keyed by subKey(scopedLabel, storage).
  const [capturedPreviews, setCapturedPreviews] = useState<Record<string, string>>({});
  // Mirror of `capturedPreviews` for the resolve effect (whose deps don't include it),
  // so a just-captured LOCAL uri can back the server photo instantly.
  const capturedPreviewsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    capturedPreviewsRef.current = capturedPreviews;
  }, [capturedPreviews]);
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  const [deletingKeys, setDeletingKeys] = useState<Record<string, boolean>>({});
  const [movingKeys, setMovingKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  // s3urls we just deleted but that a briefly-stale lead refresh may still return.
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  // s3url -> destination subKey for a just-moved photo. Until a refetch reports the
  // photo at its NEW position, an eventually-consistent replica may still return it
  // at the OLD position; this guard drops those stale copies so the photo doesn't
  // flash back into the original slot (it stays optimistically in the new one).
  const pendingMovesRef = useRef<Map<string, string>>(new Map());
  // Monotonic cache of every server-confirmed photo we've ever seen (keyed by
  // subKey, deduped by s3url). The backend is eventually consistent: right after
  // an upload, some lead refetches come back from a replica that does NOT yet
  // have the new photo. Rebuilding purely from such a refetch would blank a slot
  // that was just filled — the "active → inactive → active" flicker. So the
  // displayed map is the UNION of this cache and the fresh lead; a photo only
  // leaves the cache on an explicit in-app delete (pendingDeletesRef), never on a
  // transient empty read. This is also what guarantees no tagged photo is missed.
  const knownPhotosRef = useRef<Record<string, CapturedPhoto[]>>({});
  // subKey -> uiKey, so when a server photo arrives we can clear the right uploading flag.
  const pendingUploadKeyRef = useRef<Record<string, string>>({});

  // Only reload when the lead's photos actually change.
  const salesPhotosSignature = useMemo(() => {
    const photos = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    return photos
      .map((p: any) => `${p?.s3url || ''}:${p?.category || ''}:${p?.subcategory || ''}`)
      .join('|');
  }, [lead?.salesPhotos]);

  // Load + resolve secure URLs for photos whose category belongs to this schema.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const rawPhotos: any[] = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];

      // Drop any photo we just deleted that the server still returns.
      const pending = pendingDeletesRef.current;
      if (pending.size) {
        const stillReturned = new Set(rawPhotos.map((p) => p?.s3url).filter(Boolean));
        pending.forEach((u) => {
          if (!stillReturned.has(u)) pending.delete(u);
        });
      }
      // ⚠️ BOTH sets. `pendingDeletesRef` is in-memory and covers the online delete still
      // settling; `deletedUrls` is the MMKV queue and is the only one that survives a remount,
      // a screen change or an app restart — which is exactly the span an offline delete has to
      // last. Subtracting only the first made a photo deleted offline reappear the moment the
      // rep reopened Manage Photos.
      const suppressed = deletedUrls;
      const photos =
        pending.size || suppressed.size
          ? rawPhotos.filter((p) => !pending.has(p?.s3url) && !suppressed.has(p?.s3url))
          : rawPhotos;

      const pfx = productKey ? `${productKey} — ` : '';
      const expectedCats = new Set(index.leafCategories.map((c) => norm(`${pfx}${c.label}`)));
      const scoped = photos.filter(
        (p) => p && (p.s3url || p.secureUrl) && expectedCats.has(norm(p.category))
      );

      const filePaths: { bucketName: string; filePath: string }[] = [];
      scoped.forEach((p) => {
        if (p.bucketName && p.s3url) filePaths.push({ bucketName: p.bucketName, filePath: p.s3url });
      });

      // Build the displayed photo map for a given signed-URL map. The `secureUrl`
      // falls back to the just-captured LOCAL preview (always renders) and then a
      // direct S3 url, so a photo shows INSTANTLY without waiting on the signed-URL
      // round trip — that wait is what made added photos "take time to come".
      const buildMap = (secureMap: Record<string, string | null>) => {
        const fresh: Record<string, CapturedPhoto[]> = {};
        scoped.forEach((p) => {
          const k = subKey(p.category, p.subcategory);
          // A just-moved photo: if this (possibly stale) refetch still reports it at
          // the OLD slot, drop it so it doesn't flash back; once it appears at the new
          // slot the guard clears and normal handling resumes.
          if (p.s3url && pendingMovesRef.current.has(p.s3url)) {
            const target = pendingMovesRef.current.get(p.s3url);
            if (k === target) pendingMovesRef.current.delete(p.s3url);
            else return;
          }
          if (!fresh[k]) fresh[k] = [];
          if (p.s3url && fresh[k].some((x) => x.s3url === p.s3url)) return;
          fresh[k].push({
            ...p,
            secureUrl:
              p.secureUrl ||
              secureMap[`${p.bucketName}:${p.s3url}`] ||
              capturedPreviewsRef.current[k] || // just-captured local uri (always loads)
              resolveS3Url(p.s3url), // direct S3 url so the tile never sits empty
          });
        });

        // Merge fresh photos into the monotonic cache: a transient refetch that is
        // missing a photo must NOT drop it, but a fresh copy DOES refresh a stale
        // one (e.g. a newly-resolved secureUrl). Explicitly-deleted s3urls are
        // pruned so real deletions still take effect.
        const merged: Record<string, CapturedPhoto[]> = {};
        const allKeys = new Set([...Object.keys(knownPhotosRef.current), ...Object.keys(fresh)]);
        allKeys.forEach((k) => {
          const list: CapturedPhoto[] = [];
          const push = (p: CapturedPhoto) => {
            if (p.s3url && pending.has(p.s3url)) return; // just deleted
            const idx = p.s3url ? list.findIndex((e) => e.s3url && e.s3url === p.s3url) : -1;
            if (idx >= 0) {
              const existing = list[idx];
              const incomingUrl = p.secureUrl || '';
              const existingUrl = existing.secureUrl || '';
              const rawS3 = resolveS3Url(p.s3url);
              const isIncomingFallback = !incomingUrl || incomingUrl === rawS3;
              const isExistingValid = existingUrl && existingUrl !== rawS3;

              list[idx] = {
                ...p,
                secureUrl: (isIncomingFallback && isExistingValid) ? existingUrl : incomingUrl,
              };
            } else {
              list.push(p);
            }
          };
          (knownPhotosRef.current[k] || []).forEach(push);
          (fresh[k] || []).forEach(push);
          if (list.length) merged[k] = list;
        });
        return merged;
      };

      // ── Phase 1: render INSTANTLY from the local preview / direct S3 url. ──
      if (cancelled) return;
      const immediate = buildMap({});
      knownPhotosRef.current = immediate;
      setPhotosBySubcat(immediate);

      // ── Phase 2: resolve the real signed URLs in the background, swap them in. ──
      if (filePaths.length > 0) {
        setLoading(true);
        const secureMap: Record<string, string | null> = {};
        try {
          const res = await LeadService.getSecureUrls(filePaths);
          const data = res?.data?.data || res?.data || [];
          filePaths.forEach((fp, i) => {
            const entry = Array.isArray(data)
              ? data.find((d: any) => d?.filePath === fp.filePath) || data[i]
              : null;
            secureMap[`${fp.bucketName}:${fp.filePath}`] = entry?.secureUrl || entry?.url || null;
          });
        } catch (e) {
          // keep the phase-1 fallbacks
        }
        if (cancelled) return;
        const signed = buildMap(secureMap);
        knownPhotosRef.current = signed;
        setPhotosBySubcat(signed);
      }
      setLoading(false);

      // Clear optimistic previews / uploading flags for slots now backed by a real
      // server photo (runs after phase 2 so the preview persists until then).
      const finalMap = knownPhotosRef.current;
      setCapturedPreviews((prev) => {
        const next = { ...prev };
        let changed = false;
        Object.keys(prev).forEach((sk) => {
          if (finalMap[sk] && finalMap[sk].length > 0) {
            delete next[sk];
            changed = true;
            const key = pendingUploadKeyRef.current[sk];
            if (key) {
              setUploadingKeys((u) => {
                const un = { ...u };
                delete un[key];
                return un;
              });
              delete pendingUploadKeyRef.current[sk];
            }
          }
        });
        return changed ? next : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // ⚠️ `deletedUrls` is in the deps on purpose: filing an offline delete must re-run this
    // effect, or the row the rep just removed stays on screen until something else happens to
    // invalidate the lead — which offline is nothing at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesPhotosSignature, index, productKey, deletedUrls]);

  const getPhotos = useCallback(
    (label: string, subcategory: string): CapturedPhoto[] => {
      const sk = subKey(scopeCat(label), subcategory);
      const server = displayPhotos[sk] || [];
      if (server.length > 0) return server;
      // Surface the optimistic preview so the slot shows filled immediately.
      const preview = capturedPreviews[sk];
      if (preview) {
        return [{ secureUrl: preview, subcategory, isOptimistic: true }];
      }
      return [];
    },
    [displayPhotos, capturedPreviews, scopeCat]
  );

  const countUnderLabel = useCallback(
    (label: string) => {
      const prefix = `${norm(scopeCat(label))}||`;
      let n = 0;
      Object.entries(displayPhotos).forEach(([k, arr]) => {
        if (k.startsWith(prefix)) n += arr.length;
      });
      return n;
    },
    [displayPhotos, scopeCat]
  );

  const totalPhotos = useMemo(
    () => Object.values(displayPhotos).reduce((n, arr) => n + arr.length, 0),
    [displayPhotos]
  );

  // Extras derived from the server merged with locally-added, photo-less ones.
  const serverExtrasFor = useCallback(
    (category: InspectionCategory): InspectionSlot[] => {
      if (!category?.allowDynamicAdd) return [];
      const defined = index.definedNamesByLabel.get(norm(category.label)) || new Set<string>();
      const out: InspectionSlot[] = [];
      Object.keys(displayPhotos).forEach((k) => {
        const [labelPart] = k.split('||');
        if (labelPart !== norm(scopeCat(category.label))) return;
        const sample = displayPhotos[k]?.[0];
        const subcat = sample?.subcategory;
        if (!subcat || defined.has(norm(subcat))) return;
        if (subcat.toLowerCase().includes('(annotated)')) return;
        out.push({
          id: extraSlotId(subcat),
          name: subcat,
          storageName: subcat,
          key: uiKey(category.id, extraSlotId(subcat)),
          isExtra: true,
        });
      });
      return out;
    },
    [displayPhotos, index, scopeCat]
  );

  const extrasFor = useCallback(
    (category: InspectionCategory): InspectionSlot[] =>
      dedupeExtras(serverExtrasFor(category), localExtras[category.id] || []),
    [serverExtrasFor, localExtras]
  );

  const buildExtraSlot = useCallback(
    (category: InspectionCategory): InspectionSlot | null => {
      if (!category?.id) return null;
      const combined = dedupeExtras(serverExtrasFor(category), localExtras[category.id] || []);
      const name = nextExtraLabel(combined);
      return {
        id: extraSlotId(name),
        name,
        storageName: name,
        key: uiKey(category.id, extraSlotId(name)),
        isExtra: true,
      };
    },
    [serverExtrasFor, localExtras]
  );

  const addExtra = useCallback(
    (category: InspectionCategory) => {
      const extra = buildExtraSlot(category);
      if (!extra) return;
      setLocalExtras((prev) => ({
        ...prev,
        [category.id]: [...(prev[category.id] || []), extra],
      }));
    },
    [buildExtraSlot]
  );

  const removeExtra = useCallback(
    (category: InspectionCategory, extra: InspectionSlot) => {
      if (getPhotos(category.label, extra.storageName).length > 0) return; // has photos
      setLocalExtras((prev) => ({
        ...prev,
        [category.id]: (prev[category.id] || []).filter((e) => e.id !== extra.id),
      }));
    },
    [getPhotos]
  );

  const captureToSlot = useCallback(
    ({
      categoryLabel,
      subcategory,
      key,
      asset,
    }: {
      categoryLabel: string;
      subcategory: string;
      key: string;
      asset: CaptureAsset;
    }) => {
      if (!leadId || !asset?.uri || !categoryLabel || !subcategory) return;
      const scopedCategory = scopeCat(categoryLabel);
      const sk = subKey(scopedCategory, subcategory);

      // Optimistic preview + uploading flag.
      setCapturedPreviews((prev) => ({ ...prev, [sk]: asset.uri }));
      setUploadingKeys((prev) => ({ ...prev, [key]: true }));
      pendingUploadKeyRef.current[sk] = key;

      // Push to the persistent, offline-capable MMKV upload queue. The queue
      // invalidates ['lead', leadId] on success, which refreshes the lead prop
      // and, via the load effect, clears the optimistic preview.
      //
      // ⚠️ The coordinates are resolved HERE, where the rep is standing — not by the queue at
      // upload time, which offline can be hours later and miles away. `getCaptureCoords` reads a
      // warm cache and never rejects, so this does not hold up the queue push; a photo with no
      // fix is still queued, just without coordinates.
      void getCaptureCoords().then((coords) => {
        uploadQueueManager.addToQueue({
          leadId,
          categoryName: scopedCategory,
          subcategory,
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || `photo_${Date.now()}.jpg`,
          userId,
          ...(coords ? { coordinates: coords } : null),
        });
      });
    },
    [leadId, scopeCat, userId]
  );

  const tagAsExtraInCategory = useCallback(
    ({ category, asset }: { category: InspectionCategory; asset: CaptureAsset }) => {
      const extra = buildExtraSlot(category);
      if (!extra || !asset) return;
      setLocalExtras((prev) => ({
        ...prev,
        [category.id]: [...(prev[category.id] || []), extra],
      }));
      captureToSlot({
        categoryLabel: category.label,
        subcategory: extra.storageName,
        key: extra.key as string,
        asset,
      });
    },
    [buildExtraSlot, captureToSlot]
  );

  const deletePhoto = useCallback(
    async ({
      categoryLabel,
      subcategory,
      key,
      photo,
    }: {
      categoryLabel: string;
      subcategory: string;
      key: string;
      photo: CapturedPhoto;
    }) => {
      if (!leadId) return;

      // What this delete actually MEANS. A photo shot offline is only in the upload queue, so
      // there is nothing on the server to remove — dropping the queue item IS the delete, and
      // filing a server delete for it would address an s3url that does not exist.
      const target = resolveDeleteTarget(photo as any);
      if (target.kind === 'nothing') return;

      if (target.kind === 'queued-upload') {
        if (key) setDeletingKeys((prev) => ({ ...prev, [key]: true }));
        try {
          uploadQueueManager.dropQueuedItem(target.pendingId);
          // No optimistic prune needed: the row came FROM the queue, so removing the item
          // removes the card on the queue's own listener tick.
        } finally {
          if (key)
            setDeletingKeys((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
        }
        return;
      }

      const url = target.s3url;
      if (key) setDeletingKeys((prev) => ({ ...prev, [key]: true }));

      // ── Offline: hide it now, file the delete for replay. ────────────────────────────────
      // ⚠️ The local prune MUST happen for the offline arm too. The server still returns the
      // photo until the replay lands, so without subtracting it the row reappears on the next
      // read and the rep sees the delete "undo itself".
      if (!isOnline()) {
        pendingDeletesRef.current.add(url);
        const dkOff = subKey(scopeCat(categoryLabel), subcategory);
        knownPhotosRef.current = {
          ...knownPhotosRef.current,
          [dkOff]: (knownPhotosRef.current[dkOff] || []).filter((p) => p.s3url !== url),
        };
        setPhotosBySubcat((prev) => ({
          ...prev,
          [dkOff]: (prev[dkOff] || []).filter((p) => p.s3url !== url),
        }));
        offlinePhotoDeleteQueue.enqueue({
          leadId,
          s3url: url,
          category: 'salesPhotos',
          categoryName: photo.category || categoryLabel,
          subcategory: photo.subcategory || subcategory,
          userId,
        });
        if (key)
          setDeletingKeys((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        return;
      }

      try {
        await LeadService.deleteImage(leadId, { s3urls: [url], category: 'salesPhotos' });

        // Activity log — web parity with `logPhotoDelete`. The stored photo
        // carries its own fully-scoped category/subcategory, so read them off the
        // photo (falling back to the passed args). `(annotated)` copies log under
        // the annotated module, exactly as upload does.
        const logCategory = photo.category || categoryLabel;
        const logSub = photo.subcategory || subcategory;
        const isAnnotated = String(logSub || '').toLowerCase().includes('(annotated)');
        if (userId) {
          logEvent('delete', {
            user_id: userId,
            created_by: userId,
            module_type: isAnnotated ? 'annotated_photos' : 'inspection_photo',
            meta: {
              leadId,
              category: logCategory,
              subcategory: logSub,
              timestamp: photo.timestampTaken || new Date().toISOString(),
              coordinates: photo.coordinates || null,
              size: (photo as any).size || 0,
              action: 'deleted_image',
              imageData: {
                s3url: photo.s3url,
                bucketName: photo.bucketName,
                category: photo.category,
                subcategory: photo.subcategory,
                timestampTaken: photo.timestampTaken,
                coordinates: photo.coordinates || null,
              },
            },
          });
        }

        // Remove from the grid only after the server confirms; mark pending so a
        // briefly-stale refresh can't flash it back in.
        pendingDeletesRef.current.add(url);
        const dk = subKey(scopeCat(categoryLabel), subcategory);
        // Prune the monotonic cache too, else the union would resurrect it.
        knownPhotosRef.current = {
          ...knownPhotosRef.current,
          [dk]: (knownPhotosRef.current[dk] || []).filter((p) => p.s3url !== url),
        };
        setPhotosBySubcat((prev) => ({
          ...prev,
          [dk]: (prev[dk] || []).filter((p) => p.s3url !== url),
        }));
        try {
          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['leads'] });
        } catch (e) {
          /* noop */
        }
        await refreshLeadData?.(leadId);
      } catch (error) {
        await refreshLeadData?.(leadId); // restore truth
      } finally {
        if (key)
          setDeletingKeys((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
      }
    },
    [leadId, scopeCat, refreshLeadData, userId]
  );

  // Move a stored photo to a different slot (category/subcategory) without
  // re-shooting it. Reuses the image-position endpoint, which re-tags the
  // salesPhoto and re-files the S3 object when the subcategory changes. Both
  // source and target are addressed the same way capture uses everywhere:
  // product-scoped category label + storageName. Port of web `movePhoto`.
  //
  // Deliberately NOT optimistic (web parity): nothing touches photosBySubcat, so
  // the moved photo re-resolves into its new slot purely from the lead refresh.
  const movePhoto = useCallback(
    async ({
      photo,
      fromCategoryLabel,
      fromSubcategory,
      toCategoryLabel,
      toSubcategory,
      key,
      fromCategoryAbsolute,
    }: {
      photo: CapturedPhoto;
      fromCategoryLabel: string;
      fromSubcategory: string;
      toCategoryLabel: string;
      toSubcategory: string;
      key?: string;
      fromCategoryAbsolute?: string;
    }) => {
      // The endpoint is id-based. The salesPhoto identifier is inconsistent across
      // the API — some payloads expose `_id`, some `id` (the regular/static move in
      // JobDocsSection uses `.id`). Guarding on `_id` ALONE made the move silently
      // no-op whenever the photo only carried `id`, so the photo appeared to "not
      // move". Accept either.
      const photoId = photo?._id || (photo as any)?.id;
      if (!leadId || !photoId) return;
      // An orphan's category is already absolute (and unscoped); a normal card's needs scoping.
      const fromCatAbs = fromCategoryAbsolute || scopeCat(fromCategoryLabel);
      if (
        norm(fromCatAbs) === norm(scopeCat(toCategoryLabel)) &&
        norm(fromSubcategory) === norm(toSubcategory)
      ) {
        return; // same slot — nothing to do
      }
      if (key) setMovingKeys((prev) => ({ ...prev, [key]: true }));

      // Optimistically relocate the photo so the rep sees it in the destination slot
      // immediately (web relies on a fast refetch; on mobile the refetch can lag, so
      // without this the photo looked like it "didn't move"). The refetch below
      // reconciles to server truth; `pendingMovesRef` stops a stale replica read from
      // flashing it back to the old slot in the meantime.
      const fromK = subKey(fromCatAbs, fromSubcategory);
      const toK = subKey(scopeCat(toCategoryLabel), toSubcategory);
      const movedPhoto = { ...photo, category: scopeCat(toCategoryLabel), subcategory: toSubcategory };
      const relocate = (m: Record<string, CapturedPhoto[]>): Record<string, CapturedPhoto[]> => {
        const next = { ...m };
        const stripped = (next[fromK] || []).filter((p) => p.s3url !== photo.s3url);
        if (stripped.length) next[fromK] = stripped;
        else delete next[fromK];
        const dest = (next[toK] || []).filter((p) => p.s3url !== photo.s3url);
        dest.push(movedPhoto);
        next[toK] = dest;
        return next;
      };
      if (photo.s3url) pendingMovesRef.current.set(photo.s3url, toK);
      knownPhotosRef.current = relocate(knownPhotosRef.current);
      setPhotosBySubcat((prev) => relocate(prev));

      try {
        await LeadService.updateImagePosition(leadId, {
          photoId,
          currentPosition: {
            category: fromCatAbs,
            subcategory: fromSubcategory,
          },
          newPosition: {
            category: scopeCat(toCategoryLabel),
            subcategory: toSubcategory,
          },
        });
        try {
          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['leads'] });
        } catch {
          /* noop */
        }
        await refreshLeadData?.(leadId);
      } catch {
        // Move failed — drop the optimistic guard so the refetch can restore the
        // photo to its real (original) slot instead of stranding it in the target.
        if (photo.s3url) pendingMovesRef.current.delete(photo.s3url);
        await refreshLeadData?.(leadId); // restore truth
      } finally {
        if (key)
          setMovingKeys((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
      }
    },
    [leadId, scopeCat, refreshLeadData]
  );

  // Every stored photo under this category label whose subcategory marks it as
  // annotated (created by the annotation editor), regardless of slot config.
  // Returns [{ subcategory, photo }] for the "+ ANNOTATED" section. Port of web
  // `getAnnotatedFor` — scans every subKey under the product-scoped label.
  const getAnnotatedFor = useCallback(
    (label: string): { subcategory: string; photo: CapturedPhoto }[] => {
      const prefix = `${norm(scopeCat(label))}||`;
      const out: { subcategory: string; photo: CapturedPhoto }[] = [];
      Object.entries(photosBySubcat).forEach(([k, arr]) => {
        if (!k.startsWith(prefix)) return;
        (arr || []).forEach((photo) => {
          const sub = photo?.subcategory || '';
          if (sub.toLowerCase().includes('(annotated)')) out.push({ subcategory: sub, photo });
        });
      });
      return out;
    },
    [photosBySubcat, scopeCat]
  );

  // Header progress over defined slots + extras (context-selector excluded).
  const progress = useMemo(() => {
    let total = 0;
    let filled = 0;
    index.leafCategories.forEach((cat) => {
      getCapturableSlots(cat).forEach((slot) => {
        total += 1;
        if (getPhotos(cat.label, slot.storageName).length > 0) filled += 1;
      });
      extrasFor(cat).forEach((extra) => {
        total += 1;
        if (getPhotos(cat.label, extra.storageName).length > 0) filled += 1;
      });
    });
    return { total, filled, percent: total === 0 ? 0 : Math.round((filled / total) * 100) };
  }, [index.leafCategories, getPhotos, extrasFor]);

  return {
    leadId,
    loading,
    getPhotos,
    countUnderLabel,
    totalPhotos,
    capturedPreviews,
    online,
    uploadingKeys,
    deletingKeys,
    movingKeys,
    extrasFor,
    addExtra,
    removeExtra,
    tagAsExtraInCategory,
    captureToSlot,
    deletePhoto,
    movePhoto,
    getAnnotatedFor,
    progress,
  };
}
