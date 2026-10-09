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

// Option text and the authored trigger are typed by different people: compare ignoring case, spacing and
// the quote / less-than glyph variants (`<2.5"`, `< 2.5″`, `&lt;2.5”`), or a visible option never fires.
function normalizeTriggerText(text: any): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\u2033\u201c\u201d\u201e\u2036]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/\s+/g, '');
}

function valueMatchesTrigger(value: any, triggerValue: string): boolean {
  const wanted = normalizeTriggerText(triggerValue);
  if (Array.isArray(value)) {
    if (wanted) return value.some((v) => normalizeTriggerText(v) === wanted);
    return value.length > 0;
  }
  const current = value == null ? '' : String(value);
  if (wanted) return normalizeTriggerText(current) === wanted;
  return current !== '';
}

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

// Web's static LeafFilter section hard-codes this popup (`gutterOpeningWidth === '< 2.5'`) and the portal-authored
// `field.notice` does not always carry it, so the dynamic builder never showed it. This is the built-in rule,
// used when the field has no notice of its own: a "Gutter Opening Width" field set to `< 2.5`.
export const BUILTIN_GUTTER_WIDTH_NOTICE = {
  head: 'Important Notice',
  dealsDescription: "Ensure Agreement has Special Can't Guarantee Cleaning or Sealing Clause.",
};

export function isGutterOpeningWidthField(field: any): boolean {
  return /gutter\s*opening\s*width/i.test(String(field?.label || field?.title || field?.name || ''));
}

export function resolveBuiltinFieldNotice(
  field: any,
  value: any,
): { head: string; dealsDescription: string } | null {
  if (!isGutterOpeningWidthField(field)) return null;
  return normalizeTriggerText(value) === '<2.5' ? { ...BUILTIN_GUTTER_WIDTH_NOTICE } : null;
}

/** The field's own notice, else the built-in one. */
export function resolveAnyFieldNotice(field: any, value: any) {
  return resolveFieldNotice(field, value) || resolveBuiltinFieldNotice(field, value);
}
