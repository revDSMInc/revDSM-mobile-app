/**
 * "What did the rep actually change on this screen?"
 *
 * The deal-edit wizard's Job Price step has five values a rep can move — contract
 * price, down payment, balance, and the two payment methods — and web logs each one
 * as an ordinary `field_changed` row by diffing a snapshot of the screen
 * (`trackScreenValues` in `use-deal-edit-activity-log.js`). This is that diff, kept
 * pure so it can be tested: the screen owns the timer and the refs, which cannot be.
 *
 * Two rules carry all the weight, and both are web's:
 *
 *  - **The first snapshot is the BASELINE and logs nothing.** It is what the deal was
 *    saved with, not something the rep did — without this, merely opening the step
 *    would report every field as changed.
 *  - **A value edited back to where it started is not a change.** Typing over a price
 *    and undoing it must leave no trace.
 */

/** One value on screen: what it is called, what it reads, and any extra meta. */
export interface ScreenValue {
  label: string;
  value: unknown;
  /**
   * Extra meta for the row. A FUNCTION is resolved at diff time with the pair the log
   * actually reports — a value derived from the pair (the pricing tier each side of a
   * price sat at) has to be computed from those two, or a coalesced burst of
   * keystrokes stamps an intermediate one.
   */
  meta?: Record<string, unknown> | ((from: string, to: string) => Record<string, unknown>);
}

export type ScreenValues = Record<string, ScreenValue>;

export interface ScreenValueChange {
  fieldName: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  meta?: Record<string, unknown>;
}

/** Everything is logged as a string, so a `0` and a `'0'` cannot read as a change. */
const coerce = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/** The comparable form of a screen — what gets held as the baseline. */
export function snapshotScreenValues(values: ScreenValues | null | undefined): Record<string, string> {
  const snapshot: Record<string, string> = {};
  Object.entries(values || {}).forEach(([fieldName, entry]) => {
    snapshot[fieldName] = coerce(entry?.value);
  });
  return snapshot;
}

/**
 * The rows to log for this render.
 *
 * `prev` is the last snapshot; pass `null` for the first pass on a screen and nothing
 * is reported. The caller stores `snapshotScreenValues(values)` afterwards either way.
 */
export function diffScreenValues(
  prev: Record<string, string> | null | undefined,
  values: ScreenValues | null | undefined
): ScreenValueChange[] {
  if (!prev || !values) return [];

  const next = snapshotScreenValues(values);
  const changes: ScreenValueChange[] = [];

  Object.keys({ ...prev, ...next }).forEach((fieldName) => {
    const oldValue = prev[fieldName] ?? '';
    const newValue = next[fieldName] ?? '';
    if (oldValue === newValue) return;

    const entry = values[fieldName];
    const meta = typeof entry?.meta === 'function' ? entry.meta(oldValue, newValue) : entry?.meta;

    changes.push({
      fieldName,
      fieldLabel: entry?.label || fieldName,
      oldValue,
      newValue,
      ...(meta ? { meta } : {}),
    });
  });

  return changes;
}
