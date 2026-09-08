import {
  getTabSections,
  getFlattenedCombinationSectionRowFields,
  getCombinationDisplayNumber,
  getCombinationGroups,
  flattenLeafFields,
} from './combination-utils';
import { isContainerFieldType } from '../constants/field-types';
import { resolveLocationGridConfig } from './location-grid-utils';

const SKIP_FIELD_TYPES = new Set(['allocation', 'combinationSummary', 'sectionLabel']);
const SKIP_STATE_KEYS = new Set(['colorValues', '_combinationNumber']);

// Standalone color-picker field types. Their stored value is a color name and
// their own label is usually generic ("Color"), so a change log needs the
// owning input's label to say *whose* color was picked.
const COLOR_FIELD_TYPES = new Set(['swatch', 'colorSelection', 'customColor']);

// Field types that can never be the "owner" a color picker belongs to.
const NON_OWNER_FIELD_TYPES = new Set([
  ...COLOR_FIELD_TYPES,
  'allocation',
  'combinationSummary',
  'sectionLabel',
  'stack',
  'accordion',
]);

function isColorFieldType(type: any) {
  return COLOR_FIELD_TYPES.has(type);
}

// A bare "Color" / "Colour" / "Custom Color" / "Colors" carries no identity, so
// it must be qualified with the owning field rather than logged on its own.
function isGenericColorLabel(label: any) {
  if (!label) return true;
  return /^(custom\s+)?colou?rs?$/i.test(String(label).trim());
}

function isLoggableField(field: any) {
  if (!field?.id) return false;
  if (SKIP_FIELD_TYPES.has(field.type)) return false;
  if (field.key?.startsWith('_')) return false;
  return true;
}

function isOwnerCandidateField(field: any) {
  if (!field?.id) return false;
  if (NON_OWNER_FIELD_TYPES.has(field.type)) return false;
  if (field.key?.startsWith('_')) return false;
  return Boolean(field.label || field.key);
}

// Walk a section's field tree to find the input a standalone color picker
// belongs to. The owner is the nearest preceding input sibling in render order
// (e.g. the "Replace Corner Miter" number rendered right above its color slot),
// falling back to the enclosing stack/accordion container's label. Returns null
// when the target id is not in this branch so the caller can keep searching.
function findColorOwnerLabel(
  fields: any[],
  targetId: string,
  containerLabel = ''
): string | null {
  let precedingOwner = '';

  for (const field of fields || []) {
    if (isContainerFieldType(field?.type) && field.fields?.length) {
      const nestedLabel =
        field.label && field.showLabel !== false ? field.label : precedingOwner || containerLabel;
      const found = findColorOwnerLabel(field.fields, targetId, nestedLabel);
      if (found !== null) return found;
      continue;
    }

    if (field?.id === targetId) {
      return precedingOwner || containerLabel || '';
    }

    if (isOwnerCandidateField(field)) {
      precedingOwner = field.label || field.key;
    }
  }

  return null;
}

export function resolveColorFieldOwnerLabel(section: any, fieldId: string) {
  if (!section || !fieldId) return '';
  return findColorOwnerLabel(section.fields || [], fieldId, '') || '';
}

export function tabHasMultipleComboSections(tab: any) {
  return getCombinationGroups(tab).length > 1;
}

/**
 * A display name for a combo section, used to keep each section's combos distinct
 * in the log. Every LeafFilter gutter profile is its own combination section and
 * numbers its combos from #1, so with empty section labels they all collapse to
 * "LeafFilter Combo #1" and the log viewer dedups them into one struck-through
 * entry. Prefer the section's own label, else a stable ordinal so different
 * sections never share a combo label.
 *
 * NOTE: a `sectionLabel` *field* inside the section is deliberately NOT used - it
 * is an inner sub-group header (e.g. "Miters & End Caps") that names only part of
 * the section, so borrowing it mislabels sibling fields above it.
 */
export function resolveComboSectionLabel(tab: any, section: any) {
  const label = String(section?.label || '').trim();
  if (label) return label;

  const groups = getCombinationGroups(tab);
  const idx = groups.findIndex((s: any) => s?.id === section?.id);
  return idx >= 0 ? `Section ${idx + 1}` : '';
}

export function resolveVerticalFromConfig(verticals: any[] = [], verticalId: string) {
  if (!verticalId) return null;
  return verticals.find((v) => v.id === verticalId) || null;
}

