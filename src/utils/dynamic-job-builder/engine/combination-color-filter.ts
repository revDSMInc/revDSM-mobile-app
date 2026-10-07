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

export function isComboHiddenInDealEdit(_combo: any, _fields: any[] = [], _editMode?: boolean): boolean {
  return false;
}
