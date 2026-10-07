import { isFieldLocked, resolveLockedValue } from './allocation-utils';
import { resolveConditionalDefault } from './dependency-engine';

export const COLOR_FIELD_TYPES = new Set(['swatch', 'color', 'colorSelection', 'customColor']);

const QUANTITY_FIELD_TYPES = new Set(['number', 'text', 'locked', 'lockedWithColor', 'inputWithColor']);

const NON_PAIRABLE_FIELD_TYPES = new Set([
  'sectionLabel',
  'allocation',
  'combinationSummary',
  'stack',
  'accordion',
]);

export function isColorField(field: any): boolean {
  const type = field?.widget || field?.inputType || field?.type;
  if (!COLOR_FIELD_TYPES.has(type)) return false;
  if (field?.colorKey) return false;
  if (field?.dcField || field?.dcFields?.length) return false;
  return true;
}

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

export function isQuantityLikeField(field: any): boolean {
  if (!field?.id || isColorField(field)) return false;
  const type = field.widget || field.inputType || field.type;
  if (NON_PAIRABLE_FIELD_TYPES.has(type)) return false;
  if (field.key && String(field.key).startsWith('_')) return false;
  if (QUANTITY_FIELD_TYPES.has(type)) return true;
  return Boolean(field.dcField || field.dcFields?.length);
}

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

export function findPairedColorFields(quantityField: any, fields: any[] = []): any[] {
  if (!isQuantityLikeField(quantityField) || !Array.isArray(fields)) return [];
  const index = fields.findIndex((f) => f?.id === quantityField.id);
  if (index === -1) return [];

  const paired: any[] = [];
  for (let i = index + 1; i < fields.length; i += 1) {
    const candidate = fields[i];
    if (!candidate?.id) continue;
    if (!isColorField(candidate)) break;
    if (candidate.required === true) continue;
    paired.push(candidate);
  }
  return paired;
}

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

export function isPairedQuantityEmpty(
  field: any,
  { fields = [], state = {}, dealCenterData = {} }: { fields?: any[]; state?: any; dealCenterData?: any } = {}
): boolean {
  if (!isColorField(field)) return false;

  const paired = findPairedQuantityField(field, fields);
  if (!paired) return false;

  return !hasEnteredQuantity(resolvePairedQuantityValue(paired, state, dealCenterData));
}

export function resolveLockedColorFallbackDefault(
  field: any,
  { fields = [], state = {}, dealCenterData = {}, depCtx }: { fields?: any[]; state?: any; dealCenterData?: any; depCtx?: any } = {}
) {
  if (isPairedQuantityEmpty(field, { fields, state, dealCenterData })) return '';
  return resolveConditionalDefault(field, state, depCtx || { dealCenterData });
}
