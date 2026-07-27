/**
 * Required-value checks aligned with portal Job Builder Preview.
 * Number fields treat 0 / '0' as incomplete when conditionally required — EXCEPT
 * the miters / end-caps count fields, where an explicitly-entered 0 is a valid
 * answer (a straight gutter run legitimately has 0 miters / 0 end caps). A blank
 * field still counts as missing, so the rep must still answer it — only a typed 0
 * passes.
 *
 * This is a mobile-only, product-owner-requested divergence from web (web's
 * field-value-utils.js treats EVERY required number of 0 as incomplete). It is
 * scoped to miters/end caps and mirrors the legacy static Job Builder, which
 * validates these counts with `=== ''` and so already accepts a typed 0.
 */

/**
 * Miters / end-caps count fields accept an explicitly-entered 0 as a valid answer.
 * Matched by NAME (key + label) rather than a fixed key so it holds across config
 * variants — the dynamic template keys these `mitersOut`/`endCapsR`, the legacy
 * builder `mitersOutside`/`endCapsRights`, and the backend may label them anything
 * containing "miter"/"end cap".
 */
export function isZeroAllowedNumberField(field: any): boolean {
  if (!field || field.type !== 'number') return false;
  const hay = `${field.key || ''} ${field.label || field.title || ''}`.toLowerCase();
  return /miter/.test(hay) || /end\s*-?\s*cap/.test(hay);
}

export function isRequiredNumberValueMissing(value: any) {
  return value === undefined || value === null || value === '' || value === 0 || value === '0';
}

export function isRequiredFieldValueMissing(field: any, value: any) {
  if (field?.type === 'number') {
    // Miters/end caps: only a BLANK is missing — an explicitly-entered 0 is a valid count.
    if (isZeroAllowedNumberField(field)) {
      return value === undefined || value === null || value === '';
    }
    return isRequiredNumberValueMissing(value);
  }
  return value === undefined || value === null || value === '';
}
