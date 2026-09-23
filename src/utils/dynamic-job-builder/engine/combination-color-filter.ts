/**
 * "In My Deals, only show a LeafFilter combination whose colour has been chosen."
 *
 * A combination the rep never finished — no colour picked — is noise in the edit
 * wizard: it cannot be reviewed or signed off, and on a multi-combination deal it
 * pushes the finished ones off screen.
 *
 * ⚠️ This is a DISPLAY filter for the edit flow only. It must never drop a
 * combination from job state: the data still round-trips untouched, so nothing is
 * destroyed by hiding it and the create flow is unaffected.
 */

/** Field types the renderer draws as a colour control. */
const COLOR_FIELD_TYPES = new Set([
  'swatch',
  'color',
  'colorSelection',
  'inputWithColor',
  'lockedWithColor',
]);

export function isColorField(field: any): boolean {
  if (!field) return false;
  if (COLOR_FIELD_TYPES.has(field.type)) return true;
  // `renderField` also draws a plain `text`/`locked` field as a SwatchPicker when
  // it carries a palette or an explicit colour list, so type alone is not enough.
  return Boolean(field.palette || field.colors?.length || field.colorKey);
}

/**
 * A combination's colour value, checked everywhere the engine stores one: the
 * field id, the field key, and the `colorValues` side-map (which is how a picked
 * colour survives the save round-trip for `inputWithColor` / `colorKey` fields).
 */
export function resolveComboColorValue(field: any, combo: any = {}): any {
  const colorValues = combo?.colorValues || {};
  const candidates = [
    combo?.[field?.id],
    field?.key ? combo?.[field.key] : undefined,
    colorValues?.[field?.id],
    field?.key ? colorValues?.[field.key] : undefined,
    field?.colorKey ? colorValues?.[field.colorKey] : undefined,
    field?.colorKey ? combo?.[field.colorKey] : undefined,
  ];
  return candidates.find((v) => v !== undefined && v !== null && v !== '') ?? '';
}

/**
 * Flattens container fields (`stack`, `accordion`, anything else holding `fields`).
 *
 * ⚠️ Load-bearing. A LeafFilter colour is authored INSIDE a stack — the amber
 * "INCOMPLETE - Color Required" card is that stack — so the row-field list the
 * renderer passes contains the STACK, not the colour. Searching that list
 * unflattened found no colour field at all, fell through to the "no colour field →
 * always show" rule, and every unfinished combination stayed on screen.
 *
 * Container children live FLAT in the combination's state (same convention
 * `buildDefaultItemFromFields` uses), so a nested colour's value is still read
 * straight off `combo[field.id]`.
 */
function flattenFields(fields: any[] = []): any[] {
  const out: any[] = [];
  (fields || []).forEach((field) => {
    if (!field) return;
    if (Array.isArray(field.fields) && field.fields.length) {
      out.push(...flattenFields(field.fields));
      return;
    }
    out.push(field);
  });
  return out;
}

/**
 * True when the combination may be shown.
 *
 * ⚠️ A combination carrying NO colour field at all is always shown. The rule is
 * "an unanswered colour hides it", not "a colour is required" — gating on a field
 * the config never put there would blank out whole verticals.
 *
 * Where a combination has several colour fields, every one must be answered. They
 * are all part of the same finished combination, so a half-filled one is exactly
 * the unfinished case this exists to hide.
 */
export function comboHasSelectedColor(combo: any, fields: any[] = []): boolean {
  const colorFields = flattenFields(fields).filter(isColorField);
  if (!colorFields.length) return true;
  return colorFields.every((field) => !!resolveComboColorValue(field, combo));
}
