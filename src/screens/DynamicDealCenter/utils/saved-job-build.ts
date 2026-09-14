/**
 * Reading a saved dynamic job build off the calculator-scoped outcome
 * (`GET /lead/v1/{leadId}/outcome/{calculatorId}`).
 *
 * Extracted so the two places that ask "does this calculator already have a build?"
 * can never answer differently: `DynamicJobBuilderScreen` (which APPLIES the build)
 * and the rehash pre-check in `DynamicDealCenterScreen` (which ASKS the rep whether to
 * apply it). If the pre-check's rule were looser the rep would be asked about a build
 * that then failed to load; if tighter, a prior build would be silently applied on a
 * rehash — the exact thing the dialog exists to prevent.
 */

import { isStepPending, type OfflineLeadWork } from '../../../utils/offline-lead-work';

/** Web `calculator-outcome-api.js` › `extractCalculatorOutcome`. */
export const extractCalculatorOutcome = (body: any): any =>
  body?.data?.outcome ?? body?.outcome ?? body?.data ?? body;

/**
 * The SERIALIZED job state, or `null`.
 *
 * Web contract (`JobBuilderContext.loadCalculatorDraft`) is
 * `outcome.jobBuilder.dynamicJobState`; the other two arms tolerate older mobile saves
 * that stored the runtime state directly.
 */
export const extractSavedJobBuildState = (outcome: any): any =>
  outcome?.jobBuilder?.dynamicJobState ?? outcome?.dynamicJobState ?? outcome?.jobBuilder ?? null;

/** Is there a build worth offering to reuse? Web's guard, verbatim. */
export const hasSavedJobBuild = (outcome: any): boolean => {
  const saved = extractSavedJobBuildState(outcome);
  return !!saved && typeof saved === 'object';
};

// ─── …and which COPY of that build the rep is shown ──────────────────────────

/**
 * The SERIALIZED build this device is holding for the lead, or `null`.
 *
 * The Job Builder's offline autosave stores the very body its
 * `PUT /lead/v1/{leadId}/outcome/{calcId}` would have carried, so the saved state sits at exactly
 * the same path the server read returns it on — `extractSavedJobBuildState` reads both.
 */
export const offlineSavedJobBuildState = (work: OfflineLeadWork | null | undefined): any => {
  const outcome = (work as any)?.outcome;
  if (!outcome || typeof outcome !== 'object') return null;
  const saved = extractSavedJobBuildState(outcome);
  return saved && typeof saved === 'object' ? saved : null;
};

export type JobBuildSource =
  /** The record on this device — the only copy, or a newer one than the server holds. */
  | 'device'
  /** Ask the server, as the online flow always has. */
  | 'server';

/**
 * ⚠️ THE REPORTED BUG: the Job Builder read its saved build from the network and NOWHERE else, so
 * a rep who filled a tab with no signal, left the screen and came back was shown an EMPTY builder —
 * the outcome GET failed, its `catch` answered `undefined`, and the session dutifully restored
 * nothing over work that was sitting on the device the whole time. It only reappeared once they
 * were back on signal and the queue had drained.
 *
 * Two rules, and the first is the one with teeth:
 *
 * 1. **A PENDING draft outranks the server, signal or no signal.** That record IS the writes the
 *    server has not got, so the server's copy can only be older. This is the same rule the Deal
 *    Center already runs (`hasUnsyncedDealCenter`) and for the same reason — reading the server
 *    with one bar of signal, before the queue drains, paints the empty build the backend still has
 *    over the one the rep just entered.
 * 2. **Offline, an ALREADY-UPLOADED record is still the best copy there is.** The GET cannot
 *    answer at all, and what this device sent is by definition what the server was given. It stops
 *    being authoritative the moment there is a connection, so an edit made on the portal is never
 *    shadowed by a stale local copy.
 */
export const resolveJobBuildSource = (input: {
  work?: OfflineLeadWork | null;
  /** No connection, or an id this device minted — a GET that cannot succeed either way. */
  offline?: boolean;
}): JobBuildSource => {
  const work = input.work;
  if (!work || !offlineSavedJobBuildState(work)) return 'server';
  if (isStepPending(work, 'outcome')) return 'device';
  return input.offline ? 'device' : 'server';
};
