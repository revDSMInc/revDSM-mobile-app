/**
 * scope-signature.ts — a stable fingerprint of a calculator's ENTERED job scope.
 *
 * Each entered item (a field whose `inputValue > 0`) contributes `fieldId:qty`, and
 * the whole thing is sorted so the string is order-independent. Adding or removing a
 * line item OR changing a quantity changes the signature; untouched zero-seeded
 * fields never affect it.
 *
 * This is the basis for the Dynamic Deal Center rollout warning: when the rep enters
 * a Rollout End Price we snapshot this signature onto the calculator
 * (`CalcTab.priceScopeSig`). If they later go back to the calculator and change the
 * job scope, the live signature no longer matches the snapshot, so the rollout shows
 * "⚠️ Job Scope was changed. Please review the Rollout End Price." — WITHOUT ever
 * clearing the price the rep entered. Both the persistence hook and the rollout view
 * use this one function so the snapshot and the comparison can never diverge.
 */
export function scopeSignature(entries: Record<string, any> = {}): string {
  return Object.entries(entries)
    .filter(([, e]) => Number(e?.inputValue) > 0)
    .map(([id, e]) => `${id}:${Number(e.inputValue)}`)
    .sort()
    .join('|');
}
