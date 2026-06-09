import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { resolveS3Url } from '../utils/s3-utils';
import { ENV } from '../config/env';
import { IMAGE_CATEGORIES } from '../constants/lead-center';
import {
  logLeadCheckOut,
  logLeadSessionEnter,
  persistActiveLeadId,
} from '../utils/lead-activity-log';

export const useLeadCenterData = (
  initialLead: any,
  user: any,
  options?: { appointmentStarted?: boolean }
) => {
  const queryClient = useQueryClient();
  const [lead, setLead] = useState<any>(initialLead);

  // Sync state if navigation params change (e.g. on back navigation with updated lead)
  useEffect(() => {
    if (initialLead) {
      setLead(initialLead);
    }
  }, [initialLead]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [outcomeForm, setOutcomeForm] = useState<any>({});
  const [calculatorData, setCalculatorData] = useState<any>({});
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

  const refetch = useCallback(async () => {
    if (!user?._id || !lead?._id) return;
    try {
      setIsRefreshing(true);
      // Fetch fresh data from the Sales Portal API as it contains the updated generatedReports
      const repId = lead.assignedRepId || user._id;
      const res = await LeadService.getSalesLeads(repId, { leadId: lead._id });
      
      const leadsList = res.data?.data?.leads || res.data?.leads || [];
      const updated = leadsList.find((l: any) => l._id === lead._id || l.id === lead._id);

      if (updated) {
        setLead((prev: any) => ({
          ...prev,
          ...updated,
          // Explicitly prioritize the reports from the Sales Portal response
          generatedReports: updated.generatedReports || prev?.generatedReports || []
        }));
      } else {
        // Fallback to workLead if sales-portal didn't find the specific lead
        const workRes = await LeadService.workLead(lead._id, user._id);
        const workData = workRes.data?.data || workRes.data;
        if (workData) {
          setLead((prev: any) => ({ ...prev, ...workData }));
        }
      }
    } catch (err) {
      console.error('[LeadCenter] Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [user?._id, lead?._id, lead?.assignedRepId]);

  useEffect(() => {
    if (!lead?._id) return;

    // Only fetch outcome data if the lead has been resulted (Sale or Demo)
    const result = String(lead?.result || lead?.status || '').toLowerCase();
    const isResulted = result === 'demo' || result === 'sale';

    if (!isResulted) {
      setIsOutcomeLoading(false);
      return;
    }

    const fetchOutcomeData = async () => {
      try {
        setIsOutcomeLoading(true);
        const res = await LeadService.getLeadOutcome(lead._id);
        const data = res.data?.data || res.data;
        if (data) {
          const outcome = data.outcome || data.leadData || data;
          if (outcome?.jobBuilder) setJobState(outcome.jobBuilder);
          if (outcome?.LFCalculator) setCalculatorData(outcome.LFCalculator);
          setOutcomeForm(outcome);
        }
      } catch (err: any) {
        // 404 is expected for leads that haven't been resulted/processed yet
        if (err?.response?.status !== 404 && err?.status !== 404) {
          console.warn('[LeadCenter] Failed to fetch outcome data:', err);
        }
      } finally {
        setIsOutcomeLoading(false);
      }
    };
    fetchOutcomeData();
  }, [lead?._id, lead?.result, lead?.status]);

  const [sectionImages, setSectionImages] = useState<Record<string, any[]>>({});

  useEffect(() => {
    const fetchSecureImages = async () => {
      if (lead?.salesPhotos?.length > 0) {
        try {
          // Check what we already have to avoid redundant fetching
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

            // Find category config case-insensitively by ID or name
            const categoryConfig = IMAGE_CATEGORIES.find(
              (c) => c.id.toLowerCase() === catName.toLowerCase() || c.name.toLowerCase() === catName.toLowerCase()
            );

            // Normalize key to categoryConfig.name (e.g. "Inspection" instead of "inspection")
            const normalizedCatKey = categoryConfig ? categoryConfig.name : catName;

            if (!map[normalizedCatKey]) map[normalizedCatKey] = [];

            // Try to find existing image data first
            let imageData = Object.values(existingMap)
              .flat()
              .find((img) => img.s3url === photo.s3url);

            if (!imageData) {
              let subIndex = -1;
              if (categoryConfig && photo.subcategory) {
                // Try standard subcategories first
                subIndex =
                  categoryConfig.subCategories?.findIndex(
                    (s) => s.id === photo.subcategory || s.name === photo.subcategory
                  ) ?? -1;

                // Try cardGroups subcategories if not found
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

    if (!options?.appointmentStarted) {
      LeadService.workLead(lead._id, user._id).catch((e) =>
        console.warn('[LeadCenter] Work start failed:', e)
      );
    }

    return () => {
      logLeadCheckOut(user, lead);
      LeadService.endWorkLead(lead._id).catch((e) =>
        console.warn('[LeadCenter] Work end failed:', e)
      );
    };
  }, [lead?._id, user?._id, options?.appointmentStarted]);

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ['lead', initialLead?._id] });
    };
  }, [initialLead?._id, queryClient]);

  return {
    lead,
    setLead,
    isRefreshing,
    refetch,
    jobState,
    setJobState,
    calculatorData,
    outcomeForm,
    isOutcomeLoading,
    sectionImages,
    setSectionImages,
  };
};
