/**
 * Returning to Lead Center from a screen that was opened FROM Lead Center.
 *
 * ⚠️ THE BUG. "Jobs Built — Back to Tools" called `navigation.navigate('LeadCenter', { lead, tab })`.
 * React Navigation only REUSES an existing route when the params match; with different params it
 * PUSHES a second copy. The stack became
 *
 *     Leads → LeadCenter → DynamicDealCenter → LeadCenter
 *
 * so the rep pressed back and landed on Lead Center again instead of the leads list - from the
 * header arrow, the Android hardware back, and the iOS swipe alike, because all three just pop.
 *
 * ⚠️ A blind `goBack()` is NOT the fix. Deal Center is opened from Lead Center, Investment Center,
 * Deal Detail, notifications and push - `goBack` would return to whichever of those pushed it,
 * and from a push there may be no Lead Center in the stack at all.
 *
 * Pure so it can be tested; the caller owns the navigator (CLAUDE.md §6).
 */

export interface NavRouteLike {
  name: string;
  key?: string;
}

export type BackToLeadCenterPlan =
  | { action: 'pop'; count: number }
  | { action: 'navigate' };

/**
 * How to get back to Lead Center from the screen currently on top.
 *
 * `routes` is the stack bottom-first, as `navigation.getState().routes` gives it.
 *
 * ⚠️ Finds the LAST Lead Center below the top, not the first. A rep can legitimately be deep in
 * `LeadCenter → DynamicDealCenter → LeadCenter(other lead) → DynamicDealCenter`; popping to the
 * FIRST would throw away a screen they still expect behind them.
 */
export const planBackToLeadCenter = (
  routes: readonly NavRouteLike[] | null | undefined,
  leadCenterName = 'LeadCenter'
): BackToLeadCenterPlan => {
  const stack = routes || [];
  // Everything below the top; the top is the screen we are leaving.
  for (let i = stack.length - 2; i >= 0; i -= 1) {
    if (stack[i]?.name === leadCenterName) {
      return { action: 'pop', count: stack.length - 1 - i };
    }
  }
  // Nothing to go back TO - opened from a push notification, or a cold deep link.
  return { action: 'navigate' };
};
