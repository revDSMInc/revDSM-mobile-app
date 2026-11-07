import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { applyOfflineResult, isClientId } from '../utils/offline-lead-work';
import { mergePendingIntoSections } from '../utils/pending-inspection-photos';
import { keepDeviceOnlyPhotos } from '../utils/device-only-photos';
import { mergeSalesPhotos } from '../utils/sales-photos-merge';
import { resolvedLeadIdFor } from '../utils/lead-id-rekey';
import { uploadsLeftQueueForLead } from '../utils/upload-queue-landed';
import { uploadQueueManager } from '../utils/uploadQueue';
import { getOfflineWork, subscribeOfflineWork } from '../services/offlineLeadStore';
import { isOnline, onReconnect } from '../services/connectivity';
import { OFFLINE_CACHE, readOfflineCache, writeOfflineCache } from '../utils/offline-query-cache';
import { leadDetailForCache, mergeLeadRow } from '../utils/offline-lead-detail-cache';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { onOrderSheetChanged } from '../utils/order-sheet-events';
import { resolveS3Url } from '../utils/s3-utils';
import { needsSecureUrl, sectionImageUri } from '../utils/section-image-uri';
import { ENV } from '../config/env';
import { IMAGE_CATEGORIES } from '../constants/lead-center';
import { logLeadSessionEnter, persistActiveLeadId } from '../utils/lead-activity-log';
import { beginLeadWorkSession, clearLeadWorkSession } from '../utils/lead-work-session';

const EMPTY_OUTCOME_FORM = Object.freeze({});
const EMPTY_CALCULATOR_DATA = Object.freeze({});

let salesPortalDetailUnavailable = false;

const isRouteMissing = (err: any): boolean =>
  err?.httpStatus === 404 && typeof err?.body === 'string' && err.body.trim().startsWith('<');

const detailCacheKey = (leadId: string) => `${OFFLINE_CACHE.LEAD_DETAIL}:${leadId}`;

const cacheLeadDetail = (leadId: string, record: any, userId?: string) => {
  const slim = leadDetailForCache(record);
  if (slim) writeOfflineCache(detailCacheKey(leadId), slim, userId);
};

