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
  return Boolean(field.palette || field.colors?.length || field.colorKey);
}

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

export function comboHasSelectedColor(combo: any, fields: any[] = []): boolean {
  const colorFields = flattenFields(fields).filter(isColorField);
  if (!colorFields.length) return true;
  return colorFields.every((field) => !!resolveComboColorValue(field, combo));
}

export const ADDED_IN_EDIT_KEY = '_addedInEdit';

export function isComboHiddenInDealEdit(combo: any, fields: any[] = [], editMode?: boolean): boolean {
  if (!editMode) return false;
  if (combo?.[ADDED_IN_EDIT_KEY]) return false;
  return !comboHasSelectedColor(combo, fields);
}

const isEmptyValue = (value: any): boolean => {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return true;
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (typeof value === 'object') return Object.values(value).every(isEmptyValue);
  return false;
};

/** True when no row field of the combination holds a value (`''`, `0`, `'0'`, empty arrays/objects are empty). */
export function comboHasNoEnteredValue(combo: any, fields: any[] = []): boolean {
  return flattenFields(fields).every((field) => {
    const keys = [field?.id, field?.key].filter(Boolean) as string[];
    return keys.every((k) => isEmptyValue(combo?.[k]));
  });
}

/**
 * My Deals Soffit only: a combination shows when the Deal Center sent values for it (or the rep added it);
 * otherwise the section is just its heading + its own Add Combination. Layered ON TOP of
 * `isComboHiddenInDealEdit`, which stays colour-only for every other tab.
 */
export function isSoffitComboEmptyInDealEdit(combo: any, fields: any[] = [], editMode?: boolean): boolean {
  if (!editMode || combo?.[ADDED_IN_EDIT_KEY]) return false;
  return comboHasNoEnteredValue(combo, fields);
}
