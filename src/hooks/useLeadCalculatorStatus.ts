import { useQuery, type QueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { allRolloutsConfirmed } from '../utils/rollout-status';

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

/** The stable part of the query key — the lead id survives a lead refetch, the rest may not. */
const statusKeyPrefix = (leadKey: string) => ['lead-calc-status', leadKey];

const leadKeyOf = (lead: any) => String(lead?._id || lead?.selfGenLeadId || lead?.id || '');

/**
 * Leads whose rollouts were just confirmed locally, and when.
 *
 * The confirmation is written by the deal center's DEBOUNCED save engine, so the
 * `PUT /lfcalculators/{id}` can still be in flight when the tools list reads back.
 * Without this override the Investment Center tile would unlock instantly and then
 * RE-LOCK on the first server read — visibly worse than the delay being removed.
 * The window is bounded, so the server is authoritative again moments later and a
 * genuinely unconfirmed lead can never stay unlocked.
 */
const LOCAL_CONFIRM_GRACE_MS = 60_000;
const locallyConfirmedAt = new Map<string, number>();

function applyLocalConfirmation(leadKey: string, status: LeadCalculatorStatus): LeadCalculatorStatus {
  const at = locallyConfirmedAt.get(leadKey);
  if (!at) return status;
  // Server agrees, or the window elapsed → stop overriding and let it speak.
  if (status.allConfirmed || Date.now() - at > LOCAL_CONFIRM_GRACE_MS) {
    locallyConfirmedAt.delete(leadKey);
    return status;
  }
  return { ...status, hasCalculator: true, allConfirmed: true, count: Math.max(status.count, 1) };
}

/**
 * Record that every rollout for this lead was just confirmed, and unlock the
 * Investment Center tile IMMEDIATELY.
 *
 * The rep has just done the thing the tile waits for, so making them watch two
 * GETs (`/appointments` then `/lfcalculators`) resolve before the tile opens is
 * pure latency over information the app already has.
 *
 * Updates by key PREFIX: `LeadCenter` re-fetches its lead, so the `appointmentId`
 * / `leadDate` segments can differ from the copy the deal center was handed — only
 * the lead id is dependable.
 */
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
      // Every exit goes through `applyLocalConfirmation`, including the error paths
      // — a transient failure to resolve the appointment must not re-lock a tile the
      // rep just earned.
      const resolve = (status: LeadCalculatorStatus) => applyLocalConfirmation(leadKey, status);

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
          return resolve(EMPTY);
        }
      }
      if (!apptId) return resolve(EMPTY);

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
        // web `allJobsConfirmed` — ⚠️ over the calculators the ROLLOUT SCREEN can confirm,
        // NOT over `real`. `real` counts a bare-number-titled calculator once it has any
        // entered value, but `RolloutView` hides bare-number titles entirely, so such a
        // calculator can never be confirmed there. Gating on it left the Investment
        // Center tile reading "Please Fully Build ALL jobs first" forever on a lead whose
        // Deal Center showed every rollout LOCKED. `hasCalculator` deliberately stays on
        // the looser `real` rule: that answers "did the rep build anything", which is a
        // different question.
        const allConfirmed = allRolloutsConfirmed(arr);
        return resolve({ hasCalculator: real.length > 0, allConfirmed, count: real.length });
      } catch {
        return resolve(EMPTY);
      }
    },
    enabled: !!(directAppt || leadIdHuman || selfGenLeadId),
    // Keep it fresh so returning from the Deal Center reflects a new calculator /
    // confirmed rollout quickly (the tools view also refetches on focus).
    staleTime: 5000,
  });
}