export function buildTabLogContextMeta({ tab, vertical, verticalId, configId }: any) {
  const tabLabel = tab?.label || tab?.id || '';
  return {
    tabId: tab?.id,
    tabLabel,
    verticalId: verticalId || vertical?.id || '',
    verticalLabel: vertical?.label || verticalId || '',
    fieldCategory: tab?.id || 'unknown',
    categoryDisplayName: tabLabel ? `${tabLabel} Build` : 'Build',
    stepName: tabLabel,
    configId: configId || null,
    isDynamic: true,
  };
}

export function buildSchemaFieldLabel({
  tab,
  section,
  field,
  combo,
  comboIndex,
  isColor = false,
  ownerLabel = '',
  isMeasurement = false,
  rowLabel = '',
  colLabel = '',
}: any) {
  const tabLabel = tab?.label || tab?.id || '';
  const sectionLabel = section?.label || '';
  const rawFieldLabel = field?.label || field?.key || field?.id || 'Field';

  // A color change must say *whose* color was picked. Two models feed in here:
  //   1. Attached color (colorValues) - `field` is already the owning input, so
  //      its own label ("Replace Corner Miter") is the qualifier.
  //   2. Standalone color field (swatch/colorSelection/customColor) - its own
  //      label is generic ("Color"), so we fall back to `ownerLabel`, the
  //      adjacent input the picker belongs to.
  const isColorContext = isColor || isColorFieldType(field?.type);
  let fieldLabel = rawFieldLabel;
  if (isColorContext) {
    const ownFieldLabel = isGenericColorLabel(rawFieldLabel) ? '' : rawFieldLabel;
    const ownerBase = ownFieldLabel || ownerLabel || '';
    fieldLabel = ownerBase
      ? /colou?rs?$/i.test(ownerBase)
        ? ownerBase
        : `${ownerBase} Color`
      : 'Color';
  }

  const comboNum =
    combo != null && comboIndex != null
      ? getCombinationDisplayNumber(combo, comboIndex)
      : comboIndex != null
        ? comboIndex + 1
        : null;

  // With multiple combo sections, prefix with the section (label/header/ordinal)
  // so each section's "Combo #N" is distinct; otherwise the tab label suffices.
  const comboPrefix =
    comboNum != null
      ? tabHasMultipleComboSections(tab)
        ? `${resolveComboSectionLabel(tab, section) || tabLabel} Combo #${comboNum}`
        : `${tabLabel} Combo #${comboNum}`
      : null;

  if (isMeasurement && comboPrefix) {
    return `${comboPrefix} Measurement - ${rowLabel} (${colLabel})`;
  }

  if (isMeasurement) {
    const measurementBase = sectionLabel || rawFieldLabel || 'Measurement';
    return `${measurementBase} Measurement - ${rowLabel} (${colLabel})`;
  }

  if (comboPrefix) {
    return `${comboPrefix} - ${fieldLabel}`;
  }

  return fieldLabel;
}

export function coerceLogValue(val: any) {
  if (val === undefined || val === null || val === '') return '';
  if (Array.isArray(val)) return val.filter(Boolean).join(', ');
  if (typeof val === 'object') {
    const extracted = val.label ?? val.name ?? val.value ?? val.text;
    if (extracted !== undefined && extracted !== null && extracted !== '') {
      return String(extracted);
    }
    return JSON.stringify(val);
  }
  return String(val);
}

export function serializeValue(val: any) {
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) return val.join(',');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function getSectionField(section: any, fieldId: string) {
  if (!section || !fieldId) return null;
  const fields =
    section.sectionType === 'simple'
      ? flattenLeafFields(section.fields || [])
      : getFlattenedCombinationSectionRowFields(section) || [];
  return fields.find((f: any) => f.id === fieldId) || null;
}

function findSectionById(tab: any, sectionId: string) {
  return getTabSections(tab).find((s: any) => s.id === sectionId) || null;
}

