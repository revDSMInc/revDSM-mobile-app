import type { CalculatorSchema } from '../types/calculator';

const DIRECT_SECTION_SUFFIX = '__direct';

const COUNT_UNITS = new Set(['ea', 'each', 'ct', 'count', 'pc', 'pcs', 'unit', 'units']);

export function unitSuffix(item: { unit?: string; label?: string }): string {
  const u = String(item.unit || '').trim().toLowerCase();
  if (COUNT_UNITS.has(u)) return '';
  if (/number\s*of\s*screen/i.test(item.label || '')) return '';
  return "'";
}

export function buildSectionLabelMap(schemas: CalculatorSchema[] = []): Record<string, string> {
  const map: Record<string, string> = {};
  (schemas || []).forEach((schema) =>
    (schema.categories || []).forEach((cat) =>
      (cat.sections || []).forEach((sec) => {
        if (sec.id) map[sec.id] = sec.label || '';
      })
    )
  );
  return map;
}

export function labelWithSection(
  label: string,
  sectionId: string | undefined,
  sectionLabelMap: Record<string, string>
): string {
  const base = (label || '').trim();
  if (!base || !sectionId || sectionId.endsWith(DIRECT_SECTION_SUFFIX)) return base;
  const sectionLabel = (sectionLabelMap[sectionId] || '').trim();
  if (!sectionLabel) return base;
  const suffix = `(${sectionLabel})`;
  return base.endsWith(suffix) ? base : `${base} (${sectionLabel})`;
}
