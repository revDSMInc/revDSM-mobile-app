/**
 * Full-schema entry seeding — a faithful TS port of the web deal center's
 * `buildAllEntriesFromSchema` (`calculator-items-format-util.js`).
 *
 * The web app persists a calculator's `entries` as the ENTIRE flattened field
 * list across every product/vertical — every field is present, with
 * `inputValue: 0` for anything the rep hasn't entered and its schema price in
 * `pricingAtTimeOfEntry`. Only the touched fields carry a non-zero `inputValue`
 * / `computed`. Every debounced `PUT /lfcalculators/{id}` therefore sends the
 * full list (see the network payload the web app produces).
 *
 * Mobile previously sent only the touched fields; these helpers seed the full
 * list so the mobile payload matches web exactly (create + every save).
 */

import type { CalculatorSchema, CalculatorField, CalculatorEntry } from '../types/calculator';
import { getCategoryDirectFields } from '../types/calculator';

/** Direct (section-less) fields save under `${categoryId}__direct` — matches web. */
export const directSectionId = (categoryId: string) => `${categoryId}__direct`;

/**
 * Build a zero-valued entry for every field across every schema/vertical,
 * deduped by field id (a field id can appear in more than one product).
 */
export function buildAllEntriesFromSchema(schemas: CalculatorSchema[]): CalculatorEntry[] {
  const entries: CalculatorEntry[] = [];
  const seen = new Set<string>();

  (schemas || []).forEach((schema) => {
    // Web tags each category with `_productName = schema.name || ''`.
    const productName = (schema as any).name || '';

    (schema.categories || []).forEach((cat) => {
      const pushField = (field: CalculatorField, sectionId: string) => {
        if (!field?.id || seen.has(field.id)) return;
        seen.add(field.id);
        const price = field.price || { cost: 0, par: 0, retail: 0 };
        entries.push({
          fieldId: field.id,
          categoryId: cat.id,
          sectionId,
          productName,
          name: field.name,
          label: field.label,
          unit: field.unit || '',
          inputValue: 0,
          computed: { cost: 0, par: 0, retail: 0 },
          pricingAtTimeOfEntry: {
            cost: String(price.cost ?? 0),
            par: String(price.par ?? 0),
            retail: String(price.retail ?? 0),
          },
        });
      };

      getCategoryDirectFields(cat).forEach((f) => pushField(f, directSectionId(cat.id)));
      (cat.sections || []).forEach((section) =>
        (section.fields || []).forEach((f) => pushField(f, section.id))
      );
    });
  });

  return entries;
}

/** Same as `buildAllEntriesFromSchema`, keyed by field id. */
export function buildAllEntriesMap(schemas: CalculatorSchema[]): Record<string, CalculatorEntry> {
  const map: Record<string, CalculatorEntry> = {};
  buildAllEntriesFromSchema(schemas).forEach((e) => {
    map[e.fieldId] = e;
  });
  return map;
}

/**
 * Overlay entered/saved entries on top of a full schema seed, so the resulting
 * map always contains every field (untouched ones at `inputValue: 0`). Used on
 * create (empty overlay → all zeros) and on hydrate (saved values fill in,
 * missing fields are back-filled from the schema).
 */
export function mergeFullEntries(
  partial: Record<string, CalculatorEntry>,
  schemas: CalculatorSchema[]
): Record<string, CalculatorEntry> {
  const seed = buildAllEntriesMap(schemas);
  return { ...seed, ...partial };
}
