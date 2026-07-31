import type { CalculatorSchema } from '../types/calculator';
import { getCategoryDirectFields } from '../types/calculator';

// Turn a numeric story index into an ordinal (1 -> "1st", 2 -> "2nd", …).
// Web parity: DealCenterContext.getOrdinal.
function getOrdinal(n: string | number): string {
  const i = Number(n);
  if (Number.isNaN(i)) return String(n);
  const j = i % 10;
  const k = i % 100;
  const suffix =
    j === 1 && k !== 11 ? 'st' : j === 2 && k !== 12 ? 'nd' : j === 3 && k !== 13 ? 'rd' : 'th';
  return `${i}${suffix}`;
}

/**
 * When a field lives in a numbered story group (a section labelled "Story 1", "Story 2",
 * …), append the story to the LOG label so entries read "6\" Micro Mesh 1st Story". Two
 * stories in the same category (e.g. LeafFilter) usually reuse the SAME field label, so
 * without this the Story-2 log collides with / overwrites the Story-1 log. Web parity:
 * DealCenterContext.buildFieldLogLabel.
 */
export function buildFieldLogLabel(baseLabel: string, storyLabel: string): string {
  const match = /story\s*(\d+)/i.exec(storyLabel || '');
  if (!match) return baseLabel;
  return `${baseLabel} ${getOrdinal(match[1])} Story`;
}

/**
 * Resolve the story label ("Story 1", …) a calculator field belongs to, via the label of
 * the SECTION that contains it. Returns '' when the field isn't grouped under a story (a
 * direct field, or a plainly-labelled section). Web parity: DealCenterContext.
 * findFieldStoryLabel — the calculator schema nests leaf fields directly in sections (no
 * stack/accordion containers), so this checks the section label only.
 */
export function findFieldStoryLabel(fieldId: string, schemas: CalculatorSchema[] = []): string {
  if (!fieldId) return '';
  for (const schema of schemas || []) {
    const categories =
      (schema as any)?.categories || (schema as any)?.calculatorFormSchema?.categories || [];
    for (const cat of categories) {
      for (const section of cat.sections || []) {
        if ((section.fields || []).some((f: any) => f?.id === fieldId)) {
          return /story\s*\d+/i.test(section.label || '') ? section.label : '';
        }
      }
      if (getCategoryDirectFields(cat).some((f: any) => f?.id === fieldId)) return '';
    }
  }
  return '';
}
