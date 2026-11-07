/**
 * What the Investment Center's "Secure This Price" popup offers (REVUIUX-594).
 *
 * The client: *"I should be able to switch between CK, CC, or the monthly payment plan(s) I added
 * on investment center."* The popup follows the rollout's drop card, and these rules decide which
 * methods and plans it lists.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

export interface MethodBadge {
  key: string;
  label: string;
}

export interface PlanOption {
  key: string;
  monthly: number;
  terms: string;
}

/**
 * CK and CC (ACH and CC on a Lowe's lead), in the card's own order.
 *
 * ⚠️ AMEX is not offered here, because the client named only CK and CC, but it is shown when it is
 * the method already selected. Otherwise the popup would claim to secure a price with no method
 * highlighted at all.
 */
export const optInMethodBadges = (
  all: readonly MethodBadge[] | null | undefined,
  selectedKey: string | null | undefined,
  isLowesLead = false,
): MethodBadge[] => {
  const offered = isLowesLead ? ['lowes_ach', 'lowes_cc'] : ['check', 'mcVisaDscvr'];
  return (all || []).filter((b) => offered.includes(b.key) || b.key === selectedKey);
};

/**
 * The card's added plans, plus the selected plan if it is not among them.
 *
 * ⚠️ `paymentChoice` is seeded from the saved plan and the shortlist from `addedPlans`, and nothing
 * forces the second to contain the first. Without this the popup could show no row for the plan
 * being secured. Returns the same array when nothing is added, so a caller's memo holds.
 */
export const optInPlanOptions = (
  shortlist: readonly PlanOption[] | null | undefined,
  selected: PlanOption | null | undefined,
): readonly PlanOption[] => {
  const list = shortlist || [];
  if (!selected?.key || list.some((p) => p.key === selected.key)) return list;
  return [...list, selected];
};
