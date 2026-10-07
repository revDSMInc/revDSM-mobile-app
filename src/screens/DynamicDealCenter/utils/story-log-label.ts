import type { CalculatorSchema } from '../types/calculator';
import { getCategoryDirectFields } from '../types/calculator';

function getOrdinal(n: string | number): string {
  const i = Number(n);
  if (Number.isNaN(i)) return String(n);
  const j = i % 10;
  const k = i % 100;
  const suffix =
    j === 1 && k !== 11 ? 'st' : j === 2 && k !== 12 ? 'nd' : j === 3 && k !== 13 ? 'rd' : 'th';
  return `${i}${suffix}`;
}

export function buildFieldLogLabel(baseLabel: string, storyLabel: string): string {
  const match = /story\s*(\d+)/i.exec(storyLabel || '');
  if (!match) return baseLabel;
  return `${baseLabel} ${getOrdinal(match[1])} Story`;
}

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
