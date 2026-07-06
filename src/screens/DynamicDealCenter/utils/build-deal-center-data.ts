/**
 * Mobile port of the web's `build-deal-center-data.js`
 * (`src/sections/deal-center/utils/build-deal-center-data.js`).
 *
 * The dynamic job builder engine evaluates tab lock rules by checking whether
 * a key (tab.dcField) exists in `dealCenterData`. The web builds this map by:
 *   1. Extracting "field options" (id + legacy name/pricingKey aliases) from
 *      the calculator form schemas.
 *   2. For every active-calculator entry, writing the inputValue under the
 *      field's id AND all its alias keys.
 *   3. Also ingesting top-level calculator result values (versatile, pineapple,
 *      contractPrice, etc.) that the job builder config may reference via dcField.
 *
 * Without this, tabs whose `dcField` references a field by its legacy `name`
 * (rather than its `id`) would never be found → the tab stays locked.
 */

import type { CalculatorSchema } from '../types/calculator';

// ─── Field option extraction (mirrors deal-center-schema-utils.js) ────────────

export interface DealCenterFieldOption {
  key: string;      // canonical field id (used in dealCenterData)
  fieldId: string;
  legacyKey: string; // field.name or field.pricingKey (legacy alias)
  label: string;
}

/**
 * Flatten every field from every calculator form schema into a list of options.
 * Each option carries the canonical `key` (= field id) and a `legacyKey`
 * (= field.name or field.pricingKey). The same id is never added twice.
 *
 * Mirrors web `extractDealCenterFieldOptionsFromSchemas`.
 */
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

/**
 * Resolve all keys under which an entry should be stored in dealCenterData.
 * Always includes the canonical fieldId; also adds legacyKey when present.
 * Mirrors web `collectKeysForEntry` + `collectDealCenterKeysForFieldId`.
 */
function collectKeysForEntry(
  entry: { fieldId?: string; name?: string },
  fieldOptions: DealCenterFieldOption[]
): string[] {
  const keys = new Set<string>();
  const fid = entry?.fieldId;
  if (!fid) return [];

  keys.add(fid);

  // Look up the option to get the legacy key alias
  const opt = fieldOptions.find((o) => o.key === fid || o.fieldId === fid);
  if (opt) {
    keys.add(opt.key);
    if (opt.legacyKey) keys.add(opt.legacyKey);
  }

  // Also include the entry's own `name` field if present (matches web logic)
  if (entry.name) keys.add(entry.name);

  return Array.from(keys);
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export interface BuildDealCenterDataOptions {
  /**
   * The active calculator's entries keyed by fieldId.
   * Each entry: { fieldId, name?, inputValue, computed?, ... }
   */
  entries: Record<string, any>;
  /**
   * Top-level result/outcome properties (versatile, pineapple, contractPrice,
   * resultType, downPayment, balance, etc.) from the confirmed result modal.
   */
  resultData?: Record<string, any>;
  /**
   * Calculator form schemas — used to build field-option aliases so that a
   * tab.dcField referencing a field by legacy name is correctly resolved.
   */
  schemas: CalculatorSchema[];
  /**
   * Raw lead object — spread first so that any schema/result key wins over a
   * coincidental lead field with the same name.
   */
  lead?: Record<string, any>;
}

/**
 * Build the flat `dealCenterData` map that is passed into the job builder
 * engine's `getLockedTabIds` / `isTabVisible` / `evaluateRule` functions.
 *
 * Mirrors web `buildDealCenterSessionData`.
 */
export function buildDealCenterData({
  entries = {},
  resultData = {},
  schemas = [],
  lead = {},
}: BuildDealCenterDataOptions): Record<string, any> {
  const fieldOptions = extractDealCenterFieldOptions(schemas);

  // 1. Start with the lead's own data (lowest priority)
  const data: Record<string, any> = { ...(lead || {}) };

  // 2. Ingest every active calculator entry under all its known key aliases
  Object.values(entries).forEach((entry: any) => {
    if (!entry?.fieldId) return;
    const value = entry.inputValue;
    // Skip zero / null / empty — absence of key means "not entered", which is
    // what tab-lock rules check via hasDealCenterDataValue.
    // HOWEVER: we DO include 0-value fields because some allocation rules use
    // "anyNonZero" / numeric comparisons — we let the engine decide.
    if (value === '' || value === null || value === undefined) return;

    const keys = collectKeysForEntry(entry, fieldOptions);
    keys.forEach((key) => {
      data[key] = value;
    });
  });

  // 3. Ingest top-level result outcome data (contractPrice, versatile, etc.)
  //    These keys are used directly as dcField references in the job builder.
  Object.entries(resultData || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    data[key] = value;
  });

  return data;
}
