import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import SocketManager from '../services/SocketManager';
import { LeadService } from '../services/api/leads';
import {
  normalizePendingAddendums,
  isSnapshotForLead,
  type PendingAddendumsSnapshot,
} from '../utils/addendum-recipients';

const EMPTY: PendingAddendumsSnapshot = {
  leadId: '',
  pendingCount: 0,
  customer: { phone: '', email: '' },
  addendums: [],
};

export const pendingAddendumsKey = (leadId?: string) => ['lead-pending-addendums', leadId];

export function useLeadPendingAddendums(leadId?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: pendingAddendumsKey(leadId),
    queryFn: async () => {
      try {
        const res = await LeadService.getLeadPendingAddendums(leadId as string);
        return normalizePendingAddendums(res);
      } catch (err) {
        console.warn('[useLeadPendingAddendums] fetch failed:', err);
        return EMPTY;
      }
    },
    enabled: Boolean(leadId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!leadId) return undefined;

    const handler = (payload: any) => {
      const snapshot = normalizePendingAddendums(payload);
      if (!isSnapshotForLead(snapshot, leadId)) return;
      queryClient.setQueryData(pendingAddendumsKey(leadId), snapshot);
    };

    return SocketManager.on('pending-addendum', handler);
  }, [leadId, queryClient]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: pendingAddendumsKey(leadId) });
  }, [queryClient, leadId]);

  return {
    snapshot: query.data || EMPTY,
    isLoading: query.isLoading,
    refresh,
  };
}
