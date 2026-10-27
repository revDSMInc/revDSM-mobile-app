import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { useAuth } from './useAuth';
import SocketManager from '../services/SocketManager';
import type { Lead } from '../config/types/lead';

/**
 * Socket events that mean a lead's status / result may have changed. `funding-updated` and
 * `pending-addendum` are confirmed server events; the `lead-*` names are the backend's lead-status
 * broadcasts - harmless if a server never emits one. `connect` covers anything missed while offline.
 */
const LEAD_CHANGE_EVENTS = [
  'funding-updated',
  'pending-addendum',
  'lead-updated',
  'lead-status-updated',
  'lead-resulted',
  'connect',
];

/** Keeps every cached leads list fresh while the screen is open (staleTime alone is 5 min). */
export function useLiveLeadRefresh(enabled: boolean, keys: string[] = ['leads']) {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    // A burst of events (one result touches funding, lead and addendum) becomes one refetch.
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }).catch(() => {}));
      }, 700);
    };
    const offs = LEAD_CHANGE_EVENTS.map((ev) => SocketManager.on(ev, refresh));
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => {
      offs.forEach((off) => off && off());
      appSub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryClient, keys.join('|')]);
}

export function useLeadsData(
  params?: { status?: string; period?: string },
  options?: { enabled?: boolean }
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useLiveLeadRefresh(!!user?._id && options?.enabled !== false);

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
