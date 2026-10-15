/**
 * Whether the Investment Center is unlocked for a lead - and, more importantly, what to do
 * when we could not find out.
 *
 * ⚠️ THE BUG THIS EXISTS TO PREVENT. A rep confirmed every rollout, walked into the Investment
 * Center, filled the form, came back - and found the Investment Center LOCKED with "Please Fully
 * Build ALL jobs first". Nothing had been lost; the screen's focus refetch ran on a weak signal,
 * the request failed, and the `catch` returned an EMPTY status. The app had turned "I could not
 * ask the server" into "the answer is no".
 *
 * ⚠️ AN UNANSWERED QUESTION IS NOT A NEGATIVE ANSWER. Every rule below exists to keep those two
 * apart. A failed read must never overwrite a known-good status, and "unknown" must never render
 * as "not built".
 */

export interface LeadCalculatorStatus {
  hasCalculator: boolean;
  allConfirmed: boolean;
  count: number;
}

export const EMPTY_CALC_STATUS: LeadCalculatorStatus = {
  hasCalculator: false,
  allConfirmed: false,
  count: 0,
};

/** The cache name used with `writeOfflineCache` / `readOfflineCache`, one row per lead. */
export const leadCalcStatusCacheName = (leadKey?: string | null): string | null =>
  leadKey ? `lead-calc-status:${leadKey}` : null;

export const isConfirmedStatus = (s?: LeadCalculatorStatus | null): boolean => !!s?.allConfirmed;

/**
 * What to show after a read FAILED.
 *
 * ⚠️ Returning `EMPTY` here is the whole bug. The cached value is the last thing the server
 * actually told us, and a lost request is no evidence against it. If there is nothing cached we
 * still return null rather than EMPTY, so the caller can render "unknown" instead of "not built".
 */
export const statusAfterFailedRead = (
  cached?: LeadCalculatorStatus | null
): LeadCalculatorStatus | null => cached ?? null;

/**
 * Merge a freshly fetched status with what we already knew.
 *
 * ⚠️ A local confirmation OUTRANKS a server read that disagrees. `markLeadRolloutsConfirmed`
 * is called the moment the rep confirms, before the write has necessarily landed; a read that
 * races it comes back `allConfirmed: false` and would re-lock the screen under the rep's hand.
 * Confirmation is not a state that goes backwards on its own - only a reset does that, and a
 * reset goes through `clearLeadCalcStatus`, not through a stale read.
 */
export const mergeStatus = (
  fresh: LeadCalculatorStatus,
  cached?: LeadCalculatorStatus | null
): LeadCalculatorStatus => {
  if (!cached) return fresh;
  if (fresh.allConfirmed || !cached.allConfirmed) return fresh;
  return {
    ...fresh,
    hasCalculator: true,
    allConfirmed: true,
    count: Math.max(fresh.count, cached.count, 1),
  };
};

/** The status to persist after the rep confirms rollouts on THIS device. */
export const confirmedStatus = (
  previous?: LeadCalculatorStatus | null
): LeadCalculatorStatus => ({
  hasCalculator: true,
  allConfirmed: true,
  count: Math.max(previous?.count ?? 0, 1),
});

/**
 * ⚠️ Worth caching? An EMPTY result is usually "the lead genuinely has no calculators yet", but
 * it is also what a half-failed lookup returns. Writing it over a confirmed row would re-create
 * the bug from the other direction, so a confirmed row is never replaced by an empty one here.
 */
export const shouldPersistStatus = (
  next: LeadCalculatorStatus,
  cached?: LeadCalculatorStatus | null
): boolean => {
  if (next.allConfirmed) return true;
  if (cached?.allConfirmed) return false;
  return true;
};

export type CalcGateState = 'unknown' | 'locked' | 'unlocked';

/**
 * What the Investment Center card should do.
 *
 * ⚠️ `unknown` must NOT lock. Locking on uncertainty is exactly what made a rep believe their
 * work had vanished in front of a customer. Unknown keeps the card usable and says it is still
 * checking; only a definite "not built" locks it.
 */
export const calcGateState = (
  status: LeadCalculatorStatus | null | undefined,
  { isSold = false }: { isSold?: boolean } = {}
): CalcGateState => {
  if (isSold) return 'unlocked';
  if (status?.allConfirmed) return 'unlocked';
  // No status at all: we have never had an answer for this lead, cached or live.
  if (!status) return 'unknown';
  return 'locked';
};

/**
 * What to return when the appointment lookup SUCCEEDED but found no appointment for this lead.
 *
 * ⚠️ That is a real answer - "no appointment, so no calculators yet" (a lead created a moment ago) - not a
 * lost request. Returning `null` here left a brand-new lead on "Checking job status..." with a spinner
 * forever, because `null` means "never got an answer". A cached row still wins (a confirmed lead must not be
 * downgraded by a lookup that merely missed it).
 */
export const statusWhenNoAppointment = (
  cached?: LeadCalculatorStatus | null
): LeadCalculatorStatus => cached ?? EMPTY_CALC_STATUS;
