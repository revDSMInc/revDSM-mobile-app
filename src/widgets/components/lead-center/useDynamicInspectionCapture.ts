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
import { cachedFetch, OFFLINE_CACHE } from '../../../utils/offline-query-cache';
import { hashString } from '../../../utils/imageFileCache';
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

  const scopeCat = useCallback(
    (label: string) => (productKey ? `${productKey} — ${label}` : label),
    [productKey]
  );

  const [photosBySubcat, setPhotosBySubcat] = useState<Record<string, CapturedPhoto[]>>({});

  const online = useIsOnline();
  const [deletedUrls, setDeletedUrls] = useState<Set<string>>(() =>
    offlinePhotoDeleteQueue.deletedUrls(leadId)
  );
  useEffect(() => {
    const sync = () => setDeletedUrls(offlinePhotoDeleteQueue.deletedUrls(leadId));
    sync();
    return offlinePhotoDeleteQueue.addListener(sync);
  }, [leadId]);

  const [pendingUploads, setPendingUploads] = useState(() => uploadQueueManager.getQueue());
  const pendingBySlot = useMemo(
    () => indexPendingBySlot(pendingUploads as any, leadId),
    [pendingUploads, leadId]
  );

  const displayPhotos = useMemo(() => {
    if (pendingBySlot.size === 0) return photosBySubcat;
    const next: Record<string, CapturedPhoto[]> = { ...photosBySubcat };
    pendingBySlot.forEach((items, slot) => {
      next[slot] = mergePendingForSlot(photosBySubcat[slot], items) as CapturedPhoto[];
    });
    return next;
  }, [photosBySubcat, pendingBySlot]);
  const [localExtras, setLocalExtras] = useState<Record<string, InspectionSlot[]>>({});
  const [capturedPreviews, setCapturedPreviews] = useState<Record<string, string>>({});
  const capturedPreviewsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    capturedPreviewsRef.current = capturedPreviews;
  }, [capturedPreviews]);
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  const [deletingKeys, setDeletingKeys] = useState<Record<string, boolean>>({});
  const [movingKeys, setMovingKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const pendingMovesRef = useRef<Map<string, string>>(new Map());
  const knownPhotosRef = useRef<Record<string, CapturedPhoto[]>>({});
  const pendingUploadKeyRef = useRef<Record<string, string>>({});

  useEffect(() => {
    /**
     * ⚠️ The QUEUE is the spinner's authority, not `uploadingKeys`.
     *
     * `uploadingKeys[key]` is an optimistic flag set at capture time, and it used to be
     * cleared in exactly ONE place: the effect keyed on `salesPhotosSignature`. If that
     * refetch returned stale data, failed, or the photo came back under a slightly different
     * subcategory, the signature never changed and nothing else ever cleared the flag - the
     * slot span for the rest of the session ("Back was uploaded before and the loader is
     * still showing"). A spinner must never depend on a single success path.
     *
     * Once an item has left the queue it is no longer uploading, whatever the server says, so
     * this listener clears the flag too. Both paths clear it; neither is required.
     */
    const sync = () => {
      const queue = uploadQueueManager.getQueue();
      setPendingUploads([...queue]);

      const stillQueued = new Set(
        queue
          .filter((it: any) => it.leadId === leadId)
          .map((it: any) => subKey(it.categoryName, it.subcategory))
      );
      setUploadingKeys((prev) => {
        const next = { ...prev };
        let changed = false;
        Object.entries(pendingUploadKeyRef.current).forEach(([sk, key]) => {
          if (!stillQueued.has(sk) && next[key]) {
            delete next[key];
            delete pendingUploadKeyRef.current[sk];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };
    sync();
    return uploadQueueManager.addListener(sync);
  }, [leadId]);

  const salesPhotosSignature = useMemo(() => {
    const photos = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    return photos
      .map((p: any) => `${p?.s3url || ''}:${p?.category || ''}:${p?.subcategory || ''}`)
      .join('|');
  }, [lead?.salesPhotos]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const rawPhotos: any[] = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];

      const pending = pendingDeletesRef.current;
      if (pending.size) {
        const stillReturned = new Set(rawPhotos.map((p) => p?.s3url).filter(Boolean));
        pending.forEach((u) => {
          if (!stillReturned.has(u)) pending.delete(u);
        });
      }
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

      const buildMap = (secureMap: Record<string, string | null>) => {
        const fresh: Record<string, CapturedPhoto[]> = {};
        scoped.forEach((p) => {
          const k = subKey(p.category, p.subcategory);
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

      if (cancelled) return;
      const immediate = buildMap({});
      knownPhotosRef.current = immediate;
      setPhotosBySubcat(immediate);

      if (filePaths.length > 0) {
        setLoading(true);
        const secureMap: Record<string, string | null> = {};
        try {
          /**
           * ⚠️ Through the OFFLINE CACHE, not a bare call — and its absence is why Manage
           * Photos showed "Needs a connection" on photos the Roofline Deck was rendering at
           * the same moment.
           *
           * `useSecureUrls` (the deck's source) already wraps this same endpoint in
           * `cachedFetch`, so offline it replays the last signed urls — expired as network
           * addresses, but `getLocalCachePath` strips the query, so they still name the files
           * already on disk. This screen called `LeadService.getSecureUrls` directly: offline
           * that throws, the catch keeps the phase-1 fallback, and the fallback is
           * `resolveS3Url` — a DIFFERENT url that was never warmed, so the tile had nothing.
           *
           * ⚠️ A SEPARATE key namespace from `useSecureUrls`, and that is load-bearing.
           * This stores the raw axios RESPONSE; `useSecureUrls` stores a category map
           * (`Record<string, Array<…>>`). Sharing a key made one overwrite the other, and
           * `buildInspectionSections` then ran `(list || []).forEach` over a non-array —
           * "undefined is not a function", a hard RENDER CRASH on the Roofline Deck.
           */
          const res = await cachedFetch(
            `${OFFLINE_CACHE.SECURE_URLS}:capture:${hashString(filePaths.map((f) => f.filePath).join(','))}-${filePaths.length}`,
            () => LeadService.getSecureUrls(filePaths),
            { online: isOnline(), userId }
          );
          const data = res?.data?.data || res?.data || [];
          filePaths.forEach((fp, i) => {
            const entry = Array.isArray(data)
              ? data.find((d: any) => d?.filePath === fp.filePath) || data[i]
              : null;
            secureMap[`${fp.bucketName}:${fp.filePath}`] = entry?.secureUrl || entry?.url || null;
          });
        } catch (e) {
        }
        if (cancelled) return;
        const signed = buildMap(secureMap);
        knownPhotosRef.current = signed;
        setPhotosBySubcat(signed);
      }
      setLoading(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesPhotosSignature, index, productKey, deletedUrls]);

  const getPhotos = useCallback(
    (label: string, subcategory: string): CapturedPhoto[] => {
      const sk = subKey(scopeCat(label), subcategory);
      const server = displayPhotos[sk] || [];
      if (server.length > 0) return server;
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

      setCapturedPreviews((prev) => ({ ...prev, [sk]: asset.uri }));
      setUploadingKeys((prev) => ({ ...prev, [key]: true }));
      pendingUploadKeyRef.current[sk] = key;

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

      const target = resolveDeleteTarget(photo as any);
      if (target.kind === 'nothing') return;

      if (target.kind === 'queued-upload') {
        if (key) setDeletingKeys((prev) => ({ ...prev, [key]: true }));
        try {
          uploadQueueManager.dropQueuedItem(target.pendingId);
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
              occurredAt: new Date().toISOString(),
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

        pendingDeletesRef.current.add(url);
        const dk = subKey(scopeCat(categoryLabel), subcategory);
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
      const photoId = photo?._id || (photo as any)?.id;
      if (!leadId || !photoId) return;
      const fromCatAbs = fromCategoryAbsolute || scopeCat(fromCategoryLabel);
      if (
        norm(fromCatAbs) === norm(scopeCat(toCategoryLabel)) &&
        norm(fromSubcategory) === norm(toSubcategory)
      ) {
        return; // same slot — nothing to do
      }
      if (key) setMovingKeys((prev) => ({ ...prev, [key]: true }));

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
        }
        await refreshLeadData?.(leadId);
      } catch {
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
