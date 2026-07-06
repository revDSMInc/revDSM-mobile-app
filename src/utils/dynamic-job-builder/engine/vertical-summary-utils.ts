import {
  getTabSections,
  getCombinationDisplayNumber,
  getCombinationSectionHeaderFields,
  isSectionScopedCombinationField,
} from './combination-utils';
import { isAllocationField, isFieldLocked, resolveLockedValue } from './allocation-utils';
import { evaluateRuleGroup, isFieldVisibleWithConditions } from './dependency-engine';
import {
  formatComboFieldSummaryValue,
  getSectionSummaryField,
  resolveGrandTotalColumns,
  shouldIncludeSectionInTabSummary,
} from './grand-total-utils';
import { isCombinationSummaryField, isContainerFieldType } from '../constants/field-types';
import { resolveLocationGridConfig } from './location-grid-utils';

// Fallback palette colors (mobile has no MUI theme)
const PRODUCT_PALETTE_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#be185d', '#65a30d',
];

const SKIPPED_FIELD_TYPES = new Set(['sectionLabel', 'combinationSummary', 'allocation']);
const LABELED_SELECTION_TYPES = new Set(['toggle', 'optionList', 'dropdown']);

// ─── Color resolution ─────────────────────────────────────────────────────────

export function resolveTabAccentColor(
  tab: any,
  vertical: any,
  _theme: any,
  options: any = {}
): string {
  const { tabIndex = 0 } = options;

  const configured = tab?.summaryColor || tab?.color;
  if (configured && typeof configured === 'string' && configured.startsWith('#')) {
    return configured;
  }

  if (vertical?.color && typeof vertical.color === 'string' && vertical.color.startsWith('#')) {
    return vertical.color;
  }

  return PRODUCT_PALETTE_COLORS[tabIndex % PRODUCT_PALETTE_COLORS.length];
}

// ─── Section / field visibility ───────────────────────────────────────────────

function buildFlatTabState(tabState: any, tab: any) {
  const state: any = {};
  const sections = getTabSections(tab);
  sections.forEach((s: any) => {
    if (s.sectionType === 'simple') {
      const sectionState = tabState?.sectionFields?.[s.id] || {};
      Object.keys(sectionState).forEach((key) => {
        if (key !== 'colorValues') state[key] = sectionState[key];
      });
    } else {
      const combos = tabState?.comboGroups?.[s.id]?.combinations || [];
      if (combos.length > 0) {
        Object.keys(combos[0]).forEach((key) => {
          if (key !== 'colorValues') state[key] = combos[0][key];
        });
      }
    }
  });
  return state;
}

export function isSummarySectionVisible(
  section: any,
  tabState: any,
  dealCenterData: any,
  tab: any,
  applyConditions = true
) {
  const visibleWhen = section?.dependencies?.visibleWhen;
  if (!visibleWhen) return true;
  if (!applyConditions) return true;
  const state = buildFlatTabState(tabState, tab);
  return evaluateRuleGroup(visibleWhen, {
    dealCenterData: dealCenterData || {},
    state,
    tab,
    tabState,
    section,
  });
}

function getSectionCombos(section: any, tabState: any) {
  const fromGroups = tabState?.comboGroups?.[section.id]?.combinations;
  if (fromGroups?.length) return fromGroups;
  if (section.id === 'default' && tabState?.combinations?.length) {
    return tabState.combinations;
  }
  return [{ ...(section.defaultItem || {}) }];
}

// ─── Field display state ──────────────────────────────────────────────────────

function buildComboDisplayState(combo: any = {}, colorValues: any = {}) {
  const displayState = { ...combo, colorValues: combo.colorValues || colorValues };
  Object.entries(colorValues || {}).forEach(([key, val]) => {
    if (val !== '' && val !== null && val !== undefined) {
      (displayState as any)[key] = val;
    }
  });
  return displayState;
}

function buildFieldDepCtx(ctx: any, overrides: any = {}) {
  return {
    dealCenterData: ctx.dealCenterData || {},
    tab: ctx.tab,
    tabState: ctx.tabState,
    section: ctx.section,
    sectionState: ctx.sectionState,
    sectionFields: ctx.sectionFields,
    ...overrides,
  };
}

// ─── Location grid ────────────────────────────────────────────────────────────

