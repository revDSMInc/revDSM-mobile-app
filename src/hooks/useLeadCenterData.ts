import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { applyOfflineResult, isClientId } from '../utils/offline-lead-work';
import { mergePendingIntoSections } from '../utils/pending-inspection-photos';
import { uploadQueueManager } from '../utils/uploadQueue';
import { getOfflineWork, subscribeOfflineWork } from '../services/offlineLeadStore';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, readOfflineCache, writeOfflineCache } from '../utils/offline-query-cache';
import { leadDetailForCache, mergeLeadRow } from '../utils/offline-lead-detail-cache';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { onOrderSheetChanged } from '../utils/order-sheet-events';
import { resolveS3Url } from '../utils/s3-utils';
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
    }));
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, user?._id]);

  const refetch = useCallback(async () => {
    if (!user?._id || !lead?._id) return;
    if (isClientId(lead._id)) return;

    if (!isOnline()) {
      hydrateFromCache();
      return;
    }
    if (hydrateInFlightRef.current === lead._id) return;
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
        }));
      } else {
        const workRes = await LeadService.workLead(lead._id, user._id);
        const workData = workRes.data?.data || workRes.data;
        if (workData) {
          cacheLeadDetail(lead._id, workData, user._id);
          setLead((prev: any) => ({ ...prev, ...workData }));
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
    }
  }, [user?._id, lead?._id, hydrateFromCache]);

  useEffect(() => {
    if (!lead?._id || !user?._id) return;
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, user?._id]);

  // An order sheet was replaced in place (annotate / reset): this screen's copy of the lead still holds the old `filePath`.
  // `refetch` skips while another is in flight, so ask once more shortly after.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
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
  useEffect(() => {
    setPendingUploads([...uploadQueueManager.getQueue()]);
    return uploadQueueManager.addListener(() => {
      setPendingUploads([...uploadQueueManager.getQueue()]);
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

          const newPhotos = lead.salesPhotos.filter((p: any) => !existingS3Urls.has(p.s3url));

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

            let imageData = Object.values(existingMap)
              .flat()
              .find((img) => img.s3url === photo.s3url);

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
              const imageUri = secured?.secureUrl || resolveS3Url(photo.s3url);

              imageData = {
                uri: imageUri,
                s3url: photo.s3url,
                id: photo._id,
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
        setSectionImages({});
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
