import { getTabSections } from './combination-utils';
import { isContainerFieldType } from '../constants/field-types';
import { resolveLocationGridConfig } from './location-grid-utils';

export const ALLOCATION_METRIC_ROLES = ['budget', 'consumed', 'balance', 'display'];

export const ALLOCATION_VALUE_SOURCE_TYPES = [
  'dealCenter',
  'state',
  'contributors',
  'computed',
  'static',
];

export const ALLOCATION_CONTRIBUTOR_SCOPES = ['combination', 'section', 'tab'];

export const CONTRIBUTOR_AGGREGATE_OPTIONS = [
  { value: 'gridTotal', label: 'Grid total (sum all cells)' },
  { value: 'value', label: 'Field value' },
  { value: 'columnSum', label: 'Column sum (selected columns)' },
];

export function getContributorAggregateOptionsForFieldType(fieldType: string) {
  if (fieldType === 'locationGrid') {
    return CONTRIBUTOR_AGGREGATE_OPTIONS;
  }
  return CONTRIBUTOR_AGGREGATE_OPTIONS.filter((opt) => opt.value === 'value');
}

export function getGridColumnsForFieldOption(fieldOption: any) {
  if (!fieldOption || fieldOption.type !== 'locationGrid') return [];
  return resolveLocationGridConfig(fieldOption).columns || [];
}

export const DEFAULT_ALLOCATION_STATUS_MESSAGES = {
  enabled: true,
  tolerance: 0.1,
  over: 'OVER {amount}{unit}',
  perfect: 'Perfectly allocated!',
  incomplete: 'INCOMPLETE — {amount}{unit} remaining',
};

function createMetricId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultDealCenterValueSource(overrides: any = {}) {
  return {
    type: 'dealCenter',
    dcField: '',
    dcFields: [],
    dcAggregate: 'sum',
    fallback: 0,
    ...overrides,
  };
}

export function createDefaultContributorsValueSource(overrides: any = {}) {
  return {
    type: 'contributors',
    aggregate: 'sum',
    fallback: 0,
    contributors: [],
    ...overrides,
  };
}

export function createDefaultComputedValueSource(operands = ['avail', 'used']) {
  return {
    type: 'computed',
    formula: 'subtract',
    operands,
  };
}

export function createDefaultAllocationMetrics() {
  return [
    {
      id: 'avail',
      label: 'Avail',
      role: 'budget',
      color: 'info.main',
      valueSource: createDefaultDealCenterValueSource(),
    },
    {
      id: 'used',
      label: 'Used',
      role: 'consumed',
      color: 'warning.main',
      valueSource: createDefaultContributorsValueSource(),
    },
    {
      id: 'left',
      label: 'Left',
      role: 'balance',
      color: 'dynamic',
      valueSource: createDefaultComputedValueSource(['avail', 'used']),
    },
  ];
}

export function createEmptyContributor(overrides: any = {}) {
  return {
    id: createMetricId('contrib'),
    label: '',
    scope: 'combination',
    sectionId: '',
    when: null,
    sources: [],
    ...overrides,
  };
}

export function createEmptyContributorSource(overrides: any = {}) {
  return {
    source: 'state',
    fieldKey: '',
    aggregate: 'gridTotal',
    ...overrides,
  };
}

export function createEmptyAllocationMetric(overrides: any = {}) {
  return {
    id: createMetricId('metric'),
    label: 'Metric',
    role: 'display',
    color: 'text.primary',
    valueSource: {
      type: 'static',
      fallback: 0,
    },
    ...overrides,
  };
}

export function normalizeAllocationStatusMessages(statusMessages: any) {
  return {
    ...DEFAULT_ALLOCATION_STATUS_MESSAGES,
    ...(statusMessages || {}),
  };
}

