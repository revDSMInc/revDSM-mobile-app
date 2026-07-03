import {
  getTabSections,
  getFlattenedCombinationSectionRowFields,
  getCombinationDisplayNumber,
  getCombinationGroups,
  flattenLeafFields,
} from './combination-utils';
import { resolveLocationGridConfig } from './location-grid-utils';

const SKIP_FIELD_TYPES = new Set(['allocation', 'combinationSummary', 'sectionLabel']);
const SKIP_STATE_KEYS = new Set(['colorValues', '_combinationNumber']);

function isLoggableField(field: any) {
  if (!field?.id) return false;
  if (SKIP_FIELD_TYPES.has(field.type)) return false;
  if (field.key?.startsWith('_')) return false;
  return true;
}

export function tabHasMultipleComboSections(tab: any) {
  return getCombinationGroups(tab).length > 1;
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
  isMeasurement = false,
  rowLabel = '',
  colLabel = '',
}: any) {
  const tabLabel = tab?.label || tab?.id || '';
  const sectionLabel = section?.label || '';
  const fieldLabel = isColor ? 'Color' : field?.label || field?.key || field?.id || 'Field';
  const comboNum =
    combo != null && comboIndex != null
      ? getCombinationDisplayNumber(combo, comboIndex)
      : comboIndex != null
        ? comboIndex + 1
        : null;

  if (isMeasurement && comboNum != null) {
    return `${tabLabel} Combo #${comboNum} Measurement - ${rowLabel} (${colLabel})`;
  }

  if (comboNum != null) {
    const prefix =
      sectionLabel && tabHasMultipleComboSections(tab)
        ? `${sectionLabel} Combo #${comboNum}`
        : `${tabLabel} Combo #${comboNum}`;
    return `${prefix} - ${fieldLabel}`;
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

  return {
    skip: false,
    tab,
    section,
    field,
    combo,
    comboIndex,
    isColor: Boolean(parsed.isColor),
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
