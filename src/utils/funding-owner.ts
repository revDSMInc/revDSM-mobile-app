export const fundingOwnerKey = (leadId: string) => `funding-owner:${leadId}`;

export function shouldAdoptSavedFunding(
  owner: string | null | undefined,
  calculatorId: string | null | undefined
): boolean {
  if (!owner || !calculatorId) return true;
  return String(owner) === String(calculatorId);
}
