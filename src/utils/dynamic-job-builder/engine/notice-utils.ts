/**
 * Reusable "Important Notice" helpers (port of web `engine/notice-utils.js`).
 *
 * Any field can carry an optional notice popup:
 *   field.notice = {
 *     enabled: boolean,
 *     head: string,             // popup title
 *     dealsDescription: string, // popup body
 *     triggerValue?: string,    // value that triggers it (empty = any non-empty value)
 *   }
 *
 * Field-type agnostic so it can be wired into dropdowns, toggles, or any other
 * widget. Used e.g. for LeafFilter Versa Max + gutter opening width `< 2.5`.
 */

export interface FieldNotice {
  enabled: boolean;
  head: string;
  dealsDescription: string;
  triggerValue: string;
}

export function normalizeFieldNotice(notice: any): FieldNotice | null {
  if (!notice || typeof notice !== 'object') return null;
  if (!notice.enabled) return null;
  return {
    enabled: true,
    head: notice.head || '',
    dealsDescription: notice.dealsDescription || '',
    triggerValue: notice.triggerValue || '',
  };
}

export function hasFieldNotice(field: any): boolean {
  return Boolean(field?.notice?.enabled);
}

function valueMatchesTrigger(value: any, triggerValue: string): boolean {
  if (Array.isArray(value)) {
    if (triggerValue) return value.includes(triggerValue);
    return value.length > 0;
  }
  const current = value == null ? '' : String(value);
  if (triggerValue) return current === triggerValue;
  return current !== '';
}

/**
 * Returns the notice content to show for a field's current value, or null.
 * - With a triggerValue: shows only when the value matches it.
 * - Without a triggerValue: shows for any non-empty value.
 */
export function resolveFieldNotice(
  field: any,
  value: any,
): { head: string; dealsDescription: string } | null {
  const notice = normalizeFieldNotice(field?.notice);
  if (!notice) return null;
  if (!notice.head && !notice.dealsDescription) return null;
  if (!valueMatchesTrigger(value, notice.triggerValue)) return null;
  return { head: notice.head, dealsDescription: notice.dealsDescription };
}
