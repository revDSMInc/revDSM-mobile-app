/**
 * When is the deal-edit wizard allowed to decide a deal "can't be edited here"?
 *
 * Reported from device: opening Edit Job Build **quickly** showed the dead-end
 * screen on a perfectly editable deal; going back, waiting a second or two and
 * reopening worked. That is the signature of a readiness gate that does not
 * cover every request the decision depends on — the second attempt only
 * succeeded because the query cache was warm.
 *
 * Pure so the ordering can be tested; `DynamicDealEditScreen` renders from it.
 */

/** Every async input the "can this be edited" decision reads. */
export interface DealEditLoadState {
  /** Job-builder config request in flight. */
  configLoading: boolean;
  /** Calculator schemas request in flight. */
  schemasLoading: boolean;
  /** The saved outcome query has settled (success OR error). */
  outcomeFetched: boolean;
  /**
   * The saved calculator request is in flight.
   *
   * ⚠️ This is the one that was missing. `savedDynamicJobState` is derived from
   * the outcome AND the calculator, so judging a deal before this settles reads
   * a half-loaded state as "no dynamic data".
   */
  calculatorLoading: boolean;
  /**
   * The portal job-builder request is in flight.
   *
   * ⚠️ For many deals the portal record is the ONLY place the build lives —
   * not the outcome, not the lead. Judging before it settles is the second half
   * of the same bug the calculator caused.
   */
  portalLoading: boolean;
}

/**
 * True while the screen must show a spinner rather than judge the deal.
 *
 * ⚠️ Every member matters. Dropping one does not produce a visibly broken
 * screen — it produces an INTERMITTENT wrong answer that looks like a backend
 * problem and disappears whenever the cache happens to be warm.
 */
export function isDealEditLoading(s: DealEditLoadState): boolean {
  return (
    s.configLoading ||
    s.schemasLoading ||
    !s.outcomeFetched ||
    s.calculatorLoading ||
    s.portalLoading
  );
}

/**
 * True only once every input has settled AND the deal genuinely has nothing to
 * edit. Callers must never render the dead end while `isDealEditLoading`.
 */
export function showsCannotEdit(
  load: DealEditLoadState,
  deal: { hasJobBuilderConfig: boolean; isDynamicDeal: boolean; builderReady: boolean },
): boolean {
  if (isDealEditLoading(load)) return false;
  return !deal.hasJobBuilderConfig || !deal.isDynamicDeal || !deal.builderReady;
}