export function normalizeAllocationMetrics(field: any) {
  if (field?.metrics?.length) {
    return field.metrics.map((metric: any) => ({
      ...metric,
      valueSource: metric.valueSource || { type: 'static', fallback: 0 },
    }));
  }

  return [
    {
      id: 'avail',
      label: 'Avail',
      role: 'budget',
      color: 'info.main',
      valueSource: {
        type: 'dealCenter',
        dcField: field?.dcField || '',
        dcFields: field?.dcFields || [],
        dcAggregate: field?.dcAggregate || 'sum',
        fallback: Number(field?.avail) || 0,
      },
    },
    {
      id: 'used',
      label: 'Used',
      role: 'consumed',
      color: 'warning.main',
      valueSource: createDefaultContributorsValueSource(),
    },
    {
      id: 'left',
      label: 'Left',
      role: 'balance',
      color: 'dynamic',
      valueSource: createDefaultComputedValueSource(['avail', 'used']),
    },
  ];
}

export function normalizeAllocationField(field: any) {
  if (!field || field.type !== 'allocation') return field;

  return {
    ...field,
    metrics: normalizeAllocationMetrics(field),
    statusMessages: normalizeAllocationStatusMessages(field.statusMessages),
  };
}

export function getAllocationMetricByRole(field: any, role: string) {
  const metrics = normalizeAllocationMetrics(field);
  return metrics.find((metric: any) => metric.role === role) || null;
}

export function getAllocationMetricById(field: any, metricId: string) {
  const metrics = normalizeAllocationMetrics(field);
  return metrics.find((metric: any) => metric.id === metricId) || null;
}

export function formatStatusMessage(template: string, { amount = 0, unit = '' } = {}) {
  const safeAmount = Math.abs(Number(amount) || 0);
  const rounded = Number.isInteger(safeAmount) ? safeAmount : safeAmount.toFixed(1);

  return String(template || '')
    .replace(/\{amount\}/g, String(rounded))
    .replace(/\{unit\}/g, unit || '');
}

export function buildAllocationStatus(field: any, balanceValue: number, unit = 'ft') {
  const statusMessages = normalizeAllocationStatusMessages(field?.statusMessages);

  if (!statusMessages.enabled) return null;

  const tolerance = Number(statusMessages.tolerance) || 0;
  const remaining = Number(balanceValue) || 0;

  if (remaining < -tolerance) {
    return {
      type: 'error',
      message: formatStatusMessage(statusMessages.over, { amount: remaining, unit }),
    };
  }

  if (Math.abs(remaining) <= tolerance) {
    return {
      type: 'success',
      message: statusMessages.perfect,
      uppercase: false,
    };
  }

  return {
    type: 'warning',
    message: formatStatusMessage(statusMessages.incomplete, { amount: remaining, unit }),
  };
}

export function resolveDynamicMetricColor(color: string, value: number) {
  if (color !== 'dynamic') return color;

  const remaining = Number(value) || 0;
  if (remaining < 0) return 'error.main';
  if (remaining === 0) return 'success.main';
  return 'info.main';
}

const SKIPPED_FIELD_TYPES = new Set(['sectionLabel', 'combinationSummary']);

function shouldSkipDependencyTarget(field: any, { currentFieldId } = {}) {
  if (!field?.key) return true;
  if (field.id === currentFieldId) return true;
  if (SKIPPED_FIELD_TYPES.has(field.type)) return true;
  if (field.key.startsWith('_') && field.type !== 'allocation') return true;
  return false;
}

function buildFieldOption(field: any, { sectionLabel, sectionId, sectionType }: any) {
  const label = field.label || field.key;
  const fieldId = field.id;
  const compoundId = sectionId ? `${sectionId}:${fieldId}` : fieldId;
  const option: any = {
    id: compoundId,
    fieldId,
    key: field.key,
    label,
    type: field.type,
    options: field.options,
    sectionId: sectionId ?? null,
    sectionType: sectionType || (sectionId ? 'combination' : 'tab'),
    displayLabel: sectionId ? `${sectionLabel} › ${label}` : `Tab › ${label}`,
  };

  if (field.type === 'locationGrid') {
    option.gridConfig = field.gridConfig;
    option.singleStory = field.singleStory;
  }

  return option;
}

