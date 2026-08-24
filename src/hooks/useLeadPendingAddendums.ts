import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import SocketManager from '../services/SocketManager';
import { LeadService } from '../services/api/leads';
import {
  normalizePendingAddendums,
  isSnapshotForLead,
  type PendingAddendumsSnapshot,
} from '../utils/addendum-recipients';

/**
 * A lead's pending addendums + the lead-level customer contact a resend would use.
 *
 * `GET lead/v1/{leadId}/pending-addendums`, kept live by the `pending-addendum` socket
 * event. This is the "PENDING ADDENDUM" banner's own source of truth — deliberately
 * NOT the `job-builder-drafts` list the Addendums card reads, because only this
 * endpoint returns the draft ids and the contact.
 */

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
        // Same reasoning as the drafts list: "Addendums are supplementary; a failure
        // must not affect the page." A failed read must read as "nothing pending",
        // never as a broken Contract Details screen.
        console.warn('[useLeadPendingAddendums] fetch failed:', err);
        return EMPTY;
      }
    },
    enabled: Boolean(leadId),
    staleTime: 30_000,
  });

  // ── socket: `pending-addendum` on the company room ──────────────────────────
  useEffect(() => {
    if (!leadId) return undefined;

    const handler = (payload: any) => {
      const snapshot = normalizePendingAddendums(payload);
      // ⚠️ The event is COMPANY-WIDE, so it fires for every lead in the company. A
      // snapshot for a different lead must be discarded — writing it here would show
      // one lead's addendums on another's screen.
      if (!isSnapshotForLead(snapshot, leadId)) return;
      // ⚠️ REPLACE, never merge. The payload carries the whole list, and an EMPTY
      // `addendums` is a real state (the last one was signed or cancelled) that must
      // hide the banner — merging would leave a stale row on screen forever.
      queryClient.setQueryData(pendingAddendumsKey(leadId), snapshot);
    };

    return SocketManager.on('pending-addendum', handler);
  }, [leadId, queryClient]);

  /** Re-read after an action, so the banner shows what a further resend would act on. */
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: pendingAddendumsKey(leadId) });
  }, [queryClient, leadId]);

  return {
    snapshot: query.data || EMPTY,
    isLoading: query.isLoading,
    refresh,
  };
}