function buildLocationRowsFromGrid(field: any, combo: any) {
  const grid = combo?.[field.id];
  if (!grid || typeof grid !== 'object') return [];

  const config = resolveLocationGridConfig(field);
  const unit = (config.unit || 'ft').toLowerCase();
  const rows: any[] = [];

  (config.rows || []).forEach((row: any) => {
    const rowData = grid[row.key] || {};
    const entries: any[] = [];
    (config.columns || []).forEach((col: any) => {
      const val = Number(rowData[col.key]) || 0;
      if (val > 0) entries.push({ story: col.label || col.key, value: val, unit });
    });
    if (entries.length > 0) rows.push({ location: row.label || row.key, entries });
  });

  return rows;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeSummaryContent(target: any, source: any) {
  target.parts.push(...(source.parts || []));
  target.extras.push(...(source.extras || []));
  target.detailRows.push(...(source.detailRows || []));
  target.locationRows.push(...(source.locationRows || []));
}

function isMeaningfulSummaryValue({ text, variant }: any) {
  return variant !== 'missing' && String(text || '').trim() !== '';
}

function isDisplayableFieldSummary(field: any, formatted: any) {
  if (!isMeaningfulSummaryValue(formatted)) return false;
  if (field?.type === 'number') {
    const numeric = Number(String(formatted.text).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(numeric) || numeric === 0) return false;
  }
  return true;
}

// ─── Field value formatting ───────────────────────────────────────────────────

function formatFieldSummaryValue(field: any, state: any = {}, options: any = {}) {
  const { dealCenterData } = options;
  const colorValues = state?.colorValues || {};
  const resolvedState = { ...state };

  if (isFieldLocked(field) && dealCenterData && Object.keys(dealCenterData).length) {
    const lockedValue = resolveLockedValue(field, dealCenterData);
    if (lockedValue !== undefined && lockedValue !== null && lockedValue !== '' && lockedValue !== '—') {
      resolvedState[field.id] = lockedValue;
      return formatComboFieldSummaryValue(field, resolvedState, options);
    }
  }

  const rawById = state?.[field.id];
  const rawByKey = field.key ? state?.[field.key] : undefined;
  const colorById = colorValues?.[field.id];
  const colorByKey = field.key ? colorValues?.[field.key] : undefined;

  if (rawById !== undefined && rawById !== null && rawById !== '') {
    resolvedState[field.id] = rawById;
  } else if (rawByKey !== undefined && rawByKey !== null && rawByKey !== '') {
    resolvedState[field.id] = rawByKey;
  } else if (colorById) {
    resolvedState[field.id] = colorById;
  } else if (colorByKey) {
    resolvedState[field.id] = colorByKey;
  }

  return formatComboFieldSummaryValue(field, resolvedState, options);
}

function isSummaryFieldVisible(field: any, state: any, ctx: any) {
  const { applyConditions = true } = ctx;
  if (!applyConditions) return true;
  return isFieldVisibleWithConditions(
    field,
    state,
    buildFieldDepCtx(ctx, { sectionState: state, sectionFields: ctx.sectionFields || [] }),
    applyConditions
  );
}

function buildSingleFieldDetailRow(field: any, state: any, ctx: any): any {
  if (!field?.id) return null;
  if (SKIPPED_FIELD_TYPES.has(field.type) || isAllocationField(field)) return null;
  if (field.key?.startsWith('_')) return null;
  if (isCombinationSummaryField(field)) return null;
  if (!isSummaryFieldVisible(field, state, ctx)) return null;

  if (field.type === 'locationGrid') {
    const locationRows = buildLocationRowsFromGrid(field, state);
    return locationRows.length ? { locationRows } : null;
  }

  const formatted = formatFieldSummaryValue(field, state, { dealCenterData: ctx.dealCenterData });
  if (!isDisplayableFieldSummary(field, formatted)) return null;

  return { label: field.label || field.key || '', text: formatted.text, variant: formatted.variant };
}

function processContainerFieldSummary(field: any, state: any, ctx: any): any {
  const result = { parts: [], extras: [], detailRows: [], locationRows: [] };
  (field.fields || []).forEach((child: any) => {
    if (!isSummaryFieldVisible(child, state, ctx)) return;
    if (isContainerFieldType(child.type)) {
      mergeSummaryContent(result, processContainerFieldSummary(child, state, ctx));
      return;
    }
    const row = buildSingleFieldDetailRow(child, state, ctx);
    if (!row) return;
    if (row.locationRows) (result.locationRows as any[]).push(...row.locationRows);
    else (result.detailRows as any[]).push(row);
  });
  return result;
}

function getCombinationSectionFields(section: any) {
  return (section?.fields || []).filter(
    (field: any) => !isSectionScopedCombinationField(field) && !isAllocationField(field)
  );
}

function processSummaryFields(fields: any[] = [], state: any = {}, ctx: any = {}) {
  const result: any = { parts: [], extras: [], detailRows: [], locationRows: [] };
  const displayState = buildComboDisplayState(state, state?.colorValues);
  const { summaryMode = 'fields' } = ctx;
  const inCombination = summaryMode === 'combination';

  (fields || []).forEach((field: any) => {
    if (!field?.id) return;
    if (isContainerFieldType(field.type)) {
      mergeSummaryContent(result, processContainerFieldSummary(field, displayState, ctx));
      return;
    }
    if (SKIPPED_FIELD_TYPES.has(field.type) || isAllocationField(field)) return;
    if (field.key?.startsWith('_')) return;
    if (isCombinationSummaryField(field)) return;
    if (isSectionScopedCombinationField(field)) return;
    if (!isSummaryFieldVisible(field, displayState, { ...ctx, sectionFields: fields })) return;

    if (field.type === 'locationGrid') {
      result.locationRows.push(...buildLocationRowsFromGrid(field, displayState));
      return;
    }

    const formatted = formatFieldSummaryValue(field, displayState, { dealCenterData: ctx.dealCenterData });
    if (!isDisplayableFieldSummary(field, formatted)) return;

    if (inCombination && !isContainerFieldType(field.type)) {
      if (field.type === 'number' && field.label) {
        result.parts.push(`${formatted.text} ${field.label}`);
      } else if (LABELED_SELECTION_TYPES.has(field.type) && field.label) {
        result.parts.push(`${field.label}: ${formatted.text}`);
      } else {
        result.parts.push(formatted.text);
      }
      return;
    }

    result.detailRows.push({ label: field.label || field.key || '', text: formatted.text, variant: formatted.variant });
  });

  return result;
}

function comboHasMeaningfulData(section: any, combo: any, ctx: any) {
  const displayState = buildComboDisplayState(combo, combo?.colorValues);
  const content = processSummaryFields(getCombinationSectionFields(section), displayState, {
    ...ctx, section, summaryMode: 'combination',
  });
  return content.parts.length > 0 || content.detailRows.length > 0 || content.locationRows.length > 0;
}

function buildCombinationEntry(section: any, combo: any, index: number, offset: number, ctx: any) {
  const displayState = buildComboDisplayState(combo, combo?.colorValues);
  const content = processSummaryFields(getCombinationSectionFields(section), displayState, {
    ...ctx, section, summaryMode: 'combination',
  });
  return {
    displayNumber: getCombinationDisplayNumber(combo, index, offset),
    summaryLine: content.parts.join(' · '),
    locationRows: content.locationRows,
    comboFieldRows: content.detailRows,
    comboExtras: content.extras,
  };
}

function buildFieldSummaryRows(fields: any[] = [], state: any = {}, ctx: any = {}) {
  const { colorValues = {} } = ctx;
  const displayState = buildComboDisplayState(state, colorValues);
  const content = processSummaryFields(fields, displayState, { ...ctx, sectionFields: fields, summaryMode: 'fields' });
  return content.detailRows.map((row: any) => ({ label: row.label, text: row.text, variant: row.variant }));
}

function buildCombinationSectionSummary(
  section: any,
  tabState: any,
  tab: any,
  ctx: any,
  combinationIndexOffset = 0
) {
  const sectionCombos = getSectionCombos(section, tabState);
  const sectionState = tabState?.comboGroups?.[section.id]?.sectionState || {};

  const combinations: any[] = [];
  sectionCombos.forEach((combo: any, index: number) => {
    if (!comboHasMeaningfulData(section, combo, { ...ctx, tab, tabState, section })) return;
    combinations.push(buildCombinationEntry(section, combo, index, combinationIndexOffset, { ...ctx, tab, tabState, section }));
  });

  const sectionExtras = buildFieldSummaryRows(
    getCombinationSectionHeaderFields(section),
    sectionState,
    { ...ctx, tab, tabState, section, colorValues: sectionState?.colorValues || {} }
  );

  if (!combinations.length && !sectionExtras.length) return null;

  return {
    sectionId: section.id,
    sectionLabel: section.label || '',
    combinations,
    extras: sectionExtras,
    extrasLabel: section.summaryExtrasLabel || 'Extras',
  };
}

function buildAllCombinationSectionSummaries(tab: any, tabState: any, ctx: any = {}) {
  const { dealCenterData = {}, applyConditions = true } = ctx;
  const sections = getTabSections(tab);
  const summaries: any[] = [];
  let combinationIndexOffset = 0;

  sections.forEach((section: any) => {
    if (section.sectionType === 'simple' || !(section.fields || []).length) return;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab, applyConditions)) return;

    const sectionSummary = buildCombinationSectionSummary(section, tabState, tab, ctx, combinationIndexOffset);
    if (!sectionSummary) return;

    summaries.push(sectionSummary);
    combinationIndexOffset += sectionSummary.combinations.length;
  });

  return summaries;
}

