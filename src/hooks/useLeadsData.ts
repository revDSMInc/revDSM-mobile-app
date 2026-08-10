import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { useAuth } from './useAuth';
import type { Lead } from '../config/types/lead';

/**
 * @param options.enabled Hold the request off while the list it feeds isn't on screen.
 *   Web parity: `job-list.js` passes `apiParams: null` for the tabs served by another
 *   endpoint (Rehash, Calendar), which makes its SWR key null and skips the fetch —
 *   this is that switch. Defaults to on, so existing callers are unaffected.
 */
export function useLeadsData(
  params?: { status?: string; period?: string },
  options?: { enabled?: boolean }
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['leads', params],
    queryFn: async () => {
      if (!user?._id) return [];
      const res = await LeadService.getSalesLeads(user._id, params);
      const leadsData = res.data?.data?.leads || res.data?.data;
      return Array.isArray(leadsData) ? leadsData : [];
    },
    enabled: !!user?._id && options?.enabled !== false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const removeLocalLead = useCallback(
    (id: string) => {
      queryClient.setQueryData(['leads', params], (old: Lead[] | undefined) => {
        return old ? old.filter((l) => l._id !== id) : [];
      });
    },
    [queryClient, params]
  );

  return {
    leads: data || [],
    loading: isLoading,
    refresh: refetch,
    removeLocalLead,
  };
}

export function useLead(leadId: string) {
  const { user } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      if (!user?._id || !leadId) return null;
      const res = await LeadService.workLead(leadId, user._id);
      return res.data?.data || res.data;
    },
    enabled: !!user?._id && !!leadId,
  });

  return {
    lead: data,
    loading: isLoading,
    refresh: refetch,
  };
}
