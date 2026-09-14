import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { useAuth } from './useAuth';

export const useLeadQuery = (leadId: string, initialData?: any) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      if (!user?._id || !leadId) return null;
      const res = await LeadService.workLead(leadId, user._id);
      return res.data?.data || res.data;
    },
    enabled: !!user?._id && !!leadId,
    initialData,
    // Add long stale time to avoid too many refreshes,
    // we'll invalidate manually when images are uploaded
    staleTime: 60000,
  });
};

export const useRevRenderRunsQuery = (leadId: string) => {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  return useQuery({
    queryKey: ['revrender-runs', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      // Kept per lead so a render generated online is still on the Investment Center with no
      // signal. ⚠️ Only the LIST is cached — generating a new render is an AI round trip and
      // cannot happen offline; see the offline guard on the revRender card.
      return cachedFetch<any[]>(
        `${OFFLINE_CACHE.REVRENDER_RUNS}:${leadId}`,
        async () => {
          const res = await LeadService.getRevRenderRuns(leadId);
          return res.data?.runs || res.data?.data?.runs || [];
        },
        { online: isOnline(), userId }
      );
    },
    enabled: !!leadId,
  });
};