function parseComboStateKey(key: string) {
  const comboMarker = '_combo_';
  const markerIdx = key.indexOf(comboMarker);
  if (markerIdx === -1) return null;

  const sectionId = key.slice(0, markerIdx);
  const afterMarker = key.slice(markerIdx + comboMarker.length);
  const comboIndexStr = afterMarker.split('_')[0];
  const comboIndex = parseInt(comboIndexStr, 10);
  if (!Number.isFinite(comboIndex)) return null;

  const remainder = afterMarker.slice(comboIndexStr.length + 1);
  if (!remainder) return null;

  return { sectionId, comboIndex, remainder };
}

export function parseFlattenedStateKey(key: string) {
  if (!key) return null;

  const legacyMatch = key.match(/^combination_(\d+)_(.+)$/);
  if (legacyMatch) {
    const comboIndex = parseInt(legacyMatch[1], 10);
    let remainder = legacyMatch[2];
    const isColor = remainder.endsWith('__color');
    if (isColor) remainder = remainder.slice(0, -'__color'.length);
    return {
      kind: 'legacy_combo',
      comboIndex,
      fieldId: remainder,
      isColor,
    };
  }

  const comboParsed = parseComboStateKey(key);
  if (comboParsed) {
    const { sectionId, comboIndex, remainder } = comboParsed;

    if (remainder.endsWith('__color')) {
      return {
        kind: 'combo',
        sectionId,
        comboIndex,
        fieldId: remainder.slice(0, -'__color'.length),
        isColor: true,
      };
    }

    const gridParts = remainder.match(/^(.+)__(.+?)__(.+)$/);
    if (gridParts) {
      return {
        kind: 'combo_grid_cell',
        sectionId,
        comboIndex,
        fieldId: gridParts[1],
        rowKey: gridParts[2],
        colKey: gridParts[3],
        isMeasurement: true,
      };
    }

    return {
      kind: 'combo',
      sectionId,
      comboIndex,
      fieldId: remainder,
      isColor: false,
    };
  }

  if (key.endsWith('__color')) {
    return {
      kind: 'simple',
      fieldId: key.slice(0, -'__color'.length),
      isColor: true,
    };
  }

  return {
    kind: 'simple',
    fieldId: key,
    isColor: false,
  };
}

export function resolveFieldLogContext(stateKey: string, tab: any, tabState: any = {}) {
  const parsed = parseFlattenedStateKey(stateKey);
  if (!parsed) return { skip: true };

  let section = null;
  let field = null;
  let combo = null;
  let comboIndex = null;
  let rowLabel = '';
  let colLabel = '';
  let isMeasurement = false;

  if (parsed.kind === 'legacy_combo') {
    comboIndex = parsed.comboIndex;
    combo = tabState?.combinations?.[comboIndex] || null;
    const sections = getCombinationGroups(tab);
    section = sections[0] || null;
    field = section ? getSectionField(section, parsed.fieldId) : null;
  } else if (parsed.kind === 'combo' || parsed.kind === 'combo_grid_cell') {
    section = findSectionById(tab, parsed.sectionId);
    comboIndex = parsed.comboIndex;
    combo = tabState?.comboGroups?.[parsed.sectionId]?.combinations?.[comboIndex] || null;
    field = section ? getSectionField(section, parsed.fieldId) : null;

    if (parsed.kind === 'combo_grid_cell' && field) {
      isMeasurement = true;
      const config = resolveLocationGridConfig(field);
      rowLabel =
        config.rows?.find((r: any) => r.key === parsed.rowKey)?.label || parsed.rowKey || '';
      colLabel =
        config.columns?.find((c: any) => c.key === parsed.colKey)?.label || parsed.colKey || '';
    }
  } else {
    for (const sec of getTabSections(tab)) {
      const candidate = getSectionField(sec, parsed.fieldId);
      if (candidate) {
        section = sec;
        field = candidate;
        break;
      }
    }
  }

  if (!field || !isLoggableField(field)) {
    return { skip: true };
  }

  if (field.type === 'locationGrid' && !isMeasurement) {
    return { skip: true };
  }

  // Standalone color pickers store their value under their own field id (not in
  // `colorValues`), so resolve the input they belong to for a meaningful label.
  const ownerLabel = isColorFieldType(field.type)
    ? resolveColorFieldOwnerLabel(section, field.id)
    : '';

  return {
    skip: false,
    tab,
    section,
    field,
    combo,
    comboIndex,
    isColor: Boolean(parsed.isColor),
    ownerLabel,
    isMeasurement,
    rowLabel,
    colLabel,
    fieldId: field.id,
    comboNumber:
      combo != null && comboIndex != null
        ? getCombinationDisplayNumber(combo, comboIndex)
        : undefined,
    location: isMeasurement ? rowLabel : undefined,
    story: isMeasurement ? colLabel : undefined,
  };
}

