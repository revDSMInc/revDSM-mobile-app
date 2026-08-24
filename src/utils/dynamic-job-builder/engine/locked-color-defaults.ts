/**
 * An Extras-style colour slot must not show a colour when the quantity it belongs
 * to is empty.
 *
 * Ticket: *"when i create a calculator and not hit any value in the ground spout
 * section … here you see the ground spout is still empty, if its empty than why
 * its colour field show the black colour. if there is no value than the colour
 * value should also be empty."*
 *
 * The gutter **Extras** section is authored as pairs — a locked quantity field
 * (`Ground Spout`, driven by the calculator through `dcField`) immediately
 * followed by its locked colour field. A colour field carries no `dcField`, so
 * `resolveLockedValue` falls straight through to `field.defaultValue` — the
 * portal's "if they buy one, it's Black" default — and that default rendered
 * (and was hydrated into the saved job state) even on an extra the rep never
 * quoted. `Replace Corner` showed `—` beside it only because its colour happens
 * to carry no default; the two read as contradicting each other on one screen.
 *
 * ⚠️ The pairing is POSITIONAL because nothing else links the two fields: the
 * colour has no `dcField`, no `linkedFieldId`, and (in the live config) no
 * `dependencies.requiredWhen` naming the quantity. The nearest PRECEDING
 * non-colour field in the same fields array is the authoring convention the
 * renderer already relies on — `StackFieldGrid` pairs an extras stack authored
 * as [extra, color, extra, color, …] onto one row per pair.
 *
 * ⚠️ Scoped to LOCKED colour fields. An editable colour keeps its configured
 * default as the pre-selected swatch (web `resolveEffectiveColorBehavior`), and
 * a combination's colour (gutter runs, downspouts) is editable, so neither is
 * touched by this rule.
 *
 * Pure + RN-free on purpose: `DynamicTabRenderer` and
 * `dynamic-job-state-storage` both need the same verdict, and the renderer is
 * untestable under jest here.
 */
import { isFieldLocked, resolveLockedValue } from './allocation-utils';
import { resolveConditionalDefault } from './dependency-engine';

/** Field types that hold a colour name. `colorSelection` is migrated to `swatch`
 * by `migrateLegacyColorField`, but un-migrated configs still reach here. */
export const COLOR_FIELD_TYPES = new Set(['swatch', 'color', 'colorSelection', 'customColor']);

/** Field types whose value is a typed quantity rather than a selection. */
const QUANTITY_FIELD_TYPES = new Set(['number', 'text', 'locked', 'lockedWithColor', 'inputWithColor']);

/** Structural / non-value fields, which can never be a colour's subject. */
const NON_PAIRABLE_FIELD_TYPES = new Set([
  'sectionLabel',
  'allocation',
  'combinationSummary',
  'stack',
  'accordion',
]);

/**
 * A pure colour SLOT — a field whose whole value is a colour name.
 *
 * ⚠️ `lockedWithColor` / `inputWithColor` (a quantity with an inline swatch) is
 * deliberately NOT one: its own value is the quantity, resolved from its own
 * `dcField`, so pairing it with the field above would blank a real measurement.
 * Same reason a colour carrying a `dcField` is excluded — it resolves its own
 * value from the calculator and needs no default to fall back on.
 */
export function isColorField(field: any): boolean {
  const type = field?.widget || field?.inputType || field?.type;
  if (!COLOR_FIELD_TYPES.has(type)) return false;
  if (field?.colorKey) return false;
  if (field?.dcField || field?.dcFields?.length) return false;
  return true;
}

/** True when a value counts as "the rep entered something". Mirrors the
 * `inputValue > 0` rule used everywhere else: a 0 / '0' / '' / '—' quantity is
 * nothing. Grids and multi-selects are walked so a locationGrid with one
 * measurement still counts. */
export function hasEnteredQuantity(value: any): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.some(hasEnteredQuantity);
  if (typeof value === 'object') return Object.values(value).some(hasEnteredQuantity);
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  const text = String(value).trim();
  if (!text || text === '—') return false;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric !== 0 : true;
}

/**
 * A field that holds a QUANTITY — a typed number/text box, a calculator-driven
 * (`dcField`) value, or a legacy `locked` field.
 *
 * WARNING: a toggle / dropdown / grid / room picker is NOT one, and that is what
 * keeps this rule to the Extras convention without testing the colour's `locked`
 * flag: a COMBINATION's colour follows a SELECTION (gutter runs ->
 * `[size toggle, color]`, downspouts -> `[dsType toggle, dsColor]`), so it never
 * pairs here and is never cleared behind the rep's back.
 */
export function isQuantityLikeField(field: any): boolean {
  if (!field?.id || isColorField(field)) return false;
  const type = field.widget || field.inputType || field.type;
  if (NON_PAIRABLE_FIELD_TYPES.has(type)) return false;
  if (field.key && String(field.key).startsWith('_')) return false;
  if (QUANTITY_FIELD_TYPES.has(type)) return true;
  return Boolean(field.dcField || field.dcFields?.length);
}

