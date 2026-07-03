/**
 * Schema-aware dynamic tab naming — a TS port of the web deal center's
 * schema naming (`tab-naming.utils.js`: getCategoryInitials /
 * getLiveSchemaBaseName / getSchemaUpdatedCalculatorTitles).
 *
 * A calculator has NO fixed name: its title is derived live from which schema
 * categories have at least one filled field, joined by category initials
 * (e.g. gutters + leaffilter filled → "G+LF"). Duplicate names are disambiguated
 * by retail price with SM/MD/LG… suffixes, or flagged "⚠️ base ⚠️" when two
 * calculators share the same base name AND price.
 */

import type { CalculatorSchema, CalculatorCategory, CalculatorEntry, CalculatorField } from '../types/calculator';
import { getCategoryDirectFields, getCategorySectionFields } from '../types/calculator';

const SIZING_LABELS = ['SM', 'MD', 'LG', 'XL', 'XXL', 'XXL-2', 'XXL-3', 'XXL-4', 'XXL-5'];

function getCategoryAllFields(cat: CalculatorCategory): CalculatorField[] {
  return [...getCategoryDirectFields(cat), ...getCategorySectionFields(cat)];
}

/**
 * "Gutters" → "G", "LeafFilter" → "LF", "Additional Services" → "AS".
 * Single word → first letter; multi-word (incl. camelCase) → first of each.
 */
export function getCategoryInitials(categoryName?: string): string {
  if (!categoryName) return '';
  const words = categoryName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 1) return words[0][0].toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('');
}

/** Base name from the live entries map (keyed by field id) + configured schemas. */
export function getLiveSchemaBaseName(
  entries: Record<string, CalculatorEntry>,
  schemas: CalculatorSchema[]
): string {
  if (!schemas || schemas.length === 0) return '';
  const parts: string[] = [];
  schemas.forEach((schema) => {
    (schema.categories || []).forEach((cat) => {
      const hasFilled = getCategoryAllFields(cat).some((f) => {
        const entry = entries?.[f.id];
        return entry && Number(entry.inputValue) > 0;
      });
      if (hasFilled) {
        const initials = getCategoryInitials(cat.name || cat.label || '');
        if (initials && !parts.includes(initials)) parts.push(initials);
      }
    });
  });
  return parts.length > 0 ? parts.join('+') : '';
}

export interface TabNameInput {
  id: string;
  entries: Record<string, CalculatorEntry>;
  /** retail total, used only to disambiguate same-named calculators */
  price: number;
  /** a manual (session) rename that overrides the derived name */
  manualTitle?: string;
}

/**
 * Computes the display title for every calculator: id → title.
 * Manual renames win; empty (no entries) calculators fall back to their 1-based
 * position; otherwise the schema-derived base name + collision suffix is used.
 */
export function computeDerivedTitles(tabs: TabNameInput[], schemas: CalculatorSchema[]): Record<string, string> {
  const result: Record<string, string> = {};
  const withBase: Array<{ id: string; base: string; price: number }> = [];

  tabs.forEach((t, i) => {
    if (t.manualTitle) {
      result[t.id] = t.manualTitle;
      return;
    }
    const base = getLiveSchemaBaseName(t.entries, schemas);
    if (!base) {
      result[t.id] = String(i + 1);
      return;
    }
    withBase.push({ id: t.id, base, price: t.price || 0 });
  });

  const groups: Record<string, Array<{ id: string; base: string; price: number }>> = {};
  withBase.forEach((item) => {
    (groups[item.base] = groups[item.base] || []).push(item);
  });

  Object.keys(groups).forEach((base) => {
    const group = groups[base];
    const priceCounts: Record<string, number> = {};
    group.forEach((it) => {
      priceCounts[it.price] = (priceCounts[it.price] || 0) + 1;
    });
    const levels = [...new Set(group.map((it) => it.price))].sort((a, b) => a - b);

    group.forEach((it) => {
      if (priceCounts[it.price] > 1) {
        result[it.id] = `⚠️ ${it.base} ⚠️`;
      } else if (levels.length > 1) {
        const idx = levels.indexOf(it.price);
        const label = SIZING_LABELS[idx] || `XXL-${idx - 4}`;
        const suffix = levels.length === 2 ? ` (${idx === 0 ? 'SM' : 'LG'})` : ` (${label})`;
        result[it.id] = `${it.base}${suffix}`;
      } else {
        result[it.id] = it.base;
      }
    });
  });

  return result;
}
