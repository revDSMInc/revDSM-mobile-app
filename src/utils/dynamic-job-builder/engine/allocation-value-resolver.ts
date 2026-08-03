import { evaluateRuleGroup } from './dependency-engine';
import { resolveAllocationAvail } from './allocation-utils';
import { computeGridTotal, getAllocationUsedForField } from './allocation-utils';
import { computeColumnTotal, resolveLocationGridConfig } from './location-grid-utils';
import { getTabSections } from './combination-utils';
import { anyDealCenterRefHasData } from './deal-center-field-utils';
import {
  buildAllocationStatus,
  comboMatchesOptionBinding,
  findFieldByKeyInSection,
  findFieldContextOnTab,
  normalizeAllocationField,
  normalizeAllocationMetrics,
  resolveDynamicMetricColor,
} from './allocation-config-utils';

function toNumber(value: any) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function resolveStateFieldValue(state: any, fieldKey: string, aggregate = 'value', fieldMeta: any, columnKeys: string[] = []) {
  if (!fieldKey) return 0;

  const raw = state?.[fieldKey];

  if (aggregate === 'columnSum') {
    const rows = resolveLocationGridConfig(fieldMeta || {}).rows;
    return (columnKeys || []).reduce(
      (sum, colKey) => sum + computeColumnTotal(raw, rows, colKey),
      0
    );
  }

  if (aggregate === 'gridTotal' || fieldMeta?.type === 'locationGrid') {
    return computeGridTotal(raw);
  }

  return toNumber(raw);
}

function resolveDealCenterValueSource(valueSource: any, dealCenterData: any = {}) {
  const pseudoField = {
    dcField: valueSource.dcField,
    dcFields: valueSource.dcFields,
    dcAggregate: valueSource.dcAggregate,
    avail: valueSource.fallback ?? 0,
  };

  const hasDcBinding = valueSource.dcField || valueSource.dcFields?.length;
  if (!hasDcBinding) {
    return toNumber(valueSource.fallback);
  }

  const resolved = resolveAllocationAvail(pseudoField, dealCenterData);
  const refs = valueSource.dcFields?.length
    ? valueSource.dcFields
    : valueSource.dcField
      ? [valueSource.dcField]
      : [];
  const hasDcData = anyDealCenterRefHasData(dealCenterData, refs);

  if (!hasDcData) {
    return toNumber(valueSource.fallback);
  }

  return resolved;
}

function locateField(tab: any, fieldKey: string, sectionIdHint?: string) {
  if (!fieldKey || !tab) return null;

  if (sectionIdHint) {
    const field = findFieldByKeyInSection(tab, sectionIdHint, fieldKey);
    if (field) {
      const section = getTabSections(tab).find((item: any) => item.id === sectionIdHint);
      return {
        field,
        sectionId: sectionIdHint,
        sectionType: section?.sectionType || 'combination',
      };
    }
  }

  const located = findFieldContextOnTab(tab, fieldKey);
  if (!located?.field) return null;

  return {
    field: located.field,
    sectionId: located.section?.id ?? null,
    sectionType: located.section?.sectionType || (located.section ? 'combination' : 'tab'),
  };
}

function resolveContributorSourceValue(source: any, state: any, dealCenterData: any, tab: any) {
  if (!source) return 0;

  if (source.source === 'dealCenter') {
    return resolveDealCenterValueSource(
      {
        type: 'dealCenter',
        dcField: source.fieldKey || source.dcField,
        dcFields: source.dcFields,
        dcAggregate: source.dcAggregate || 'sum',
        fallback: source.fallback ?? 0,
      },
      dealCenterData
    );
  }

  const located = locateField(tab, source.fieldKey, source.sectionId);
  return resolveStateFieldValue(
    state,
    located?.field?.id || source.fieldKey,
    source.aggregate || 'value',
    located?.field,
    source.columnKeys
  );
}

function sumContributorSources(sources: any[], state: any, dealCenterData: any, tab: any) {
  return (sources || []).reduce(
    (sum, source) => sum + resolveContributorSourceValue(source, state, dealCenterData, tab),
    0
  );
}

function contributorMatches(contributor: any, comboState: any, dealCenterData: any, ctx: any = {}) {
  if (!contributor?.when?.rules?.length) return true;
  return evaluateRuleGroup(contributor.when, {
    dealCenterData,
    state: comboState || {},
    tab: ctx.tab,
    tabState: ctx.tabState,
    sections: ctx.sections,
  });
}