export function buildSimpleSectionSummary(section: any, sectionState: any = {}, ctx: any = {}) {
  const fields = section.fields || [];
  if (!fields.length) return [];
  return buildFieldSummaryRows(fields, sectionState, { ...ctx, section, colorValues: sectionState?.colorValues || {} });
}

export function buildTabLevelFieldSummary(tab: any, tabState: any = {}, ctx: any = {}) {
  const fields = tab.fields || [];
  if (!fields.length) return [];
  return buildFieldSummaryRows(fields, tabState, { ...ctx, tab, tabState, colorValues: tabState?.colorValues || {} });
}

export function buildTabSummaryEntries(tab: any, tabState: any, ctx: any = {}) {
  const { dealCenterData = {}, applyConditions = true } = ctx;
  const sections = getTabSections(tab);
  const entries: any[] = [];
  let combinationIndexOffset = 0;

  sections.forEach((section: any) => {
    if (section.sectionType === 'simple' || !(section.fields || []).length) return;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab, applyConditions)) return;
    if (!shouldIncludeSectionInTabSummary(section)) return;

    const sectionCombos = getSectionCombos(section, tabState);
    const summaryField = getSectionSummaryField(section);
    const columns = resolveGrandTotalColumns(section.fields || [], summaryField);

    sectionCombos.forEach((combo: any, index: number) => {
      entries.push({
        combo: buildComboDisplayState(combo, combo.colorValues),
        section,
        summaryField,
        columns,
        displayNumber: getCombinationDisplayNumber(combo, index, combinationIndexOffset),
      });
    });

    combinationIndexOffset += sectionCombos.length;
  });

  return entries;
}