function collectFromFieldList(fieldList: any[], sectionCtx: any, options: any[], seenIds: Set<string>, currentFieldId: string) {
  (fieldList || []).forEach((field) => {
    if (isContainerFieldType(field.type) && field.fields?.length) {
      collectFromFieldList(field.fields, sectionCtx, options, seenIds, currentFieldId);
    }

    if (shouldSkipDependencyTarget(field, { currentFieldId })) return;

    const compoundId = sectionCtx.sectionId ? `${sectionCtx.sectionId}:${field.id}` : field.id;
    if (seenIds.has(compoundId)) return;
    seenIds.add(compoundId);
    options.push(buildFieldOption(field, sectionCtx));
  });
}

export function buildTabForFieldOptions(tab: any, sections?: any[]) {
  if (!tab && sections?.length) {
    return { sections };
  }
  if (!tab) return null;
  if (sections?.length) {
    return { ...tab, sections };
  }
  return tab;
}

function walkAllTabFields(tab: any, visitor: (field: any, section: any) => void) {
  if (!tab) return;

  getTabSections(tab).forEach((section: any) => {
    const visitList = (fieldList: any[]) => {
      (fieldList || []).forEach((field) => {
        visitor(field, section);
        if (isContainerFieldType(field.type) && field.fields?.length) {
          visitList(field.fields);
        }
      });
    };
    visitList(section.fields);
  });

  (tab.fields || []).forEach((field: any) => {
    visitor(field, null);
    if (isContainerFieldType(field.type) && field.fields?.length) {
      const visitList = (fieldList: any[]) => {
        (fieldList || []).forEach((child: any) => {
          visitor(child, null);
          if (isContainerFieldType(child.type) && child.fields?.length) {
            visitList(child.fields);
          }
        });
      };
      visitList(field.fields);
    }
  });
}

export function summarizeTabDependencyFields(tab: any, sections?: any[]) {
  const tabForScan = buildTabForFieldOptions(tab, sections);
  const summary = {
    allocationCount: 0,
    inputFieldCount: 0,
    skippedCount: 0,
  };

  if (!tabForScan) return summary;

  walkAllTabFields(tabForScan, (field) => {
    if (field.type === 'allocation') {
      summary.allocationCount += 1;
      summary.inputFieldCount += 1;
      return;
    }
    if (shouldSkipDependencyTarget(field, {})) {
      if (field.type === 'sectionLabel' || field.type === 'combinationSummary') {
        summary.skippedCount += 1;
      }
      return;
    }
    summary.inputFieldCount += 1;
  });

  return summary;
}

export function collectJobBuilderFieldOptions(tab: any, { currentSectionId, currentFieldId, sections } = {}) {
  const tabForScan = buildTabForFieldOptions(tab, sections);
  if (!tabForScan) return [];

  const options: any[] = [];

  getTabSections(tabForScan).forEach((section: any) => {
    const sectionSeenIds = new Set<string>();
    collectFromFieldList(
      section.fields,
      {
        sectionLabel: section.label || section.id,
        sectionId: section.id,
        sectionType: section.sectionType || 'combination',
      },
      options,
      sectionSeenIds,
      currentFieldId
    );
  });

  const tabSeenIds = new Set<string>();
  collectFromFieldList(
    tabForScan.fields,
    {
      sectionLabel: 'Tab',
      sectionId: null,
      sectionType: 'tab',
    },
    options,
    tabSeenIds,
    currentFieldId
  );

  return options;
}

export function collectAllFieldsFromTab(tab: any, sections?: any[]) {
  const all: any[] = [];
  const tabForScan = buildTabForFieldOptions(tab, sections);
  if (!tabForScan) return all;

  const walk = (fieldList: any[]) => {
    (fieldList || []).forEach((field) => {
      all.push(field);
      if (isContainerFieldType(field.type) && field.fields?.length) {
        walk(field.fields);
      }
    });
  };

  getTabSections(tabForScan).forEach((section: any) => walk(section.fields));
  walk(tabForScan.fields);

  return all;
}

export function isJobBuilderFieldIdRef(ref: string) {
  const str = String(ref || '');
  if (str.includes(':')) {
    const fieldPart = str.split(':').pop();
    return fieldPart?.startsWith('field_') || false;
  }
  return str.startsWith('field_');
}

