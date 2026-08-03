/**
 * Thousands-separator formatting for the deal center's live price inputs.
 *
 * These inputs keep the RAW digit string in state (`'195000'`) — that is what
 * `parseFloat` and every validation/save path reads — and only the DISPLAYED
 * value is grouped (`'195,000'`). Formatting is therefore purely additive: it
 * inserts commas and changes nothing else, so a round trip through
 * `stripAmount(formatAmountInput(raw))` always returns `raw`.
 */

/**
 * Group the integer part of a raw amount string with commas, preserving a
 * trailing '.' and any decimals so the value can still be typed through.
 * Expects the already-stripped raw string (see `stripAmount`).
 *
 *   '195000'    → '195,000'
 *   '1234567.5' → '1,234,567.5'
 *   '195000.'   → '195,000.'      (mid-typing, decimal point kept)
 *   ''          → ''
 */
export function formatAmountInput(raw: string): string {
  const value = String(raw ?? '');
  if (!value) return '';
  const [intPart, ...rest] = value.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // rest is rejoined with '.' rather than collapsed, so a stray second decimal
  // point the user typed survives unchanged and parseFloat treats it as before.
  return rest.length ? `${grouped}.${rest.join('.')}` : grouped;
}

/**
 * Reduce a displayed/typed amount back to the raw digit string held in state.
 * Drops the commas this module adds along with anything else non-numeric —
 * the same `[^0-9.]` strip these inputs already applied to their own input.
 */
export function stripAmount(text: string): string {
  return String(text ?? '').replace(/[^0-9.]/g, '');
}
