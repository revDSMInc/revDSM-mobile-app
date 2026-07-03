import { LOCATIONS, STORIES } from '../constants/color-palettes';

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

function evaluateRuleGroup(rules: any, ctx: any) {
  if (!rules || typeof rules !== 'object') return true;
  if (Array.isArray(rules)) {
    return rules.every((rule: any) => evaluateRule(rule, ctx));
  }
  const { _operator = 'and', _rules = [] } = rules;
  if (_operator === 'and') {
    return _rules.every((rule: any) => evaluateRule(rule, ctx));
  }
  return _rules.some((rule: any) => evaluateRule(rule, ctx));
}

function evaluateRule(rule: any, ctx: any) {
  if (!rule || typeof rule !== 'object') return true;
  const { source = 'state', field, operator = 'truthy', value: compareValue } = rule;
  const data = source === 'dealCenter' ? ctx.dealCenterData : ctx.state;
  const fieldValue = data?.[field];
  switch (operator) {
    case 'truthy': return Boolean(fieldValue);
    case 'falsy': return !fieldValue;
    case 'eq': return fieldValue === compareValue;
    case 'neq': return fieldValue !== compareValue;
    case 'gt': return Number(fieldValue) > Number(compareValue);
    case 'gte': return Number(fieldValue) >= Number(compareValue);
    case 'lt': return Number(fieldValue) < Number(compareValue);
    case 'lte': return Number(fieldValue) <= Number(compareValue);
    case 'in': return Array.isArray(compareValue) && compareValue.includes(fieldValue);
    case 'notIn': return Array.isArray(compareValue) && !compareValue.includes(fieldValue);
    case 'exists': return fieldValue !== undefined && fieldValue !== null;
    default: return Boolean(fieldValue);
  }
}