function parseFieldRef(ref: string) {
  const str = String(ref || '');
  const colonIdx = str.indexOf(':');
  if (colonIdx !== -1) {
    const sectionId = str.slice(0, colonIdx);
    const fieldId = str.slice(colonIdx + 1);
    return { sectionId, fieldId };
  }
  return { sectionId: null, fieldId: str };
}

export function findFieldContextOnTab(tab: any, fieldRef: string, sections?: any[]) {
  if (!fieldRef) return null;

  const tabForScan = buildTabForFieldOptions(tab, sections);
  if (!tabForScan) return null;

  const { sectionId: targetSectionId, fieldId: rawFieldId } = parseFieldRef(fieldRef);
  const matchById = isJobBuilderFieldIdRef(rawFieldId);
  let match: any = null;

  const searchList = (fieldList: any[], section: any, parentContainer: any) => {
    (fieldList || []).forEach((field, fieldIndex) => {
      if (match) return;

      const isMatch = matchById ? field.id === rawFieldId : field.key === rawFieldId;
      if (isMatch) {
        match = {
          field,
          section: section || null,
          parentContainer: parentContainer || null,
          fieldList: fieldList || [],
          fieldIndex,
        };
        return;
      }

      if (isContainerFieldType(field.type) && field.fields?.length) {
        searchList(field.fields, section, field);
      }
    });
  };

  getTabSections(tabForScan).forEach((section: any) => {
    if (match) return;
    if (targetSectionId && section.id !== targetSectionId) return;
    searchList(section.fields, section, null);
  });

  if (!match) {
    if (!targetSectionId) {
      searchList(tabForScan.fields, null, null);
    }
  }

  return match;
}

export function findFieldByKeyInSection(tab: any, sectionId: string, fieldKey: string) {
  if (!fieldKey || !tab || !sectionId) return null;

  const tabForScan = buildTabForFieldOptions(tab);
  if (!tabForScan) return null;

  const section = getTabSections(tabForScan).find((item: any) => item.id === sectionId);
  if (!section) return null;

  let match: any = null;

  const searchList = (fieldList: any[]) => {
    (fieldList || []).forEach((field) => {
      if (match) return;
      if (field.key === fieldKey || field.id === fieldKey) {
        match = field;
        return;
      }
      if (isContainerFieldType(field.type) && field.fields?.length) {
        searchList(field.fields);
      }
    });
  };

  searchList(section.fields);
  return match;
}

export function getTabSectionOptions(tab: any) {
  return getTabSections(tab).map((section: any) => ({
    id: section.id,
    label: section.label || section.id,
    sectionType: section.sectionType || 'combination',
  }));
}

export function getCombinationSectionOptions(tab: any) {
  return getTabSectionOptions(tab).filter((section: any) => section.sectionType === 'combination');
}

export function getToggleFieldsForSection(tab: any, sectionId: string) {
  const section = getTabSections(tab).find((item: any) => item.id === sectionId);
  return (section?.fields || []).filter(
    (field: any) => (field.type === 'toggle' || field.type === 'optionList') && field.key
  );
}

export function resolveFieldIdFromKey(tab: any, sectionId: string, fieldKey: string) {
  if (!tab || !sectionId || !fieldKey) return fieldKey;
  const section = getTabSections(tab).find((s: any) => s.id === sectionId);
  const field = (section?.fields || []).find((f: any) => f.key === fieldKey);
  return field?.id || fieldKey;
}

export function buildOptionBindingWhenRule(optionBinding: any) {
  const option =
    optionBinding?.optionValue ||
    (Array.isArray(optionBinding?.optionValues) ? optionBinding.optionValues[0] : null);
  if (!optionBinding?.toggleFieldKey || !option) return null;

  return {
    match: 'all',
    rules: [
      {
        source: 'state',
        field: optionBinding.toggleFieldKey,
        operator: 'eq',
        value: option,
      },
    ],
  };
}

