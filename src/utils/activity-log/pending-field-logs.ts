/**
 * Coalescing the per-keystroke calculator field logs into ONE log per settled value.
 *
 * ⚠️ WHY. Typing `1487887` into a gutter field wrote SEVEN logs - `1`, `14`, `148`, `1487`,
 * `14878`, `148788`, `1487887` - and the portal's timeline showed every one of them, six of them
 * struck through as superseded. The web app writes a single line for the same keystrokes.
 *
 * Web does it in `ViewAllCalculators.js` (`queueRolloutLog` + `useDebounce(trigger, 1000)`): each
 * change replaces any pending change for the SAME calculator + field, and the flush fires once the
 * typing stops. This mirrors that, as a reducer so it can be tested without timers.
 *
 * ⚠️ THE PART THAT IS EASY TO GET WRONG: `oldValue` must come from the FIRST pending change, not
 * the last. Keeping the newest both ways would log `148788 -> 1487887` - the last keystroke -
 * instead of `0 -> 1487887`, which is the change the rep actually made. The web version drops the
 * whole earlier entry, so its `oldValue` survives only because the first queued entry for an
 * untouched field already carries it; being explicit here is what makes that safe.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

/** How long typing must stop before a field's log is written. Matches web's `useDebounce(_, 1000)`. */
export const FIELD_LOG_DEBOUNCE_MS = 1000;

/**
 * The value a log REPORTS for a field, as web reports it.
 *
 * ⚠️ An emptied field is `''`, never `0`. Web does exactly this
 * (`DealCenterContext.js`: `value === '' || null || undefined ? '' : Number(value)`), and the
 * portal renders an empty `newValue` as the struck-through **DELETED** row. Mobile's input
 * collapses an empty box to a number (`onChange(parseFloat(cleaned) || 0)` in `CalculatorView`,
 * which is correct - pricing and totals need a number), so the log said `Added 0' GroundSpout`
 * where web said the entry was deleted.
 *
 * ⚠️ Applied to the LOG ONLY. The entry keeps its numeric `inputValue`; nothing that prices,
 * totals or saves sees this. Web draws the same line: `buildEntry` stays numeric and only the
 * change record is sanitized.
 *
 * ⚠️ `0` TYPED ON PURPOSE is still `0`. Only an absent value becomes `''` - a rep who types a
 * literal zero said something, and web keeps that distinction too (`Number('0') === 0`).
 */
export const loggedFieldValue = (value: unknown): number | '' => {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
};

export interface PendingFieldLog {
  /** `calculatorId` + `fieldId`: the identity a later keystroke replaces. */
  calculatorId: string;
  fieldId: string;
  /** Everything the log needs; shape is `logCalculatorFieldEntry`'s options. */
  payload: Record<string, any>;
}

const keyOf = (calculatorId: string, fieldId: string): string => `${calculatorId}::${fieldId}`;

/**
 * Add a change, replacing any pending change for the same calculator + field.
 *
 * ⚠️ Returns a NEW array (the caller holds it in a ref and the flush reads it), and preserves the
 * original `oldValue` so the single surviving log spans the whole edit.
 */
export const queueFieldLog = (
  pending: readonly PendingFieldLog[] | null | undefined,
  next: PendingFieldLog
): PendingFieldLog[] => {
  const list = Array.isArray(pending) ? pending : [];
  const key = keyOf(next.calculatorId, next.fieldId);
  const existing = list.find((p) => keyOf(p.calculatorId, p.fieldId) === key);

  const merged: PendingFieldLog = existing
    ? {
        ...next,
        // ⚠️ The value the field held BEFORE this burst of typing began.
        payload: { ...next.payload, oldValue: existing.payload.oldValue },
      }
    : next;

  return [...list.filter((p) => keyOf(p.calculatorId, p.fieldId) !== key), merged];
};

/**
 * Is this change worth logging at all?
 *
 * ⚠️ A field typed back to where it started is NOT a change. Typing `5` then deleting it left
 * `0 -> 5` and `5 -> 0` in the timeline for a field the rep never actually altered. Comparing the
 * SETTLED value against the starting one removes both.
 */
export const isRealFieldChange = (oldValue: unknown, newValue: unknown): boolean => {
  const norm = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
  return norm(oldValue) !== norm(newValue);
};

/** Drop the no-op edits just before writing. */
export const settledFieldLogs = (
  pending: readonly PendingFieldLog[] | null | undefined
): PendingFieldLog[] =>
  (Array.isArray(pending) ? pending : []).filter((p) =>
    isRealFieldChange(p.payload.oldValue, p.payload.newValue ?? p.payload.fieldValue)
  );
