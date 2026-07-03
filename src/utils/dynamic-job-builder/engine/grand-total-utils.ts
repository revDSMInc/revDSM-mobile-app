import { computeGridTotal } from './allocation-utils';
import { isFieldVisible } from './dependency-engine';
import { isCombinationSummaryField } from '../constants/field-types';
import {
  DEFAULT_SUMMARY_EMPTY_MESSAGE,
  normalizeSummaryColumnConfig,
  usesExplicitSummaryColumns,
} from './combination-summary-utils';

export { isCombinationSummaryField };

const SKIPPED_FIELD_TYPES = new Set(['sectionLabel', 'combinationSummary']);

export function shouldShowGrandTotalSummary(section: any) {
  if (!section || section.sectionType === 'simple') return false;
  if (section.showGrandTotalSummary === false) return false;
  const fields = section.fields || [];
  if (fields.some(isCombinationSummaryField)) return false;
  return getGrandTotalColumns(section.fields || []).length > 0;
}

function getFlattenedComboFields(fields: any[] = []) {
  const result: any[] = [];
  const flatten = (list: any[]) => {
    (list || []).forEach((field) => {
      if (field?.type === 'stack' || field?.type === 'accordion') {
        flatten(field.fields || []);
        return;
      }
      if (field?.id) result.push(field);
    });
  };
  flatten(fields);
  return result;
}

function getPriorComboFields(sectionFields: any[] = [], summaryField: any = null) {
  const allComboFields = getFlattenedComboFields(sectionFields).filter(
    (field) =>
      !SKIPPED_FIELD_TYPES.has(field.type) &&
      field.key &&
      !field.key.startsWith('_')
  );

  if (!summaryField) return allComboFields;

  const summaryIndex = sectionFields.findIndex((field) => field.id === summaryField.id);
  if (summaryIndex < 0) return allComboFields;

  const priorKeys = new Set(
    sectionFields
      .slice(0, summaryIndex)
      .map((field) => field.key)
      .filter(Boolean)
  );
  const priorFields = allComboFields.filter((field) => priorKeys.has(field.key));
  return priorFields.length ? priorFields : allComboFields;
}

function resolveConfiguredSummaryColumns(sectionFields: any[] = [], summaryField: any = null) {
  const allComboFields = getFlattenedComboFields(sectionFields).filter(
    (field) =>
      !SKIPPED_FIELD_TYPES.has(field.type) &&
      field.key &&
      !field.key.startsWith('_')
  );
  const defaultEmpty = summaryField?.defaultEmptyMessage || DEFAULT_SUMMARY_EMPTY_MESSAGE;
  const configured = normalizeSummaryColumnConfig(summaryField);

  return configured.map((col: any, index: number) => {
    const sourceField = col.fieldKey
      ? allComboFields.find((item) => item.key === col.fieldKey)
      : null;

    if (!sourceField) {
      return {
        id: `summary_col_${index}`,
        key: col.fieldKey || '',
        type: 'summaryColumn',
        label: col.label?.trim() || `Column ${index + 1}`,
        emptyMessage: col.emptyMessage || defaultEmpty,
        unmapped: true,
      };
    }

    return {
      ...sourceField,
      label: col.label?.trim() ? col.label.trim() : sourceField.label,
      emptyMessage: col.emptyMessage || defaultEmpty,
      unmapped: false,
    };
  });
}

export function resolveGrandTotalColumns(sectionFields: any[] = [], summaryField: any = null) {
  if (summaryField && usesExplicitSummaryColumns(summaryField)) {
    return resolveConfiguredSummaryColumns(sectionFields, summaryField);
  }

  return getPriorComboFields(sectionFields, summaryField);
}

export function getGrandTotalColumns(fields: any[] = []) {
  return resolveGrandTotalColumns(fields);
}

