import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { useAuth } from './useAuth';
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

/** Web parity: `useGetRehashLeads` requests 200 rows and never pages past the first. */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 200;

/**
 * The signed-in rep's rehashed leads — `GET /rehash/rep/v1/leads`.
 *
 * Mirrors web `useGetRehashLeads` (`src/api/leads.js`), which is fetched ONLY while the
 * Rehash tab is open. Hence the required `enabled` argument rather than an options bag:
 * this is a tab-scoped list, and firing it from the Issued tab would be a request for a
 * list nothing is showing.
 *
 * ⚠️ Separate from `useLeadsData`. That hook reads `demo/v1/leads/sales-portal` with a
 * `status` filter; rehash is its own service with its own paging contract, so it cannot
 * be folded in as another `status` value.
 */
export function useRehashLeads(enabled: boolean, params?: RehashLeadsParams) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const page = params?.page ?? DEFAULT_PAGE;
  const limit = params?.limit ?? DEFAULT_LIMIT;

  // Held in a memo so the key is referentially stable across renders — an inline object
  // would be a new key every render and re-subscribe the observer each time.
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

      // `{ code, message, data: { leads, pagination } }`. The `data.leads` fallback
      // covers a server that answers with a bare array under `data`, which the
      // sales-portal endpoint does — cheap insurance, since the documented empty
      // response is the only shape confirmed so far.
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
    // The rep must be resolved before asking: `companyId` scopes the response, and a
    // request sent before the profile lands would be cached against a `companyId` of
    // undefined and then re-used for the real one.
    enabled: enabled && !!user?._id,
    staleTime: 1000 * 60 * 5, // 5 minutes, matching useLeadsData
  });

  /**
   * Drop a lead from the cached list without a round trip — the archive/delete
   * counterpart of `useLeadsData.removeLocalLead`, so a card removed from the Rehash
   * tab disappears as immediately as it does on the other two.
   */
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
