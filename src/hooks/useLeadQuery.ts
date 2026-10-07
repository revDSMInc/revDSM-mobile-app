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