export function normalizeOptionBinding(optionBinding: any) {
  if (!optionBinding) return null;
  if (!optionBinding.enabled) return null;

  if (!optionBinding.bindings?.length && (optionBinding.sectionId || optionBinding.toggleFieldKey)) {
    return {
      enabled: true,
      match: optionBinding.match || 'all',
      bindings: [
        {
          sectionId: optionBinding.sectionId || '',
          toggleFieldKey: optionBinding.toggleFieldKey || '',
          optionValues:
            optionBinding.optionValues?.length
              ? optionBinding.optionValues
              : optionBinding.optionValue
                ? [optionBinding.optionValue]
                : [],
        },
      ],
      applyToMetrics: optionBinding.applyToMetrics || ['consumed'],
    };
  }

  return {
    enabled: true,
    match: optionBinding.match || 'all',
    bindings: (optionBinding.bindings || [])
      .map((b: any) => ({
        sectionId: b.sectionId || '',
        toggleFieldKey: b.toggleFieldKey || '',
        optionValues:
          b.optionValues?.length ? b.optionValues : b.optionValue ? [b.optionValue] : [],
      }))
      .filter((b: any) => b.sectionId && b.toggleFieldKey && b.optionValues?.length),
    applyToMetrics: optionBinding.applyToMetrics || ['consumed'],
  };
}

export function comboMatchesOptionBinding(field: any, combo: any, sectionId: string, tab: any) {
  const binding = normalizeOptionBinding(field?.optionBinding);
  if (!binding) return true;

  const relevant = (binding.bindings || []).filter((b: any) => b.sectionId === sectionId);
  if (!relevant.length) return true;

  const checks = relevant.map((b: any) => {
    const resolvedKey = resolveFieldIdFromKey(tab, sectionId, b.toggleFieldKey);
    return (b.optionValues || []).includes(combo?.[resolvedKey]);
  });
  if ((binding.match || 'all') === 'any') return checks.some(Boolean);
  return checks.every(Boolean);
}

export function isAllocationCardActive(field: any, tabState: any, tab: any) {
  const binding = normalizeOptionBinding(field?.optionBinding);
  if (!binding?.bindings?.length) return true;

  const bindingMatch = binding.match || 'all';
  const uniqueSectionIds = [...new Set(binding.bindings.map((b: any) => b.sectionId).filter(Boolean))];

  const results = uniqueSectionIds.map((sectionId) => {
    const section = getTabSections(tab).find((item: any) => item.id === sectionId);
    const sectionType = section?.sectionType || 'combination';

    const sectionBindings = binding.bindings.filter((b: any) => b.sectionId === sectionId);
    if (!sectionBindings.length) return true;

    if (sectionType === 'simple') {
      const sectionState = tabState?.sectionFields?.[sectionId] || {};
      const checks = sectionBindings.map((b: any) => {
        const resolvedKey = resolveFieldIdFromKey(tab, sectionId, b.toggleFieldKey);
        return (b.optionValues || []).includes(sectionState?.[resolvedKey]);
      });
      if (bindingMatch === 'any') return checks.some(Boolean);
      return checks.every(Boolean);
    }

    const combos = tabState?.comboGroups?.[sectionId]?.combinations || [];
    if (!combos.length) return false;

    return combos.some((combo: any) => comboMatchesOptionBinding(field, combo, sectionId, tab));
  });

  if (bindingMatch === 'any') return results.some(Boolean);
  return results.every(Boolean);
}

export function getFieldsForSection(tab: any, sectionId: string, { types } = {}) {
  const section = getTabSections(tab).find((item: any) => item.id === sectionId);
  let fields = section?.fields || [];

  if (types?.length) {
    fields = fields.filter((field: any) => types.includes(field.type));
  }

  return fields.filter((field: any) => field.key && !field.key.startsWith('_'));
}

export function createContributorForField(fieldMeta: any, sectionId: string, overrides: any = {}) {
  const aggregate =
    fieldMeta?.type === 'locationGrid' ? 'gridTotal' : 'value';

  return createEmptyContributor({
    label: fieldMeta?.label || fieldMeta?.key || 'Component',
    scope: 'combination',
    sectionId: sectionId || fieldMeta?.sectionId || '',
    sources: [
      createEmptyContributorSource({
        fieldKey: fieldMeta?.key || '',
        aggregate,
        sectionId: sectionId || fieldMeta?.sectionId || '',
      }),
    ],
    ...overrides,
  });
}
