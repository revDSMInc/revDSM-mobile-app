import { useQuery, type QueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { allRolloutsConfirmed } from '../utils/rollout-status';

export interface LeadCalculatorStatus {
  hasCalculator: boolean;
  allConfirmed: boolean;
  count: number;
}

const EMPTY: LeadCalculatorStatus = { hasCalculator: false, allConfirmed: false, count: 0 };

const statusKeyPrefix = (leadKey: string) => ['lead-calc-status', leadKey];

const leadKeyOf = (lead: any) => String(lead?._id || lead?.selfGenLeadId || lead?.id || '');

const LOCAL_CONFIRM_GRACE_MS = 60_000;
const locallyConfirmedAt = new Map<string, number>();

function applyLocalConfirmation(leadKey: string, status: LeadCalculatorStatus): LeadCalculatorStatus {
  const at = locallyConfirmedAt.get(leadKey);
  if (!at) return status;
  if (status.allConfirmed || Date.now() - at > LOCAL_CONFIRM_GRACE_MS) {
    locallyConfirmedAt.delete(leadKey);
    return status;
  }
  return { ...status, hasCalculator: true, allConfirmed: true, count: Math.max(status.count, 1) };
}

export function markLeadRolloutsConfirmed(queryClient: QueryClient, lead: any) {
  const leadKey = leadKeyOf(lead);
  if (!leadKey) return;
  locallyConfirmedAt.set(leadKey, Date.now());
  queryClient.setQueriesData<LeadCalculatorStatus>(
    { queryKey: statusKeyPrefix(leadKey) },
    (prev) => ({
      hasCalculator: true,
      allConfirmed: true,
      count: Math.max(prev?.count ?? 0, 1),
    })
  );
}

export function useLeadCalculatorStatus(lead: any) {
  const directAppt = lead?.appointmentId;
  const leadIdHuman = lead?.leadId;
  const selfGenLeadId = lead?._id || lead?.selfGenLeadId || lead?.id;
  const leadDate = lead?.leadDate || lead?.lead_date;
  const leadKey = leadKeyOf(lead);

  return useQuery<LeadCalculatorStatus>({
    queryKey: [...statusKeyPrefix(leadKey), String(directAppt || ''), String(leadDate || '')],
    queryFn: async () => {
      const resolve = (status: LeadCalculatorStatus) => applyLocalConfirmation(leadKey, status);

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
          return resolve(EMPTY);
        }
      }
      if (!apptId) return resolve(EMPTY);

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
        return resolve({ hasCalculator: real.length > 0, allConfirmed, count: real.length });
      } catch {
        return resolve(EMPTY);
      }
    },
    enabled: !!(directAppt || leadIdHuman || selfGenLeadId),
    staleTime: 5000,
  });
}