/**
 * The quantity field a colour slot belongs to: the nearest PRECEDING field in
 * the same list, provided it holds a quantity. Returns null when the colour
 * opens the list, or when the field above it is a SELECTION rather than a
 * quantity — the caller then leaves the colour completely alone.
 */
export function findPairedQuantityField(colorField: any, fields: any[] = []): any | null {
  if (!colorField?.id || !Array.isArray(fields)) return null;
  const index = fields.findIndex((f) => f?.id === colorField.id);
  if (index <= 0) return null;

  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = fields[i];
    if (!candidate?.id) continue;
    if (isColorField(candidate)) continue;
    const type = candidate.widget || candidate.inputType || candidate.type;
    if (NON_PAIRABLE_FIELD_TYPES.has(type)) continue;
    if (candidate.key && String(candidate.key).startsWith('_')) continue;
    return isQuantityLikeField(candidate) ? candidate : null;
  }
  return null;
}

/**
 * The colour slot(s) a quantity owns: the run of colour fields immediately
 * FOLLOWING it, stopping at the next non-colour field. The inverse of
 * `findPairedQuantityField`, used to clear a colour when its quantity is
 * zeroed in the deal-edit wizard (where both fields are editable).
 *
 * WARNING: the source must be `isQuantityLikeField` — that, not the colour's
 * `locked` flag, is what scopes this to the Extras convention. The first pass
 * gated on `isFieldLocked(colour)` and did nothing on the real config, where the
 * Extras colour is authored as a plain editable swatch.
 */
export function findPairedColorFields(quantityField: any, fields: any[] = []): any[] {
  if (!isQuantityLikeField(quantityField) || !Array.isArray(fields)) return [];
  const index = fields.findIndex((f) => f?.id === quantityField.id);
  if (index === -1) return [];

  const paired: any[] = [];
  for (let i = index + 1; i < fields.length; i += 1) {
    const candidate = fields[i];
    if (!candidate?.id) continue;
    if (!isColorField(candidate)) break;
    // An unconditionally-required colour is left alone: emptying it would block
    // the tab's Next with nothing on screen explaining why.
    if (candidate.required === true) continue;
    paired.push(candidate);
  }
  return paired;
}

/**
 * The paired field's current quantity.
 *
 * WARNING: an EXPLICIT state entry wins even when it is `0` or blank. In the
 * deal-edit wizard the rep edits a calculator-driven quantity down to 0 while
 * `dealCenterData` still reports the SOLD value (1), so preferring the calculator
 * whenever state looked empty made the colour survive the very edit this rule
 * exists for. Same principle as `formatFieldSummaryValue`: in edit mode the rep's
 * live value must win. The calculator is read only when the field has no state
 * entry at all (a build that has never been opened).
 */
export function resolvePairedQuantityValue(field: any, state: any = {}, dealCenterData: any = {}) {
  if (!field?.id) return undefined;

  const byId = state?.[field.id];
  if (byId !== undefined && byId !== null) return byId;
  const byKey = field.key ? state?.[field.key] : undefined;
  if (byKey !== undefined && byKey !== null) return byKey;

  if (isFieldLocked(field) || field.dcField || field.dcFields?.length) {
    return resolveLockedValue(field, dealCenterData);
  }
  return undefined;
}

/**
 * True when a colour slot has a paired quantity and that quantity is empty —
 * i.e. the colour describes an extra that isn't on the job.
 *
 * WARNING: deliberately says NOTHING about `field.locked`. The first pass had a
 * locked-only variant of this and it did nothing on the live config, where the
 * Extras colour is authored as a plain swatch (and is rendered read-only by the
 * tab, not by its own flag). The pairing itself — a colour that FOLLOWS A
 * QUANTITY — is the whole scope.
 */
export function isPairedQuantityEmpty(
  field: any,
  { fields = [], state = {}, dealCenterData = {} }: { fields?: any[]; state?: any; dealCenterData?: any } = {}
): boolean {
  if (!isColorField(field)) return false;

  const paired = findPairedQuantityField(field, fields);
  if (!paired) return false;

  return !hasEnteredQuantity(resolvePairedQuantityValue(paired, state, dealCenterData));
}

/**
 * The `fallbackDefault` to hand `resolveLockedValue` for a colour field — '' for
 * a suppressed slot (so it resolves to '—' rather than the configured default),
 * otherwise the existing conditional-default behaviour (`undefined` when the
 * field has no `dependencies.defaultWhen`, leaving `field.defaultValue` intact).
 */
export function resolveLockedColorFallbackDefault(
  field: any,
  { fields = [], state = {}, dealCenterData = {}, depCtx }: { fields?: any[]; state?: any; dealCenterData?: any; depCtx?: any } = {}
) {
  if (isPairedQuantityEmpty(field, { fields, state, dealCenterData })) return '';
  return resolveConditionalDefault(field, state, depCtx || { dealCenterData });
}