export function formatComboFieldSummaryValue(field: any, combo: any = {}, options: any = {}) {
  const emptyMessage = options.emptyMessage || field?.emptyMessage || DEFAULT_SUMMARY_EMPTY_MESSAGE;

  if (field?.unmapped || field?.type === 'summaryColumn') {
    return { text: emptyMessage, variant: 'missing' };
  }

  if (field.type === 'locationGrid') {
    const total = computeGridTotal(combo[field.id]);
    const unit = field.unit || field.gridConfig?.unit || 'FT';
    return { text: `${total} ${unit}`.trim(), variant: 'total' };
  }

  if (field.type === 'text') {
    const raw = combo[field.id];
    const display =
      raw === '' || raw === null || raw === undefined ? field.defaultValue || '' : raw;
    if (!display) return { text: emptyMessage, variant: 'missing' };
    return { text: String(display), variant: 'value' };
  }

  if (field.type === 'number') {
    const val = combo[field.id];
    if (val === '' || val === null || val === undefined) {
      return { text: emptyMessage, variant: 'missing' };
    }
    const unit = field.unit ? ` ${field.unit}` : '';
    return { text: `${val}${unit}`, variant: 'value' };
  }

  if (field.type === 'roomPicker') {
    const rooms = combo[field.id];
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return { text: emptyMessage, variant: 'missing' };
    }
    return {
      text: `${rooms.length} room${rooms.length !== 1 ? 's' : ''}`,
      variant: 'value',
    };
  }

  const raw = combo[field.id];
  if (raw === '' || raw === null || raw === undefined) {
    return { text: emptyMessage, variant: 'missing' };
  }
  return { text: String(raw), variant: 'value' };
}

export function computeSectionCombinationsTotal(sectionFields: any[] = [], combos: any[] = [], summaryField: any = null) {
  const columns = resolveGrandTotalColumns(sectionFields, summaryField);
  const gridFields = columns.filter((field) => field.type === 'locationGrid' && !field.unmapped);
  if (!gridFields.length) return 0;

  return combos.reduce(
    (sum, combo) =>
      sum + gridFields.reduce((fieldSum, field) => fieldSum + computeGridTotal(combo[field.id]), 0),
    0
  );
}

export function buildSectionTotalLabel(sectionLabel = 'Section', footerLabel = '') {
  if (footerLabel?.trim()) return footerLabel.trim().toUpperCase();
  return `TOTAL ${String(sectionLabel || 'Section').toUpperCase()}`;
}

export function getSectionTotalUnit(sectionFields: any[] = [], summaryField: any = null) {
  const columns = resolveGrandTotalColumns(sectionFields, summaryField);
  const gridField = columns.find((field) => field.type === 'locationGrid' && !field.unmapped);
  return gridField?.unit || gridField?.gridConfig?.unit || 'FT';
}

export function getSectionSummaryField(section: any) {
  return (section.fields || []).find(isCombinationSummaryField) || null;
}

export function shouldIncludeSectionInTabSummary(section: any) {
  if (!section || section.sectionType === 'simple') return false;
  if (section.showGrandTotalSummary === false) return false;

  const summaryField = getSectionSummaryField(section);
  return resolveGrandTotalColumns(section.fields || [], summaryField).length > 0;
}

export function shouldShowTabGrandTotalSummary(tab: any, entries: any[] = []) {
  if (tab?.showGrandTotalSummary === false) return false;
  return entries.length > 0;
}

export function computeTabCombinationsGrandTotal(entries: any[] = []) {
  return entries.reduce((sum, { combo, section, summaryField }) => {
    const columns = resolveGrandTotalColumns(section.fields || [], summaryField);
    const gridFields = columns.filter((field) => field.type === 'locationGrid' && !field.unmapped);
    return (
      sum +
      gridFields.reduce((fieldSum, field) => fieldSum + computeGridTotal(combo[field.id]), 0)
    );
  }, 0);
}

export function getTabGrandTotalUnit(entries: any[] = []) {
  for (let i = 0; i < entries.length; i += 1) {
    const { section, summaryField } = entries[i];
    const unit = getSectionTotalUnit(section.fields || [], summaryField);
    if (unit) return unit;
  }
  return 'FT';
}

export function buildTabTotalLabel(tabLabel = '', footerLabel = '') {
  if (footerLabel?.trim()) return footerLabel.trim().toUpperCase();
  const label = String(tabLabel || 'Tab').trim();
  return label ? `TOTAL ${label.toUpperCase()}` : 'GRAND TOTAL';
}

export function shouldRenderCombinationSummary(summaryField: any, combos: any[] = [], visibilityCtx: any = {}) {
  const minCombinations = summaryField?.minCombinations ?? 1;
  if (combos.length < minCombinations) return false;

  if (!summaryField?.dependencies?.visibleWhen) return true;

  return isFieldVisible(summaryField, visibilityCtx.state || {}, visibilityCtx);
}
