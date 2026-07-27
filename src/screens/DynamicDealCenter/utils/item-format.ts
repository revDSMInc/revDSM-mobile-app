/**
 * Calculator line-item formatting — 1:1 port of the web deal center's
 * `calculator-items-format-util.js` (`formatQuantityWithUnit` +
 * `formatItemLabelWithSection`). Used by every place that lists entered items
 * (Job Summary, rollout quote card, Result Lead summary, locked receipt) so the
 * mobile rows read exactly like web:  `5' 5" Gutter/DS/E (All Stories)`.
 */

import type { CalculatorSchema } from '../types/calculator';

/** Sections whose id ends with this suffix are "direct" (section-less) fields. */
const DIRECT_SECTION_SUFFIX = '__direct';

/**
 * Units that represent a discrete count (e.g. screens) — these keep a plain
 * quantity. Everything else (linear-foot products, incl. blank/"ft" units) gets
 * the `'` foot mark. Mirrors web `COUNT_UNITS`.
 */
const COUNT_UNITS = new Set(['ea', 'each', 'ct', 'count', 'pc', 'pcs', 'unit', 'units']);

/**
 * The unit suffix rendered right after the quantity (call sites do
 * `{qty}{unitSuffix(item)}`): a count unit → '' (bare number), everything else →
 * the foot mark. A "Number of Screen" field is treated as a count even if its
 * unit isn't a known count word (defensive).
 */
export function unitSuffix(item: { unit?: string; label?: string }): string {
  const u = String(item.unit || '').trim().toLowerCase();
  if (COUNT_UNITS.has(u)) return '';
  if (/number\s*of\s*screen/i.test(item.label || '')) return '';
  return "'";
}

/** Build a `sectionId → section label` map from the schemas (direct sections excluded). */
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

/**
 * Append `(sectionLabel)` for fields inside an open section (web
 * `formatItemLabelWithSection`); direct (section-less) fields stay unchanged, and
 * a label already ending with the suffix is left as-is.
 */
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
