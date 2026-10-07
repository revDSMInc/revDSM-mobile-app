import type { CalculatorSchema, CalculatorField, CalculatorEntry } from '../types/calculator';
import { getCategoryDirectFields } from '../types/calculator';

export const directSectionId = (categoryId: string) => `${categoryId}__direct`;

export function buildAllEntriesFromSchema(schemas: CalculatorSchema[]): CalculatorEntry[] {
  const entries: CalculatorEntry[] = [];
  const seen = new Set<string>();

  (schemas || []).forEach((schema) => {
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

export function buildAllEntriesMap(schemas: CalculatorSchema[]): Record<string, CalculatorEntry> {
  const map: Record<string, CalculatorEntry> = {};
  buildAllEntriesFromSchema(schemas).forEach((e) => {
    map[e.fieldId] = e;
  });
  return map;
}

export function mergeFullEntries(
  partial: Record<string, CalculatorEntry>,
  schemas: CalculatorSchema[]
): Record<string, CalculatorEntry> {
  const seed = buildAllEntriesMap(schemas);
  return { ...seed, ...partial };
}
