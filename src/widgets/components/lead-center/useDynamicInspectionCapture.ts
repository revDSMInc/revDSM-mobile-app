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
import { uploadQueueManager } from '../../../utils/uploadQueue';
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
  getPhotos: (label: string, subcategory: string) => CapturedPhoto[];
  countUnderLabel: (label: string) => number;
  totalPhotos: number;
  capturedPreviews: Record<string, string>;
  uploadingKeys: Record<string, boolean>;
  deletingKeys: Record<string, boolean>;
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
  const [localExtras, setLocalExtras] = useState<Record<string, InspectionSlot[]>>({});
  // Optimistic previews for a just-captured photo, keyed by subKey(scopedLabel, storage).
  const [capturedPreviews, setCapturedPreviews] = useState<Record<string, string>>({});
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  const [deletingKeys, setDeletingKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  // s3urls we just deleted but that a briefly-stale lead refresh may still return.
  const pendingDeletesRef = useRef<Set<string>>(new Set());
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
      const photos = pending.size
        ? rawPhotos.filter((p) => !pending.has(p?.s3url))
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

      let secureMap: Record<string, string | null> = {};
      if (filePaths.length > 0) {
        setLoading(true);
        try {
          const res = await LeadService.getSecureUrls(filePaths);
          const data = res?.data?.data || res?.data || [];
          filePaths.forEach((fp, i) => {
            const entry = Array.isArray(data)
              ? data.find((d: any) => d?.filePath === fp.filePath) || data[i]
              : null;
            secureMap[`${fp.bucketName}:${fp.filePath}`] =
              entry?.secureUrl || entry?.url || null;
          });
        } catch (e) {
          secureMap = {};
        }
      }

      if (cancelled) return;

      const map: Record<string, CapturedPhoto[]> = {};
      scoped.forEach((p) => {
        const k = subKey(p.category, p.subcategory);
        if (!map[k]) map[k] = [];
        if (p.s3url && map[k].some((x) => x.s3url === p.s3url)) return;
        map[k].push({
          ...p,
          secureUrl: p.secureUrl || secureMap[`${p.bucketName}:${p.s3url}`] || null,
        });
      });

      setPhotosBySubcat(map);
      setLoading(false);

      // Clear optimistic previews / uploading flags for slots now backed by a
      // real server photo.
      setCapturedPreviews((prev) => {
        const next = { ...prev };
        let changed = false;
        Object.keys(prev).forEach((sk) => {
          if (map[sk] && map[sk].length > 0) {
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
  }, [salesPhotosSignature, index, productKey]);

  const getPhotos = useCallback(
    (label: string, subcategory: string): CapturedPhoto[] => {
      const sk = subKey(scopeCat(label), subcategory);
      const server = photosBySubcat[sk] || [];
      if (server.length > 0) return server;
      // Surface the optimistic preview so the slot shows filled immediately.
      const preview = capturedPreviews[sk];
      if (preview) {
        return [{ secureUrl: preview, subcategory, isOptimistic: true }];
      }
      return [];
    },
    [photosBySubcat, capturedPreviews, scopeCat]
  );

  const countUnderLabel = useCallback(
    (label: string) => {
      const prefix = `${norm(scopeCat(label))}||`;
      let n = 0;
      Object.entries(photosBySubcat).forEach(([k, arr]) => {
        if (k.startsWith(prefix)) n += arr.length;
      });
      return n;
    },
    [photosBySubcat, scopeCat]
  );

  const totalPhotos = useMemo(
    () => Object.values(photosBySubcat).reduce((n, arr) => n + arr.length, 0),
    [photosBySubcat]
  );

  // Extras derived from the server merged with locally-added, photo-less ones.
  const serverExtrasFor = useCallback(
    (category: InspectionCategory): InspectionSlot[] => {
      if (!category?.allowDynamicAdd) return [];
      const defined = index.definedNamesByLabel.get(norm(category.label)) || new Set<string>();
      const out: InspectionSlot[] = [];
      Object.keys(photosBySubcat).forEach((k) => {
        const [labelPart] = k.split('||');
        if (labelPart !== norm(scopeCat(category.label))) return;
        const sample = photosBySubcat[k]?.[0];
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
    [photosBySubcat, index, scopeCat]
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
      uploadQueueManager.addToQueue({
        leadId,
        categoryName: scopedCategory,
        subcategory,
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || `photo_${Date.now()}.jpg`,
        userId,
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
      if (!leadId || !photo?.s3url) return;
      const url = photo.s3url;
      if (key) setDeletingKeys((prev) => ({ ...prev, [key]: true }));
      try {
        await LeadService.deleteImage(leadId, { s3urls: [url], category: 'salesPhotos' });
        // Remove from the grid only after the server confirms; mark pending so a
        // briefly-stale refresh can't flash it back in.
        pendingDeletesRef.current.add(url);
        setPhotosBySubcat((prev) => {
          const k = subKey(scopeCat(categoryLabel), subcategory);
          return { ...prev, [k]: (prev[k] || []).filter((p) => p.s3url !== url) };
        });
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
    [leadId, scopeCat, refreshLeadData]
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
    uploadingKeys,
    deletingKeys,
    extrasFor,
    addExtra,
    removeExtra,
    tagAsExtraInCategory,
    captureToSlot,
    deletePhoto,
    progress,
  };
}
