import type { CalculatorSchema } from '../types/calculator';

export interface DealCenterFieldOption {
  key: string;      // canonical field id (used in dealCenterData)
  fieldId: string;
  legacyKey: string; // field.name or field.pricingKey (legacy alias)
  label: string;
}

export function extractDealCenterFieldOptions(schemas: CalculatorSchema[]): DealCenterFieldOption[] {
  const options: DealCenterFieldOption[] = [];
  const seen = new Set<string>();

  (schemas || []).forEach((schema) => {
    (schema.categories || []).forEach((category) => {
      const directFields = (category as any).directFields || (category as any).fields || [];

      const pushField = (field: any) => {
        if (!field?.id || seen.has(field.id)) return;
        seen.add(field.id);
        options.push({
          key: field.id,
          fieldId: field.id,
          legacyKey: field.name || (field as any).pricingKey || '',
          label: field.label || field.name || field.id,
        });
      };

      (directFields as any[]).forEach(pushField);
      (category.sections || []).forEach((section) => {
        (section.fields || []).forEach(pushField);
      });
    });
  });

  return options;
}

function collectKeysForEntry(
  entry: { fieldId?: string; name?: string },
  fieldOptions: DealCenterFieldOption[]
): string[] {
  const keys = new Set<string>();
  const fid = entry?.fieldId;
  if (!fid) return [];

  keys.add(fid);

  const opt = fieldOptions.find((o) => o.key === fid || o.fieldId === fid);
  if (opt) {
    keys.add(opt.key);
    if (opt.legacyKey) keys.add(opt.legacyKey);
  }

  if (entry.name) keys.add(entry.name);

  return Array.from(keys);
}

export interface BuildDealCenterDataOptions {
  entries: Record<string, any>;
  resultData?: Record<string, any>;
  schemas: CalculatorSchema[];
  lead?: Record<string, any>;
}

export function buildDealCenterData({
  entries = {},
  resultData = {},
  schemas = [],
  lead = {},
}: BuildDealCenterDataOptions): Record<string, any> {
  const fieldOptions = extractDealCenterFieldOptions(schemas);

  const data: Record<string, any> = { ...(lead || {}) };

  if (!data.customerName) {
    const cd = (lead as any)?.customerDetails || {};
    const resolvedName = cd.firstName
      ? `${cd.firstName} ${cd.lastName || ''}`.trim()
      : (lead as any)?.name || (lead as any)?.title || '';
    if (resolvedName) data.customerName = resolvedName;
  }

  const entryKeys = new Set<string>();
  const live = Object.values(entries).filter((entry: any) => {
    if (!entry?.fieldId) return false;
    const value = entry.inputValue;
    return !(value === '' || value === null || value === undefined);
  }) as any[];
  const ownIds = new Set(live.map((entry) => entry.fieldId));

  live.forEach((entry) => {
    collectKeysForEntry(entry, fieldOptions).forEach((key) => {
      if (key !== entry.fieldId && ownIds.has(key)) return;
      data[key] = entry.inputValue;
      entryKeys.add(key);
    });
  });
  live.forEach((entry) => {
    data[entry.fieldId] = entry.inputValue;
    entryKeys.add(entry.fieldId);
  });

  Object.entries(resultData || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (entryKeys.has(key)) return;
    data[key] = value;
  });

  return data;
}
