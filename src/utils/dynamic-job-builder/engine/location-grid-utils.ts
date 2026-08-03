import { LOCATIONS, STORIES } from '../constants/color-palettes';
// Canonical rule evaluator (matches web location-grid-utils.js). The
// dependency-engine <-> location-grid-utils import cycle is safe: both bindings
// are only invoked at runtime, never at module-load. Web has the identical cycle.
import { evaluateRuleGroup } from './dependency-engine';

export function createDefaultLocationGridConfig(singleStory = false) {
  return {
    rowHeaderLabel: 'Location',
    unit: 'ft',
    rows: LOCATIONS.map((loc) => ({ key: loc, label: loc })),
    columns: singleStory
      ? [{ key: '1st', label: '1st Story' }]
      : STORIES.map((s) => ({ key: s, label: `${s} Story` })),
  };
}

export function resolveLocationGridConfig(field: any = {}) {
  if (field.gridConfig?.rows?.length && field.gridConfig?.columns?.length) {
    return {
      rowHeaderLabel: field.gridConfig.rowHeaderLabel || 'Location',
      unit: field.gridConfig.unit || field.unit || 'ft',
      rows: field.gridConfig.rows,
      columns: field.gridConfig.columns,
    };
  }

  const columns = field.singleStory
    ? [{ key: '1st', label: '1st Story' }]
    : STORIES.map((s) => ({ key: s, label: `${s} Story` }));

  return {
    rowHeaderLabel: 'Location',
    unit: field.unit || 'ft',
    rows: LOCATIONS.map((loc) => ({ key: loc, label: loc })),
    columns,
  };
}

export function createGridRow(label = 'New Row') {
  return { key: `row_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, label };
}

export function createGridColumn(label = 'New Column') {
  return { key: `col_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, label };
}

export function computeColumnTotal(value: any = {}, rows: any[] = [], columnKey: string) {
  return rows.reduce((sum, row) => sum + (Number(value?.[row.key]?.[columnKey]) || 0), 0);
}

export function resolveVisibleColumns(gridConfig: any = {}, dealCenterData: any = {}, state: any = {}, applyConditions = true) {
  const columns = gridConfig.columns || [];
  return columns.filter((col: any) => {
    if (!applyConditions) return true;
    if (!col.visibleWhen) return true;
    return evaluateRuleGroup(col.visibleWhen, { dealCenterData, state });
  });
}