export const useLeadCenterData = (
  initialLead: any,
  user: any,
  options?: { appointmentStarted?: boolean; fromMyDeals?: boolean }
) => {
  const queryClient = useQueryClient();
  const [lead, setLead] = useState<any>(initialLead);

  useEffect(() => {
    if (!initialLead) return;
    setLead((prev: any) => mergeLeadRow(prev, initialLead));
  }, [initialLead]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hydrateInFlightRef = useRef<string | null>(null);
  const outcomeForm: any = EMPTY_OUTCOME_FORM;
  const calculatorData: any = EMPTY_CALCULATOR_DATA;
  const [isOutcomeLoading, setIsOutcomeLoading] = useState(true);
  const [jobState, setJobState] = useState<any>({
    gutter: {
      partial: '',
      gutterColorsMulti: [],
      downspoutsMulti: [],
      extrasColors: { groundSpout: 'Black' },
    },
    leaffilter: {
      combinations: [],
      extras: { csr: 0, cornersFilter: 0, sawzallHanger: 0, removeProtection: 0, ribbedRoof: 0 },
    },
    soffit: { vinyl: { type: '' }, porch: { location: [] }, nailer: { type: '' } },
    fascia: { wrap: { type: '' }, boards: { boardType: '' }, aluminumBoards: { footage: '' } },
    additional: { extraLabor: 0 },
    scheduleTime: null,
  });

  const hydrateFromCache = useCallback((): boolean => {
    if (!lead?._id || !user?._id) return false;
    const saved = readOfflineCache<any>(detailCacheKey(lead._id), { userId: user._id })?.data;
    if (!saved) return false;
    setLead((prev: any) => ({
      ...prev,
      ...saved,
      generatedReports: saved.generatedReports || prev?.generatedReports || [],
      // ⚠️ Same rule as the server merge: a cache written BEFORE these photos existed must not
      // delete them from the screen.
      salesPhotos: mergeSalesPhotos(prev?.salesPhotos, saved.salesPhotos, { keepUnlisted: true }),
    }));
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, user?._id]);

  // Always the CURRENT refetch. Listeners registered once (queue, reconnect, order sheet) must
  // go through this, never through the closure they captured on mount - see the queue effect below.
  const refetchRef = useRef<() => Promise<void>>(async () => {});
  // A refetch asked for while one is in flight runs ONCE MORE when that one finishes.
  const refetchAgainRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!user?._id || !lead?._id) return;
    if (isClientId(lead._id)) return;

    if (!isOnline()) {
      hydrateFromCache();
      return;
    }
    /**
     * ⚠️ COALESCE, DON'T DROP. This used to `return` and forget the request. Three uploads landing
     * seconds apart each ask for a refresh; if the first is still in flight the others were
     * discarded, and the state kept a list that predates the last photo. Remember that one was
     * asked for and run it once more in `finally`, so the final state always reflects the last
     * request made.
     */
    if (hydrateInFlightRef.current === lead._id) {
      refetchAgainRef.current = true;
      return;
    }
    hydrateInFlightRef.current = lead._id;
    try {
      setIsRefreshing(true);

      let full: any = null;
      if (!salesPortalDetailUnavailable) {
        try {
          const res = await LeadService.getSalesPortalLeadById(lead._id);
          full = res.data?.data?.lead || res.data?.lead;
        } catch (detailErr: any) {
          if (isRouteMissing(detailErr)) {
            salesPortalDetailUnavailable = true;
            if (__DEV__) {
              console.warn(
                '[LeadCenter] sales-portal detail endpoint not deployed on this API — ' +
                  'falling back to workLead for the rest of the session.'
              );
            }
          } else if (detailErr?.httpStatus !== 404) {
            throw detailErr;
          }
        }
      }

      if (full) {
        cacheLeadDetail(lead._id, full, user._id);
        setLead((prev: any) => ({
          ...prev,
          ...full,
          generatedReports: full.generatedReports || prev?.generatedReports || [],
          /**
           * ⚠️ A shorter server list must not delete a photo the server has never seen.
           *
           * The spread above replaced `salesPhotos` outright, which breaks the reconnect case: a
           * queued offline photo has no server row yet, so the read that follows must not drop it.
           * A photo that HAS an `s3url` and is now unlisted IS gone, and leaves here - that is what
           * lets an online delete take effect without a reload. See `utils/sales-photos-merge.ts`.
           */
          salesPhotos: mergeSalesPhotos(prev?.salesPhotos, full.salesPhotos),
        }));
      } else {
        const workRes = await LeadService.workLead(lead._id, user._id);
        const workData = workRes.data?.data || workRes.data;
        if (workData) {
          cacheLeadDetail(lead._id, workData, user._id);
          setLead((prev: any) => ({
            ...prev,
            ...workData,
            salesPhotos: mergeSalesPhotos(prev?.salesPhotos, workData.salesPhotos),
          }));
        }
      }
    } catch (err: any) {
      if (err?.httpStatus === undefined) {
        const recovered = hydrateFromCache();
        console.warn(
          `[LeadCenter] Refresh skipped — API unreachable${recovered ? ' (served from cache)' : ''}:`,
          err?.message || err
        );
      } else {
        console.error('[LeadCenter] Refresh failed:', err);
      }
    } finally {
      hydrateInFlightRef.current = null;
      setIsRefreshing(false);
      if (refetchAgainRef.current) {
        refetchAgainRef.current = false;
        void refetchRef.current();
      }
    }
  }, [user?._id, lead?._id, hydrateFromCache]);

  useEffect(() => {
    if (!lead?._id || !user?._id) return;
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, user?._id]);


  // An order sheet was replaced in place (annotate / reset): this screen's copy of the lead still holds the old `filePath`.
  // `refetch` skips while another is in flight, so ask once more shortly after.
  refetchRef.current = refetch;
  /**
   * ⚠️ PULL FRESH DATA WHEN THE LINK COMES BACK, without the rep leaving the screen.
   *
   * Asked for directly: *"what if we auto pulled to reload the Lead center page when we become
   * online by remaining this screen so we can see the real time data"*. Until now the screen only
   * refetched on mount, so a rep who stayed put after reconnecting saw whatever the device had
   * decided before the link returned, and had to navigate away and back to see the truth.
   *
   * ⚠️ `onReconnect` is used deliberately rather than a raw connectivity listener: it waits for
   * the link to HOLD for `RECONNECT_SETTLE_MS`, merges every firing path into one, and staggers
   * its listeners - so this cannot restart on each tower hop or pile onto the upload drain that
   * fires at the same moment. A drop before the settle cancels it.
   *
   * `refetch` already no-ops while offline, for a client-id lead, and while another refresh is in
   * flight, so this is additive and cannot double-fetch.
   */
  useEffect(() => {
    if (!lead?._id || !user?._id) return;
    return onReconnect(() => {
      refetchRef.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, user?._id]);
  useEffect(() => {
    if (!lead?._id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onOrderSheetChanged((changedId) => {
      if (String(changedId) !== String(lead._id)) return;
      refetchRef.current();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refetchRef.current(), 1500);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [lead?._id]);

  useEffect(() => {
    setIsOutcomeLoading(false);
  }, [lead?._id]);

  const [sectionImages, setSectionImages] = useState<Record<string, any[]>>({});

  const [pendingUploads, setPendingUploads] = useState(() => uploadQueueManager.getQueue());
  const leadIdRef = useRef<string | undefined>(lead?._id);
  leadIdRef.current = lead?._id;
  /**
   * ⚠️ REFETCH WHEN AN UPLOAD FOR THIS LEAD LANDS. This is the fix for "created a lead offline,
   * took 3 photos, came back online on the same screen, Manage Photos is empty until a pull".
   *
   * `lead` is local state; the only thing that puts a SERVER photo into it is `refetch`. Every
   * trigger that existed - mount, id change, reconnect - fires before a reconnect drain has
   * finished uploading, so the state kept the server's empty list while the queue emptied.
   * `JobDocsSection` did call `refetch()` from its listener, but through the closure it captured
   * on mount, which for an offline-created lead still held the CLIENT id - and `refetch` returns
   * early for a client id. The count read 3 only through the 60 s `recentlyCompleted` grace,
   * which Manage Photos does not consult, so the two surfaces disagreed.
   *
   * Matched by item `id` so a rekey (same ids, new `leadId`) does not fire this; the id-change
   * effect covers that moment. See `utils/upload-queue-landed.ts`.
   */
  const queueSnapshotRef = useRef(uploadQueueManager.getQueue());
  useEffect(() => {
    queueSnapshotRef.current = uploadQueueManager.getQueue();
    setPendingUploads([...queueSnapshotRef.current]);
    return uploadQueueManager.addListener(() => {
      const next = uploadQueueManager.getQueue();
      const landed = uploadsLeftQueueForLead(queueSnapshotRef.current, next, leadIdRef.current);
      queueSnapshotRef.current = next;
      setPendingUploads([...next]);
      if (landed > 0) void refetchRef.current();
    });
  }, []);
  const sectionImagesWithPending = useMemo(
    () => mergePendingIntoSections(sectionImages, pendingUploads as any, lead?._id),
    [sectionImages, pendingUploads, lead?._id]
  );

  useEffect(() => {
    const fetchSecureImages = async () => {
      if (lead?.salesPhotos?.length > 0) {
        try {
          const existingMap = { ...sectionImages };
          const existingS3Urls = new Set(
            Object.values(existingMap)
              .flat()
              .map((img) => img.s3url)
          );

          /**
           * ⚠️ ONLY ROWS THAT ARE ACTUALLY ON S3. A photo taken at a door has no `s3url`
           * until its upload drains, and asking `getSecureUrls` for `filePath: undefined` is both
           * pointless and a way to fail the whole batch.
           */
          const newPhotos = lead.salesPhotos.filter((p: any) =>
            needsSecureUrl(p, existingS3Urls as Set<string>)
          );

          let updatedSecureData: any[] = [];
          if (newPhotos.length > 0) {
            try {
              const filePaths = newPhotos.map((p: any) => ({
                bucketName: p.bucketName || ENV.S3_BUCKET,
                filePath: p.s3url,
              }));
              const secureRes = await LeadService.getSecureUrls(filePaths);
              updatedSecureData = secureRes.data?.data || secureRes.data || [];
            } catch (err) {
              console.warn('Failed to fetch secure URLs from API, using fallback S3 URLs:', err);
            }
          }

          const map: Record<string, any[]> = {};
          lead.salesPhotos.forEach((photo: any) => {
            const catName = photo.category;

            const categoryConfig = IMAGE_CATEGORIES.find(
              (c) => c.id.toLowerCase() === catName.toLowerCase() || c.name.toLowerCase() === catName.toLowerCase()
            );

            const normalizedCatKey = categoryConfig ? categoryConfig.name : catName;

            if (!map[normalizedCatKey]) map[normalizedCatKey] = [];

            // Match on whichever id the photo actually carries - a device-only row has only `uri`.
            let imageData = Object.values(existingMap)
              .flat()
              .find((img) =>
                photo.s3url ? img.s3url === photo.s3url : !!photo.uri && img.uri === photo.uri
              );

            if (!imageData) {
              let subIndex = -1;
              if (categoryConfig && photo.subcategory) {
                subIndex =
                  categoryConfig.subCategories?.findIndex(
                    (s) => s.id === photo.subcategory || s.name === photo.subcategory
                  ) ?? -1;

                if (subIndex === -1 && categoryConfig.cardGroups) {
                  for (const group of categoryConfig.cardGroups) {
                    const foundIdx = group.subCategories?.findIndex(
                      (s) => s.id === photo.subcategory || s.name === photo.subcategory
                    ) ?? -1;
                    if (foundIdx !== -1) {
                      subIndex = foundIdx;
                      break;
                    }
                  }
                }
              }

              if (subIndex === -1) {
                const parts = photo.subcategory?.split('-');
                const numericPart = parseInt(parts?.[parts.length - 1] || '');
                if (!isNaN(numericPart)) subIndex = numericPart - 1;
              }

              const secured = updatedSecureData.find(
                (s: any) => s.s3url === photo.s3url || s.filePath === photo.s3url
              );
              /**
               * ⚠️ FALL BACK TO THE PHOTO'S OWN LOCAL `uri`, and this is the bug behind
               * "Manage Photos (0)" / "There are no photos to download" AFTER a reconnect.
               *
               * `resolveS3Url(undefined)` returns `''`. A device-only photo (no `s3url` yet) was
               * therefore rebuilt here as `{ uri: '', s3url: undefined }` - every identifying
               * field blank. The download handler tests `img.uri || img.s3url`, so the row was
               * skipped and the alert said there was nothing to download, while the grid had an
               * empty uri to render.
               *
               * This branch runs whenever the SERVER list is non-empty, so it overwrote the
               * optimistic entries that the `else` branch below is careful to preserve - the two
               * halves of the same effect disagreed.
               *
               * The local file is on disk and renders fine, so `photo.uri` is the right source.
               */
              const imageUri = sectionImageUri(
                secured?.secureUrl,
                resolveS3Url(photo.s3url),
                photo
              );

              imageData = {
                uri: imageUri,
                s3url: photo.s3url,
                id: photo._id || photo.pendingId,
                index: subIndex >= 0 ? subIndex : map[normalizedCatKey].length,
                subcategory: photo.subcategory,
              };
            }

            map[normalizedCatKey].push(imageData);
          });
          setSectionImages(map);
        } catch (error) {
          console.error('Failed to fetch secure URLs', error);
        }
      } else {
        /**
         * ⚠️ KEEP THE PHOTOS THAT ARE ONLY ON THIS DEVICE. This used to be
         * `setSectionImages({})`, which is right for a lead whose SERVER list is empty and wrong
         * for every photo taken at a door with no signal.
         *
         * Reported as data loss: a rep shot four photos offline, closed the camera, and watched
         * every count fall to 0 - then saw them come back after navigating away and returning.
         * `handleUpload` writes each shot into `sectionImages` optimistically (local `uri`, no
         * `s3url`) at the same time as it queues the upload. Closing the camera fires the queue
         * listener, which calls `refetch()`; offline that hydrates from the cache and hands
         * `lead.salesPhotos` a NEW ARRAY IDENTITY, so this effect re-ran, found no server photos
         * and wiped the optimistic ones. Nothing was ever lost - the queue still held all four,
         * which is why a remount restored them - but every grid and counter read 0.
         *
         * A photo with no `s3url` has never been to the server, so the server's list is no
         * evidence about it. Only server-backed entries are cleared here.
         */
        setSectionImages((prev) => keepDeviceOnlyPhotos(prev));
      }
    };
    fetchSecureImages();
  }, [lead?.salesPhotos]);

  useEffect(() => {
    if (!lead?._id || !user?._id) return;

    persistActiveLeadId(lead._id);
    logLeadSessionEnter(user, lead);

    beginLeadWorkSession(lead, user, options?.fromMyDeals);

    const offlineLead = isClientId(String(lead._id)) || !isOnline();
    if (!options?.appointmentStarted && !offlineLead) {
      LeadService.workLead(lead._id, user._id).catch((e) =>
        console.warn('[LeadCenter] Work start failed:', e)
      );
    }

    return () => {
      if (AppState.currentState !== 'active') return;

      clearLeadWorkSession();
    };
  }, [lead?._id, user?._id, options?.appointmentStarted, options?.fromMyDeals]);

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ['lead', initialLead?._id] });
    };
  }, [initialLead?._id, queryClient]);

  const [offlineWork, setOfflineWork] = useState(getOfflineWork);
  useEffect(() => subscribeOfflineWork(() => setOfflineWork(getOfflineWork())), []);

  /**
   * ⚠️ FOLLOW THE LEAD'S ID WHEN ITS OFFLINE CREATE LANDS.
   *
   * A lead made at a door is keyed `lead-1793...` until its create drains (the header reads
   * "Lead ID: N/A"). On reconnect `offlineLeadStore` rekeys every QUEUE onto the real server id,
   * but nothing told an already-open Lead Center - so the screen kept the client id while the
   * photo queue held the new one. `JobDocsSection` filters with `it.leadId === lead?._id`, so
   * `pending` became empty and the count fell from 3 photos to 0. Navigating away and back
   * "fixed" it only because the remount re-read the lead.
   *
   * `refreshAfterLeadLanded` refreshes the lead lists and the map; it does not reach this screen.
   * This adopts the real id in place, so the queue, the counts and the grid stay in agreement
   * without a remount. See `utils/lead-id-rekey.ts`.
   */
  useEffect(() => {
    const resolved = resolvedLeadIdFor(lead?._id, offlineWork as any);
    if (!resolved) return;
    setLead((prev: any) => (prev && prev._id !== resolved ? { ...prev, _id: resolved } : prev));
  }, [lead?._id, offlineWork]);
  const displayLead = useMemo(() => applyOfflineResult(lead, offlineWork), [lead, offlineWork]);

  return {
    lead: displayLead,
    setLead,
    isRefreshing,
    refetch,
    jobState,
    setJobState,
    calculatorData,
    outcomeForm,
    isOutcomeLoading,
    sectionImages: sectionImagesWithPending,
    setSectionImages,
  };
};
