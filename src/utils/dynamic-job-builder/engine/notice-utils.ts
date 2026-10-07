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
