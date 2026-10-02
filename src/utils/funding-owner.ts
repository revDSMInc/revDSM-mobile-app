/**
 * Which calculator a lead's funding record was last saved from.
 *
 * ⚠️ The funding record is LEAD-scoped (`/lead/v1/:leadId/funding`) and carries no
 * calculator id, so a lead worked across several calculators has ONE set of payment rows
 * that every Result Lead sheet used to hydrate from — financing picked while resulting
 * calculator A appeared on calculator B. The owner is remembered on the device instead.
 */
export const fundingOwnerKey = (leadId: string) => `funding-owner:${leadId}`;

/**
 * Should the Result Lead sheet for `calculatorId` adopt the saved funding rows?
 *
 * - No owner recorded (older data) → adopt; the caller then CLAIMS it for this calculator
 *   (`fundingOwnerKey`) so no other calculator can pick it up afterwards.
 * - Same calculator → adopt.
 * - ⚠️ Another calculator's rows → NEVER adopt, started or not. An earlier version let
 *   started rows through to avoid a 409 on save, and that is exactly how one calculator's
 *   funding kept appearing on its sibling.
 */
export function shouldAdoptSavedFunding(
  owner: string | null | undefined,
  calculatorId: string | null | undefined
): boolean {
  if (!owner || !calculatorId) return true;
  return String(owner) === String(calculatorId);
}
