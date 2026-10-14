import { useQuery, type QueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { allRolloutsConfirmed } from '../utils/rollout-status';
import { readOfflineCache, writeOfflineCache, clearOfflineCache } from '../utils/offline-query-cache';
import {
  confirmedStatus,
  leadCalcStatusCacheName,
  mergeStatus,
  shouldPersistStatus,
  statusAfterFailedRead,
  type LeadCalculatorStatus,
} from '../utils/lead-calc-status';
import { getSessionOwner } from '../services/sessionScope';

export type { LeadCalculatorStatus } from '../utils/lead-calc-status';

const statusKeyPrefix = (leadKey: string) => ['lead-calc-status', leadKey];

const leadKeyOf = (lead: any) => String(lead?._id || lead?.selfGenLeadId || lead?.id || '');

/**
 * ⚠️ The confirmation is PERSISTED, not remembered for a minute.
 *
 * This used to be an in-memory Map with a 60 s grace period. A rep who confirmed rollouts, spent
 * longer than that in the Investment Center filling the form, and came back found the Investment
 * Center locked again - the grace had expired and the focus refetch (on a weak signal) returned
 * an empty status. Confirming rollouts is a fact about the deal, not a sixty-second mood.
 */
const readCachedStatus = (leadKey: string): LeadCalculatorStatus | null => {
  const name = leadCalcStatusCacheName(leadKey);
  if (!name) return null;
  return readOfflineCache<LeadCalculatorStatus>(name, { userId: getSessionOwner() })?.data ?? null;
};

const writeCachedStatus = (leadKey: string, status: LeadCalculatorStatus): void => {
  const name = leadCalcStatusCacheName(leadKey);
  if (name) writeOfflineCache(name, status, getSessionOwner());
};

export function markLeadRolloutsConfirmed(queryClient: QueryClient, lead: any) {
  const leadKey = leadKeyOf(lead);
  if (!leadKey) return;

  // ⚠️ Write to disk BEFORE touching the query cache. The rep's confirmation is a fact the
  // moment they tap; persisting only after the server agrees is what made a weak signal look
  // like lost work.
  const next = confirmedStatus(readCachedStatus(leadKey));
  writeCachedStatus(leadKey, next);

  queryClient.setQueriesData<LeadCalculatorStatus>(
    { queryKey: statusKeyPrefix(leadKey) },
    () => next
  );
}

/**
 * Forget a lead's cached status - for a genuine reset, where the rollouts really are gone.
 *
 * ⚠️ Only a deliberate reset may clear a confirmed row. A failed read must never do it; that
 * is the bug this whole module exists to prevent.
 */
export function clearLeadCalcStatus(queryClient: QueryClient | null, lead: any) {
  const leadKey = leadKeyOf(lead);
  const name = leadCalcStatusCacheName(leadKey);
  if (!name) return;
  clearOfflineCache(name, getSessionOwner());
  queryClient?.setQueriesData<LeadCalculatorStatus>(
    { queryKey: statusKeyPrefix(leadKey) },
    () => undefined as any
  );
}

export function useLeadCalculatorStatus(lead: any) {
  const directAppt = lead?.appointmentId;
  const leadIdHuman = lead?.leadId;
  const selfGenLeadId = lead?._id || lead?.selfGenLeadId || lead?.id;
  const leadDate = lead?.leadDate || lead?.lead_date;
  const leadKey = leadKeyOf(lead);

  return useQuery<LeadCalculatorStatus | null>({
    queryKey: [...statusKeyPrefix(leadKey), String(directAppt || ''), String(leadDate || '')],
    queryFn: async () => {
      const cached = readCachedStatus(leadKey);

      /**
       * ⚠️ THE FIX. This used to return EMPTY - `{ allConfirmed: false }` - whenever a request
       * failed, which told the UI the jobs were NOT built and locked the Investment Center on a
       * rep who had just built them. A lost request is no evidence about the deal. Fall back to
       * the last thing the server actually said, and to `null` ("don't know") when there is
       * nothing cached, so the card can stay neutral instead of claiming "not built".
       */
      const onFailure = () => statusAfterFailedRead(cached);

      const land = (fresh: LeadCalculatorStatus): LeadCalculatorStatus => {
        const merged = mergeStatus(fresh, cached);
        if (shouldPersistStatus(merged, cached)) writeCachedStatus(leadKey, merged);
        return merged;
      };

      let apptId: string | null = directAppt ? String(directAppt) : null;
      if (!apptId && (leadIdHuman || selfGenLeadId)) {
        try {
          const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
          const appts = res.data?.data || res.data || [];
          const found = (appts as any[]).find(
            (a) =>
              (a.leadId && a.leadId !== 'N/A' && String(a.leadId) === String(leadIdHuman)) ||
              (a.selfGenLeadId && a.selfGenLeadId !== 'N/A' && String(a.selfGenLeadId) === String(selfGenLeadId)),
          );
          if (found) apptId = String(found._id || found.id);
        } catch {
          return onFailure();
        }
      }
      // No appointment resolved. That is a real "nothing here yet" only when we had an answer
      // to begin with; otherwise keep whatever we knew.
      if (!apptId) return cached ?? null;

      try {
        const res = await LeadService.getCalculators(apptId);
        const list = res.data?.data || res.data || [];
        const arr = Array.isArray(list) ? list : [];
        const real = arr.filter((c: any) => {
          const title = String(c?.title || '').trim();
          const named = !!title && !/^\d+$/.test(title);
          const hasValue = Array.isArray(c?.entries) && c.entries.some((e: any) => Number(e?.inputValue) > 0);
          return named || hasValue;
        });
        const allConfirmed = allRolloutsConfirmed(arr);
        return land({ hasCalculator: real.length > 0, allConfirmed, count: real.length });
      } catch {
        return onFailure();
      }
    },
    enabled: !!(directAppt || leadIdHuman || selfGenLeadId),
    staleTime: 5000,
    // ⚠️ Seed from disk so the FIRST render already knows. Without this the card renders locked
    // for a moment on every entry, which is the flash the rep reads as "my work is gone".
    initialData: () => readCachedStatus(leadKey) ?? undefined,
    initialDataUpdatedAt: 0,
  });
}
