import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
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
  return useQuery({
    queryKey: ['revrender-runs', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const res = await LeadService.getRevRenderRuns(leadId);
      return res.data?.runs || res.data?.data?.runs || [];
    },
    enabled: !!leadId,
  });
};
