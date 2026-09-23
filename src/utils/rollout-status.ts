/**
 * The one definition of "every rollout for this lead is confirmed".
 *
 * ⚠️ This exists because there were TWO definitions and they disagreed. The rollout
 * screen (`RolloutView.visibleCalculators`) hides calculators whose title is a bare
 * number, so it can never confirm one; the Lead Center's Investment Center gate
 * (`useLeadCalculatorStatus`) counted a bare-number calculator as real as soon as it
 * had any entered value. A lead holding such a calculator therefore read as "all
 * rollouts confirmed" in the Deal Center and "Please Fully Build ALL jobs first" in
 * the Lead Center — permanently, with nothing the rep could do about it, because the
 * calculator blocking the tile was not on the screen that confirms them.
 *
 * Both sides now come through here. Keep it free of React Native imports so it stays
 * testable under jest.
 */

/**
 * A bare-number title ("1", "2") marks an auto-created placeholder tab rather than a
 * calculator the rep built. The rollout screen hides these, so nothing may gate on one.
 */
export const isPlaceholderCalculatorTitle = (title?: string | null): boolean =>
  /^\d+$/.test(String(title ?? '').trim());

/** The calculators the rollout screen shows — and therefore the only ones it can confirm. */
export const rolloutCalculators = <T extends { title?: string | null }>(calculators: T[]): T[] =>
  (calculators || []).filter((c) => !!c && !isPlaceholderCalculatorTitle(c.title));

/**
 * Web `allJobsConfirmed`: there is at least one confirmable calculator and every one of
 * them has a confirmed rollout. An empty list is NOT confirmed — a lead with nothing
 * built has not built everything.
 */
export const allRolloutsConfirmed = <
  T extends { title?: string | null; isRolloutConfirmed?: boolean }
>(
  calculators: T[]
): boolean => {
  const confirmable = rolloutCalculators(calculators || []);
  return confirmable.length > 0 && confirmable.every((c) => !!c.isRolloutConfirmed);
};
