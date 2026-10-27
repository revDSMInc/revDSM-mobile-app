import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { useAuth } from './useAuth';
import { useLiveLeadRefresh } from './useLeadsData';
import type { Lead } from '../config/types/lead';

export interface RehashPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RehashLeadsParams {
  page?: number;
  limit?: number;
  date?: string;
  timeSlot?: string;
  office?: string;
  status?: string;
}

const REHASH_KEYS = ['rehashLeads'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 200;

export function useRehashLeads(enabled: boolean, params?: RehashLeadsParams) {
  const { user } = useAuth();
  useLiveLeadRefresh(enabled && !!user?._id, REHASH_KEYS);
  const queryClient = useQueryClient();

  const page = params?.page ?? DEFAULT_PAGE;
  const limit = params?.limit ?? DEFAULT_LIMIT;

  const queryKey = useMemo(
    () => [
      'rehashLeads',
      {
        page,
        limit,
        date: params?.date,
        timeSlot: params?.timeSlot,
        office: params?.office,
        status: params?.status,
        companyId: user?.companyId,
      },
    ],
    [page, limit, params?.date, params?.timeSlot, params?.office, params?.status, user?.companyId]
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await LeadService.getRehashLeads(
        {
          page,
          limit,
          date: params?.date,
          timeSlot: params?.timeSlot,
          office: params?.office,
          status: params?.status,
        },
        user?.companyId
      );

      const payload = res.data?.data;
      const leads = Array.isArray(payload?.leads)
        ? payload.leads
        : Array.isArray(payload)
        ? payload
        : [];

      return {
        leads: leads as Lead[],
        pagination: (payload?.pagination ?? null) as RehashPagination | null,
      };
    },
    enabled: enabled && !!user?._id,
    staleTime: 1000 * 60 * 5, // 5 minutes, matching useLeadsData
  });

  const removeLocalLead = useCallback(
    (id: string) => {
      queryClient.setQueryData(
        queryKey,
        (old: { leads: Lead[]; pagination: RehashPagination | null } | undefined) =>
          old ? { ...old, leads: old.leads.filter((l) => l._id !== id) } : old
      );
    },
    [queryClient, queryKey]
  );

  return {
    rehashLeads: data?.leads ?? [],
    pagination: data?.pagination ?? null,
    loading: isLoading,
    isFetching,
    refresh: refetch,
    removeLocalLead,
  };
}
