import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';

/**
 * Read-only calculator status for a lead, used by the Lead Center tools list to:
 *   - lock the Investment Center tile until a calculator exists (web parity), and
 *   - show a green status line under the Deal Center / Investment Center tiles
 *     ("Calculator created" → "Rollout confirmed").
 *
 * Unlike `useDynamicCalculators`, this NEVER creates an appointment or calculator —
 * it only resolves an EXISTING appointment (by `lead.appointmentId`, else by matching
 * the lead's human id / selfGenLeadId on its lead-date) and reads its calculators.
 * When nothing exists it reports empty status.
 */

export interface LeadCalculatorStatus {
  /** at least one real (named or non-empty) calculator exists */
  hasCalculator: boolean;
  /** web `allJobsConfirmed`: ≥1 real calculator AND every one has an confirmed rollout */
  allConfirmed: boolean;
  /** count of real calculators */
  count: number;
}

const EMPTY: LeadCalculatorStatus = { hasCalculator: false, allConfirmed: false, count: 0 };

export function useLeadCalculatorStatus(lead: any) {
  const directAppt = lead?.appointmentId;
  const leadIdHuman = lead?.leadId;
  const selfGenLeadId = lead?._id || lead?.selfGenLeadId || lead?.id;
  const leadDate = lead?.leadDate || lead?.lead_date;

  return useQuery<LeadCalculatorStatus>({
    queryKey: ['lead-calc-status', String(selfGenLeadId || ''), String(directAppt || ''), String(leadDate || '')],
    queryFn: async () => {
      // 1. Resolve an EXISTING appointment — never create one.
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
          return EMPTY;
        }
      }
      if (!apptId) return EMPTY;

      // 2. Read its calculators.
      try {
        const res = await LeadService.getCalculators(apptId);
        const list = res.data?.data || res.data || [];
        const arr = Array.isArray(list) ? list : [];
        // A "real" calculator is one the rep actually built: a non-bare-number title
        // (the derived name like "G+LF") OR at least one entered value. Bare-number
        // placeholders (an auto-created empty "1") don't count as "a calculator added".
        const real = arr.filter((c: any) => {
          const title = String(c?.title || '').trim();
          const named = !!title && !/^\d+$/.test(title);
          const hasValue = Array.isArray(c?.entries) && c.entries.some((e: any) => Number(e?.inputValue) > 0);
          return named || hasValue;
        });
        // web `allJobsConfirmed`: computed over the REAL calculators (an unbuilt
        // bare-number placeholder is hidden from the rollout and must not block it).
        const allConfirmed = real.length > 0 && real.every((c: any) => !!c?.isRolloutConfirmed);
        return { hasCalculator: real.length > 0, allConfirmed, count: real.length };
      } catch {
        return EMPTY;
      }
    },
    enabled: !!(directAppt || leadIdHuman || selfGenLeadId),
    // Keep it fresh so returning from the Deal Center reflects a new calculator /
    // confirmed rollout quickly (the tools view also refetches on focus).
    staleTime: 5000,
  });
}