function resolveContributorValueResult(contributor: any, ctx: any) {
  const { tabState, tab, field, dealCenterData = {} } = ctx;
  const scope = contributor.scope || 'combination';
  const sectionId = contributor.sectionId;
  let matched = false;
  let value = 0;

  const addContribution = (whenOk: boolean, amount: number) => {
    if (!whenOk) return;
    matched = true;
    value += amount;
  };

  if (scope === 'tab') {
    if (contributorMatches(contributor, tabState, dealCenterData, ctx)) {
      matched = true;
      value = sumContributorSources(contributor.sources, tabState, dealCenterData, tab);
    }
    return { value, matched };
  }

  if (scope === 'section') {
    const sections = getTabSections(tab).filter((s: any) => !sectionId || s.id === sectionId);

    sections.forEach((section) => {
      if (section.sectionType === 'combination') {
        const combos = tabState?.comboGroups?.[section.id]?.combinations || [];
        combos.forEach((combo: any) => {
          if (!comboMatchesOptionBinding(field, combo, section.id, tab)) return;
          addContribution(
            contributorMatches(contributor, combo, dealCenterData, ctx),
            sumContributorSources(contributor.sources, combo, dealCenterData, tab)
          );
        });
        return;
      }

      const sectionState = tabState?.sectionFields?.[section.id] || {};
      addContribution(
        contributorMatches(contributor, sectionState, dealCenterData, ctx),
        sumContributorSources(contributor.sources, sectionState, dealCenterData, tab)
      );
    });

    return { value, matched };
  }

  const sections = getTabSections(tab).filter(
    (s: any) => s.sectionType !== 'simple' && (!sectionId || s.id === sectionId)
  );

  sections.forEach((section) => {
    const combos = tabState?.comboGroups?.[section.id]?.combinations || [];
    combos.forEach((combo: any) => {
      if (!comboMatchesOptionBinding(field, combo, section.id, tab)) return;
      addContribution(
        contributorMatches(contributor, combo, dealCenterData, ctx),
        sumContributorSources(contributor.sources, combo, dealCenterData, tab)
      );
    });
  });

  return { value, matched };
}

function resolveContributorValue(contributor: any, ctx: any) {
  return resolveContributorValueResult(contributor, ctx).value;
}

function resolveContributorsValueSource(valueSource: any, ctx: any) {
  const contributors = valueSource.contributors || [];
  const aggregate = valueSource.aggregate || 'sum';
  const fallback = toNumber(valueSource.fallback);

  if (!contributors.length) {
    const legacy = resolveLegacyUsed(ctx);
    if (legacy) return legacy;
    return fallback;
  }

  let anyMatched = false;
  const values = contributors.map((contributor: any) => {
    const { value, matched } = resolveContributorValueResult(contributor, ctx);
    if (matched) anyMatched = true;
    return value;
  });

  if (!anyMatched) {
    return fallback;
  }

  if (aggregate === 'max') {
    return values.length ? Math.max(0, ...values) : fallback;
  }

  return values.reduce((sum: number, val: number) => sum + val, 0);
}

function resolveStateValueSource(valueSource: any, ctx: any) {
  const { tabState, tab, section, sectionState, field } = ctx;
  const fieldKey = valueSource.fieldKey;
  const aggregate = valueSource.aggregate || 'value';
  const scope = valueSource.scope || 'section';
  const located = locateField(tab, fieldKey, valueSource.sectionId);
  const locatedSectionId = valueSource.sectionId ?? located?.sectionId ?? null;
  const locatedSectionType = located?.sectionType;

  if (scope === 'tab') {
    return resolveStateFieldValue(tabState, located?.field?.id || fieldKey, aggregate, located?.field);
  }

  if (scope === 'combination') {
    const targetSectionId =
      locatedSectionId ?? (section?.sectionType !== 'simple' ? section?.id : null);
    const combos =
      (targetSectionId && tabState?.comboGroups?.[targetSectionId]?.combinations) ||
      ctx.combos ||
      [];
    return combos.reduce((total: number, combo: any) => {
      if (targetSectionId && !comboMatchesOptionBinding(field, combo, targetSectionId, tab)) {
        return total;
      }
      return total + resolveStateFieldValue(combo, located?.field?.id || fieldKey, aggregate, located?.field);
    }, 0);
  }

  const fallbackState =
    locatedSectionId && locatedSectionType === 'simple'
      ? tabState?.sectionFields?.[locatedSectionId]
      : sectionState;
  const state = fallbackState || sectionState || tabState;
  const value = resolveStateFieldValue(state, located?.field?.id || fieldKey, aggregate, located?.field);

  if (
    (value === undefined || value === null || value === '') &&
    valueSource.fallback !== undefined
  ) {
    return toNumber(valueSource.fallback);
  }

  return value;
}

