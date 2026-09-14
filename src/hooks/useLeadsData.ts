import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
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
      // `view=summary` — the slim list (SALES-PORTAL-API-OPTIMIZATION.md). The rows
      // carry exactly what `LeadCard` draws (name, code, address, date/time, status,
      // pin, action counts) and the server skips ~15 join collections per lead, which
      // is the whole point: the fat list was hydrating photo arrays, job builder and
      // installer data for every row so the card could show none of it.
      //
      // Web adds this inside its own list hook (`useGetLeads`) for the same reason —
      // it belongs to the LIST, not to the endpoint, since the same URL without it is
      // still the full response for the portal.
      //
      // ⚠️ A row from here is NOT a complete lead: `salesPhotos` is `[]` and
      // `jobBuilder` is absent. Nothing may open a lead straight from this array —
      // hydrate through `LeadService.getSalesPortalLeadById` first. `useLeadCenterData`
      // does that for every entry point into the Lead Center.
      // Kept on the device so the list still paints after the app has been KILLED with no
      // signal. React Query's cache is memory-only, so before this a force-quit in a dead zone
      // (or an OS eviction overnight) reopened to "No leads found" — indistinguishable from a rep
      // who has been assigned nothing.
      //
      // ⚠️ Keyed per TAB. The screen fetches a different `status`/`period` for each one, and a
      // single key would let Sold Leads overwrite Today's and then serve them back under the
      // wrong heading.
      //
      // ⚠️ An empty response never overwrites a good copy — `cachedFetch`'s own rule, and it
      // matters most here: a rep whose list momentarily came back empty (a deploy, a permissions
      // blip) would otherwise be left with a permanently empty offline list.
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
        // Offline and this tab has never been loaded on this device. An empty list is the honest
        // answer — there genuinely is nothing to show — and it renders the list's own empty state
        // rather than an error screen. Online, the failure is real and belongs to the caller.
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