function expandComboStateEntries(sectionId: string, index: number, combo: any, section: any) {
  const entries: Record<string, any> = {};
  if (!combo || typeof combo !== 'object') return entries;

  const rowFields = section ? getFlattenedCombinationSectionRowFields(section) : [];
  const fieldById = Object.fromEntries(rowFields.filter(isLoggableField).map((f: any) => [f.id, f]));

  Object.entries(combo).forEach(([key, val]) => {
    if (SKIP_STATE_KEYS.has(key)) return;

    const field = fieldById[key];
    if (field?.type === 'locationGrid' && val && typeof val === 'object') {
      const config = resolveLocationGridConfig(field);
      (config.rows || []).forEach((row: any) => {
        (config.columns || []).forEach((col: any) => {
          const cellVal = (val as any)[row.key]?.[col.key];
          entries[`${sectionId}_combo_${index}_${key}__${row.key}__${col.key}`] =
            cellVal ?? '';
        });
      });
      return;
    }

    if (field && !isLoggableField(field)) return;
    entries[`${sectionId}_combo_${index}_${key}`] = val;
  });

  if (combo.colorValues && typeof combo.colorValues === 'object') {
    Object.entries(combo.colorValues).forEach(([fieldId, val]) => {
      entries[`${sectionId}_combo_${index}_${fieldId}__color`] = val;
    });
  }

  return entries;
}

export function flattenTabStateValues(tab: any, tabState: any = {}) {
  const values: Record<string, any> = {};

  Object.entries(tabState.sectionFields || {}).forEach(([sectionId, sectionState]: [string, any]) => {
    if (!sectionState || typeof sectionState !== 'object') return;
    const section = findSectionById(tab, sectionId);

    Object.entries(sectionState).forEach(([key, val]) => {
      if (key === 'colorValues') return;
      const field = section ? getSectionField(section, key) : null;
      if (field && !isLoggableField(field)) return;
      values[key] = val;
    });

    if (sectionState.colorValues) {
      Object.entries(sectionState.colorValues).forEach(([key, val]) => {
        values[`${key}__color`] = val;
      });
    }
  });

  (tabState.combinations || []).forEach((combo: any, index: number) => {
    Object.entries(combo || {}).forEach(([key, val]) => {
      if (SKIP_STATE_KEYS.has(key)) return;
      values[`combination_${index}_${key}`] = val;
    });
  });

  Object.entries(tabState.comboGroups || {}).forEach(([sectionId, group]: [string, any]) => {
    const section = findSectionById(tab, sectionId);
    (group?.combinations || []).forEach((combo: any, index: number) => {
      Object.assign(values, expandComboStateEntries(sectionId, index, combo, section));
    });
  });

  return values;
}

export function buildFieldChangeLogMeta({
  context,
  tab,
  vertical,
  verticalId,
  configId,
  stateKey,
  oldValue,
  newValue,
}: any) {
  const tabMeta = buildTabLogContextMeta({ tab, vertical, verticalId, configId });
  const fieldLabel = buildSchemaFieldLabel({
    tab,
    section: context.section,
    field: context.field,
    combo: context.combo,
    comboIndex: context.comboIndex,
    isColor: context.isColor,
    ownerLabel: context.ownerLabel,
    isMeasurement: context.isMeasurement,
    rowLabel: context.rowLabel,
    colLabel: context.colLabel,
  });

  const coercedOld = coerceLogValue(oldValue);
  const coercedNew = coerceLogValue(newValue);

  return {
    ...tabMeta,
    draft: true,
    fieldName: context.fieldId || stateKey,
    fieldLabel,
    sectionId: context.section?.id,
    sectionLabel: context.section?.label || '',
    oldValue: coercedOld,
    newValue: coercedNew,
    fieldValue: coercedNew,
    locked: Boolean(context.field?.locked),
    autoSelected: false,
    action: 'field_changed',
    ...(context.comboNumber != null ? { comboNumber: context.comboNumber } : {}),
    ...(context.location ? { location: context.location } : {}),
    ...(context.story ? { story: context.story } : {}),
  };
}