function resolveComputedValueSource(valueSource: any, resolvedMetrics: any) {
  const operands = (valueSource.operands || []).map((id: string) => resolvedMetrics[id] ?? 0);

  if (valueSource.formula === 'subtract' && operands.length >= 2) {
    return operands.slice(1).reduce((result, operand) => result - operand, operands[0]);
  }

  if (valueSource.formula === 'sum') {
    return operands.reduce((sum, operand) => sum + operand, 0);
  }

  return operands[0] ?? 0;
}

function resolveLegacyUsed(ctx: any) {
  const { field, tabState, tab, section, sectionState, combos, fields, fieldIndex } = ctx;
  return getAllocationUsedForField(field, {
    tabState,
    tab,
    section,
    sectionState,
    combos,
    fields,
    fieldIndex,
  });
}

function resolveLegacyMetrics(field: any, ctx: any) {
  const { dealCenterData = {} } = ctx;
  const avail = resolveAllocationAvail(field, dealCenterData);
  const used = resolveLegacyUsed(ctx);
  const remaining = avail - used;

  return {
    avail,
    used,
    left: remaining,
    byId: { avail, used, left: remaining },
    stats: [
      { id: 'avail', label: 'Avail', value: avail, color: 'info.main' },
      { id: 'used', label: 'Used', value: used, color: 'warning.main' },
      { id: 'left', label: 'Left', value: remaining, color: resolveDynamicMetricColor('dynamic', remaining) },
    ],
    status: buildAllocationStatus(field, remaining, field.unit || 'ft'),
    available: avail,
    allocated: used,
    remaining,
  };
}

function resolveMetricValue(metric: any, ctx: any, resolvedMetrics: any) {
  const valueSource = metric.valueSource || { type: 'static', fallback: 0 };

  switch (valueSource.type) {
    case 'dealCenter':
      return resolveDealCenterValueSource(valueSource, ctx.dealCenterData);
    case 'state':
      return resolveStateValueSource(valueSource, ctx);
    case 'contributors':
      return resolveContributorsValueSource(valueSource, ctx);
    case 'computed':
      return resolveComputedValueSource(valueSource, resolvedMetrics);
    case 'static':
    default:
      return toNumber(valueSource.fallback);
  }
}

export function resolveAllocationMetrics(field: any, ctx: any = {}) {
  const normalized = normalizeAllocationField(field);

  if (!normalized.metrics?.length) {
    return resolveLegacyMetrics(field, ctx);
  }

  const metrics = normalizeAllocationMetrics(normalized);
  const resolvedMetrics: Record<string, number> = {};
  const byId: Record<string, number> = {};

  metrics.forEach((metric: any) => {
    if (metric.valueSource?.type === 'computed') return;
    const value = resolveMetricValue(metric, ctx, resolvedMetrics);
    resolvedMetrics[metric.id] = value;
    byId[metric.id] = value;
  });

  metrics
    .filter((metric: any) => metric.valueSource?.type === 'computed')
    .forEach((metric: any) => {
      const value = resolveMetricValue(metric, ctx, resolvedMetrics);
      resolvedMetrics[metric.id] = value;
      byId[metric.id] = value;
    });

  const unit = normalized.unit || 'ft';
  const stats = metrics.map((metric: any) => {
    const value = resolvedMetrics[metric.id] ?? 0;
    return {
      id: metric.id,
      label: metric.label,
      value,
      color: resolveDynamicMetricColor(metric.color, value),
      displayValue: `${value}${unit}`,
    };
  });

  const balanceMetric =
    metrics.find((metric: any) => metric.role === 'balance') ||
    metrics.find((metric: any) => metric.id === 'left');
  const budgetMetric =
    metrics.find((metric: any) => metric.role === 'budget') ||
    metrics.find((metric: any) => metric.id === 'avail');
  const consumedMetric =
    metrics.find((metric: any) => metric.role === 'consumed') ||
    metrics.find((metric: any) => metric.id === 'used');

  const balanceValue =
    balanceMetric != null
      ? resolvedMetrics[balanceMetric.id]
      : (resolvedMetrics[budgetMetric?.id] ?? 0) - (resolvedMetrics[consumedMetric?.id] ?? 0);

  const available = budgetMetric != null ? resolvedMetrics[budgetMetric.id] : stats[0]?.value ?? 0;
  const allocated = consumedMetric != null ? resolvedMetrics[consumedMetric.id] : stats[1]?.value ?? 0;
  const remaining = balanceValue ?? available - allocated;

  return {
    byId,
    stats: stats.map((stat) => ({
      ...stat,
      displayValue: `${stat.value}${unit}`,
    })),
    status: buildAllocationStatus(normalized, remaining, unit),
    available,
    allocated,
    remaining,
  };
}
