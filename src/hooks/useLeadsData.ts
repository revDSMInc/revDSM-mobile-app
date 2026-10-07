import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { useAuth } from './useAuth';
import type { Lead } from '../config/types/lead';

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
      const key = `${OFFLINE_CACHE.LEADS_LIST}:${params?.status || 'all'}:${params?.period || 'all'}`;
      try {
        return await cachedFetch<any[]>(
          key,
          async () => {
            const res = await LeadService.getSalesLeads(user._id, { ...params, view: 'summary' });
            const leadsData = res.data?.data?.leads || res.data?.data;
            return Array.isArray(leadsData) ? leadsData : [];
          },
          { online: isOnline(), userId: user._id }
        );
      } catch (e) {
        if (!isOnline()) return [];
        throw e;
      }
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
