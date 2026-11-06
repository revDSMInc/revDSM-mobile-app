/**
 * When a number field's local text must be overwritten by the value coming from above.
 *
 * ⚠️ `FieldRow` (`components/CalculatorView.tsx`) keeps the box's text in local state so a rep can
 * type `6.` or a leading `0` without the parent rewriting it mid-entry. The sync effect used to be
 * guarded by `if (focused) return;`, which meant a FOCUSED field ignored every incoming change -
 * so pressing the category's **Clear** left the field the rep was typing in still showing `66`
 * until they tapped away.
 *
 * Dropping the guard is not the fix either: then the parent echoing the user's own keystroke
 * rewrites `6.` to `6` as soon as the dot is typed.
 *
 * The distinction is whether the incoming value is this field's OWN last report (an echo, ignore)
 * or something else (external, accept).
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */
export const shouldAcceptExternalValue = (opts: {
  /** Is the box currently focused? */
  focused: boolean;
  /** The value arriving from the parent. */
  incoming: number;
  /** The number this field last reported upwards, or `null` if it never has. */
  lastReported: number | null;
}): boolean => {
  const { focused, incoming, lastReported } = opts;
  // Not focused: the parent is always the authority.
  if (!focused) return true;
  // Focused: accept only what this field did NOT just report.
  return incoming !== lastReported;
};

/** The text a field shows for a numeric value: blank for nothing, never `"0"`. */
export const fieldTextFor = (value: number): string => (value > 0 ? String(value) : '');
