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
