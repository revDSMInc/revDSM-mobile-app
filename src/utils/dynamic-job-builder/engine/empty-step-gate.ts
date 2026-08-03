/**
 * empty-step-gate.ts — the "No details on this step yet" gate for deal-EDIT.
 *
 * Verbatim port of web `dynamic-job-builder.js` `stateHasContent` (lines 40-60)
 * and `collectLockedFieldIds` (lines 62-77). Introduced in web commit 301a2fdc
 * ("Dynamic deal-edit modal + edit-mode builder").
 *
 * In the My Deals / deal-edit builder, a step whose saved state holds no
 * REP-ENTERED value is surfaced with a soft "Add details / Skip" prompt instead
 * of dropping the rep straight into a blank form. Deal-center-seeded values
 * (locked / dcValue fields carried over from the calculator, e.g. LeafFilter
 * Profile, Gutter Opening Width) do NOT count as content — otherwise every step
 * the calculator touched would look filled even though the rep entered nothing.
 */

/**
 * Does a tab's saved state hold any real user value?
 *
 * `0`, `''`, whitespace-only strings, the numeric string `"0"`, `false`,
 * null/undefined and empty arrays/objects all count as NO content. A non-empty
 * string that isn't a zero-number, or any non-zero number/true, counts. Structural
 * keys and any `lockedFieldIds` key are skipped — the latter is what keeps
 * calculator-seeded defaults from reading as rep input.
 */
export function stateHasContent(obj: any, lockedFieldIds?: Set<string>): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'number') return obj !== 0;
  if (typeof obj === 'boolean') return obj;
  if (typeof obj === 'string') {
    const t = obj.trim();
    if (t === '') return false;
    const num = Number(t);
    return Number.isNaN(num) ? true : num !== 0;
  }
  if (Array.isArray(obj)) return obj.some((v) => stateHasContent(v, lockedFieldIds));
  if (typeof obj === 'object') {
    return Object.entries(obj).some(([k, v]) => {
      if (k === 'colorValues' || k === '_combinationNumber' || k === '_storageVersion') {
        return false;
      }
      if (lockedFieldIds && lockedFieldIds.has(k)) return false;
      return stateHasContent(v, lockedFieldIds);
    });
  }
  return false;
}

/**
 * Ids of every locked (deal-center-seeded) field across the whole config —
 * fields flagged `locked`, or of type `locked` / `lockedWithColor`, walked
 * recursively through `tab.fields`, `section.fields`, and `combinations.fields`.
 */
export function collectLockedFieldIds(config: any): Set<string> {
  const set = new Set<string>();
  const walk = (fields: any[]) =>
    (fields || []).forEach((f: any) => {
      if (f?.id && (f.locked || f.type === 'locked' || f.type === 'lockedWithColor')) {
        set.add(f.id);
      }
      if (f?.fields) walk(f.fields);
    });
  (config?.verticals || []).forEach((v: any) =>
    (v.tabs || []).forEach((t: any) => {
      walk(t.fields);
      (t.sections || []).forEach((s: any) => walk(s.fields));
      if (t.combinations?.fields) walk(t.combinations.fields);
    })
  );
  return set;
}