export function buildTabSummarySection(tab: any, tabState: any = {}, ctx: any = {}) {
  const { dealCenterData = {}, applyConditions = true, vertical, tabIndex = 0 } = ctx;

  const sections = getTabSections(tab);
  const combinationSections = buildAllCombinationSectionSummaries(tab, tabState, ctx);

  const simpleSections: any[] = [];
  sections.forEach((section: any) => {
    if (section.sectionType !== 'simple' || !(section.fields || []).length) return;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab, applyConditions)) return;

    const sectionState = tabState?.sectionFields?.[section.id] || {};
    const fields = buildSimpleSectionSummary(section, sectionState, ctx);
    if (!fields.length) return;

    simpleSections.push({ sectionId: section.id, sectionLabel: section.label || '', fields });
  });

  const tabFields = buildTabLevelFieldSummary(tab, tabState, ctx);
  const hasCombinationData = combinationSections.some(
    (group: any) => group.combinations.length > 0 || group.extras.length > 0
  );
  const isEmpty = !hasCombinationData && simpleSections.length === 0 && tabFields.length === 0;

  return {
    tabId: tab.id,
    tabLabel: tab.label || tab.id,
    accentColor: resolveTabAccentColor(tab, vertical, null, { tabIndex }),
    combinationSections,
    simpleSections,
    tabFields,
    isEmpty,
  };
}

export function buildVerticalSummarySections(vertical: any, verticalState: any = {}, ctx: any = {}) {
  const { lockedTabIds = [] } = ctx;
  const locked = new Set(lockedTabIds || []);
  const tabs = vertical?.tabs || [];

  return tabs
    .filter((tab: any) => !tab.isSummary && !locked.has(tab.id))
    .map((tab: any, tabIndex: number) =>
      buildTabSummarySection(tab, verticalState[tab.id] || {}, { ...ctx, vertical, tabIndex })
    );
}
