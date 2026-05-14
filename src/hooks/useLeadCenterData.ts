import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { resolveS3Url } from '../utils/s3-utils';
import { IMAGE_CATEGORIES } from '../constants/lead-center';
import { logEvent } from '../services/api/LoggerService';

export const useLeadCenterData = (initialLead: any, user: any) => {
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
        if (data?.leadData?.jobBuilder) setJobState(data.leadData.jobBuilder);
        if (data?.leadData?.LFCalculator) setCalculatorData(data.leadData.LFCalculator);
        if (data?.leadData) setOutcomeForm(data.leadData);
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
            const filePaths = newPhotos.map((p: any) => ({
              bucketName: p.bucketName || 'np-revdsm-staging',
              filePath: p.s3url,
            }));
            const secureRes = await LeadService.getSecureUrls(filePaths);
            updatedSecureData = secureRes.data?.data || secureRes.data || [];
          }

          const map: Record<string, any[]> = {};
          lead.salesPhotos.forEach((photo: any) => {
            const catName = photo.category;
            if (!map[catName]) map[catName] = [];

            // Try to find existing image data first
            let imageData = Object.values(existingMap)
              .flat()
              .find((img) => img.s3url === photo.s3url);

            if (!imageData) {
              const categoryConfig = IMAGE_CATEGORIES.find((c) => c.name === catName);
              let subIndex = -1;
              if (categoryConfig && photo.subcategory) {
                subIndex =
                  categoryConfig.subCategories?.findIndex(
                    (s) => s.id === photo.subcategory || s.name === photo.subcategory
                  ) ?? -1;
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
                index: subIndex >= 0 ? subIndex : map[catName].length,
                subcategory: photo.subcategory,
              };
            }

            map[catName].push(imageData);
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
    LeadService.workLead(lead._id, user._id)
      .then((res) => console.log('Work started successfully:', res.data))
      .catch((e) => console.warn('[LeadCenter] Work start failed:', e));
    return () => {
      if (user?._id && lead?._id) {
        logEvent('unload', {
          user_id: user._id,
          module_type: 'lead_check_out',
          action: 'check_out_unloaded',
          created_by: user._id,
          meta: {
            leadId: lead._id,
            unload: true,
          },
        });
      }
      LeadService.endWorkLead(lead._id)
        .then((res) => console.log('Work ended successfully:', res.data))
        .catch((e) => console.warn('[LeadCenter] Work end failed:', e));
    };
  }, [lead?._id, user?._id]);

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
