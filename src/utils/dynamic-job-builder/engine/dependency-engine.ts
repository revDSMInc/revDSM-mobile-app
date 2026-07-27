import {
  collectAllocationFields,
} from './allocation-utils';
import {
  findFieldContextOnTab,
  isAllocationCardActive,
  isJobBuilderFieldIdRef,
  normalizeAllocationMetrics,
  normalizeAllocationStatusMessages,
} from './allocation-config-utils';
import { resolveLocationGridConfig } from './location-grid-utils';
import { resolveAllocationMetrics } from './allocation-value-resolver';
import { getTabSections } from './combination-utils';
import { isContainerFieldType } from '../constants/field-types';
import {
  anyDealCenterRefHasData,
  hasDealCenterDataValue,
  sumDealCenterRefs,
  toDealCenterNumber,
} from './deal-center-field-utils';
import { hasDropdownOptionDependencies, isVisibleByDropdownMapping } from './dropdown-utils';

export const RULE_OPERATORS = [
  'truthy',
  'falsy',
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'in',
  'notIn',
  'exists',
  'anyNonZero',
  'allNonZero',
  'overAllocated',
  'incompleteAllocation',
  'perfectlyAllocated',
];

function hasDealCenterContext(dealCenterData: any = {}) {
  return Object.keys(dealCenterData || {}).length > 0;
}

function toNumber(value: any) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function buildRuleEvaluationContext(ctx: any = {}, state: any = {}) {
  return {
    dealCenterData: ctx.dealCenterData || {},
    state: state || ctx.state || {},
    tab: ctx.tab,
    tabState: ctx.tabState,
    section: ctx.section,
    sectionState: ctx.sectionState,
    combos: ctx.combos,
    sections: ctx.sections,
  };
}

function resolveAllocationMetricValue(field: any, rule: any, ctx: any) {
  const fieldRef = rule?.fieldId || rule?.field;
  const located = findFieldContextOnTab(ctx.tab, fieldRef, ctx.sections);
  if (!located?.field || located.field.type !== 'allocation') return undefined;

  const { tabState, tab, dealCenterData = {} } = ctx;
  if (!tab || !tabState) return undefined;

  const section = located.section;
  const sectionId = section?.id;
  const sectionType = section?.sectionType || 'combination';
  const combos =
    ctx.combos ||
    (sectionId && tabState?.comboGroups?.[sectionId]?.combinations) ||
    [];
  const sectionState =
    ctx.sectionState ||
    (sectionId && sectionType === 'simple' ? tabState?.sectionFields?.[sectionId] : undefined) ||
    tabState;

  const resolved = resolveAllocationMetrics(located.field, {
    field: located.field,
    tabState,
    tab,
    section,
    sectionState,
    combos,
    fields: located.fieldList,
    fieldIndex: located.fieldIndex,
    dealCenterData,
  });

  const metric = rule?.allocationMetric || 'remaining';
  if (metric === 'used') return resolved.allocated;
  if (metric === 'available' || metric === 'avail') return resolved.available;
  return resolved.remaining;
}

function resolveAllocationTolerance(field: any) {
  return Number(normalizeAllocationStatusMessages(field?.statusMessages).tolerance) || 0;
}

export function getJobBuilderFieldRefs(rule: any) {
  if ((rule?.source || 'dealCenter') !== 'state') return [];
  if (rule.fieldIds?.length) return rule.fieldIds;
  if (rule.fieldId) return [rule.fieldId];
  if (rule.fields?.length) return rule.fields;
  if (rule.field) return [rule.field];
  return [];
}

export function getJobBuilderFieldKeys(rule: any) {
  return getJobBuilderFieldRefs(rule);
}

function buildSingleFieldRule(rule: any, fieldRef: string) {
  if (isJobBuilderFieldIdRef(fieldRef)) {
    return { ...rule, fieldId: fieldRef, fieldIds: [], field: '', fields: [] };
  }
  return { ...rule, field: fieldRef, fieldId: '', fieldIds: [], fields: [] };
}

function getActiveFieldRef(rule: any) {
  return rule?.fieldId || rule?.field || '';
}

function combineMultiFieldResults(operator: string, results: boolean[]) {
  if (!results.length) return false;

  const matchAllOperators = new Set(['perfectlyAllocated', 'allNonZero', 'falsy']);
  if (matchAllOperators.has(operator)) {
    return results.every(Boolean);
  }

  return results.some(Boolean);
}

function evaluateAllocationStateRule(fieldRef: string, rule: any, ctx: any) {
  const located = findFieldContextOnTab(ctx.tab, fieldRef, ctx.sections);
  if (!located?.field || located.field.type !== 'allocation') return null;

  const operator = rule.operator || 'truthy';

  if (!isAllocationCardActive(located.field, ctx.tabState, ctx.tab)) {
    if (operator === 'overAllocated' || operator === 'incompleteAllocation') return false;
    if (operator === 'perfectlyAllocated') return true;
  }

  const remaining = Number(
    resolveAllocationMetricValue(located.field, { ...rule, fieldId: fieldRef, field: '', allocationMetric: 'remaining' }, ctx)
  ) || 0;
  const tolerance = resolveAllocationTolerance(located.field);

  if (operator === 'overAllocated') return remaining < -tolerance;
  if (operator === 'incompleteAllocation') return remaining > tolerance;
  if (operator === 'perfectlyAllocated') return Math.abs(remaining) <= tolerance;

  return null;
}

function resolveSourceValue(rule: any, ctx: any) {
  const source = rule?.source || 'dealCenter';
  const { dealCenterData = {}, state = {}, tab } = ctx;

  if (source === 'state') {
    const fieldRef = getActiveFieldRef(rule);
    if (fieldRef && tab) {
      const located = findFieldContextOnTab(tab, fieldRef, ctx.sections);
      if (located?.field?.type === 'allocation') {
        return resolveAllocationMetricValue(located.field, rule, ctx);
      }
    }
  }

  if (rule?.fields?.length) {
    const values = rule.fields.map((fieldRef: string) => {
      if (source === 'state') {
        if (tab) {
          const allocationResult = evaluateAllocationStateRule(fieldRef, { ...rule, fieldId: isJobBuilderFieldIdRef(fieldRef) ? fieldRef : '', field: isJobBuilderFieldIdRef(fieldRef) ? '' : fieldRef, fields: [] }, ctx);
          if (allocationResult !== null) return allocationResult;
        }
        const located = tab ? findFieldContextOnTab(tab, fieldRef, ctx.sections) : null;
        if (located?.field) {
          const fieldId = located.field.id;
          const sectionId = located.section?.id;
          if (sectionId && ctx.tabState?.sectionFields?.[sectionId]) {
            return ctx.tabState.sectionFields[sectionId][fieldId];
          }
          return state[fieldId];
        }
        return state[fieldRef];
      }
      return toDealCenterNumber(dealCenterData, fieldRef);
    });
    return values;
  }

  const key = rule?.field;
  if (!key) {
    if (source === 'state' && rule?.fieldId) {
      const located = tab ? findFieldContextOnTab(tab, rule.fieldId, ctx.sections) : null;
      if (located?.field) {
        const fieldId = located.field.id;
        const sectionId = located.section?.id;
        if (sectionId && ctx.tabState?.sectionFields?.[sectionId]) {
          return ctx.tabState.sectionFields[sectionId][fieldId];
        }
        return state[fieldId];
      }
      return state[rule.fieldId];
    }
    return undefined;
  }

  if (source === 'state') {
    const located = tab ? findFieldContextOnTab(tab, key, ctx.sections) : null;
    if (located?.field) {
      const fieldId = located.field.id;
      const sectionId = located.section?.id;
      if (sectionId && ctx.tabState?.sectionFields?.[sectionId]) {
        return ctx.tabState.sectionFields[sectionId][fieldId];
      }
      return state[fieldId];
    }
    return state[key];
  }
  return toDealCenterNumber(dealCenterData, key);
}

function isNonZero(value: any) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return toNumber(value) > 0;
  return Boolean(value);
}

export function evaluateRule(rule: any, ctx: any = {}) {
  if (!rule) return true;

  const operator = rule.operator || 'truthy';
  const operand = rule.value;
  const source = rule.source || 'dealCenter';
  const fieldRefs = getJobBuilderFieldRefs(rule);

  if (source === 'state' && fieldRefs.length > 1) {
    const results = fieldRefs.map((fieldRef: string) =>
      evaluateRule(buildSingleFieldRule(rule, fieldRef), ctx)
    );
    return combineMultiFieldResults(operator, results);
  }

  if (source === 'state' && fieldRefs.length === 1 && !rule.fieldId && !rule.field) {
    rule = buildSingleFieldRule(rule, fieldRefs[0]);
  }

  const activeFieldRef = getActiveFieldRef(rule);
  if (source === 'state' && activeFieldRef && ctx.tab) {
    const allocationResult = evaluateAllocationStateRule(activeFieldRef, rule, ctx);
    if (allocationResult !== null) return allocationResult;
  }

  const raw = resolveSourceValue(rule, ctx);

  if (operator === 'anyNonZero') {
    const values = Array.isArray(raw) ? raw : [raw];
    return values.some((v) => isNonZero(v));
  }

  if (operator === 'allNonZero') {
    const values = Array.isArray(raw) ? raw : [raw];
    return values.length > 0 && values.every((v) => isNonZero(v));
  }

  if (operator === 'exists') {
    if (Array.isArray(raw)) return raw.some((v) => v !== undefined && v !== null && v !== '');
    return raw !== undefined && raw !== null && raw !== '';
  }

  if (operator === 'truthy') {
    if (Array.isArray(raw)) return raw.some((v) => Boolean(v));
    return Boolean(raw);
  }

  if (operator === 'falsy') {
    if (Array.isArray(raw)) return raw.every((v) => !v);
    return !raw;
  }

  const left = Array.isArray(raw) ? toNumber(raw.reduce((s: number, v: any) => s + toNumber(v), 0)) : toNumber(raw);

  if (operator === 'gt') return left > toNumber(operand);
  if (operator === 'gte') return left >= toNumber(operand);
  if (operator === 'lt') return left < toNumber(operand);
  if (operator === 'lte') return left <= toNumber(operand);
  if (operator === 'eq') return String(raw) === String(operand);
  if (operator === 'neq') return String(raw) !== String(operand);
  if (operator === 'in') {
    const list = Array.isArray(operand) ? operand : operand ? [operand] : [];
    return list.map(String).includes(String(raw));
  }
  if (operator === 'notIn') {
    const list = Array.isArray(operand) ? operand : operand ? [operand] : [];
    return !list.map(String).includes(String(raw));
  }

  return Boolean(raw);
}

export function evaluateRuleGroup(group: any, ctx: any = {}) {
  if (!group) return true;

  const rules = group.rules || (group.field || group.fields ? [group] : []);
  if (!rules.length) return true;

  const match = group.match || 'all';
  const results = rules.map((rule: any) => evaluateRule(rule, ctx));

  if (match === 'any') return results.some(Boolean);
  return results.every(Boolean);
}

function hasExplicitTabVisibility(tab: any) {
  const visibility = tab?.dependencies?.visibility;
  return Boolean(visibility?.when?.rules?.length);
}

function resolveAllocationAvailFromDc(field: any, dealCenterData: any = {}) {
  const keys = field?.dcFields?.length ? field.dcFields : field?.dcField ? [field.dcField] : [];

  if (!keys.length) {
    return Number(field?.avail) || 0;
  }

  if (!anyDealCenterRefHasData(dealCenterData, keys)) {
    return Number(field?.avail) || 0;
  }

  return sumDealCenterRefs(dealCenterData, keys, field?.dcAggregate || 'sum');
}

export function resolveAllocationAvail(field: any, dealCenterData: any = {}) {
  if (field?.dcField || field?.dcFields?.length) {
    return resolveAllocationAvailFromDc(field, dealCenterData);
  }
  return Number(field?.avail) || 0;
}

export function isAllocationExcluded(field: any, dealCenterData: any = {}) {
  if (field?.dcField || field?.dcFields?.length) {
    const hasAnyKey = (field.dcFields || [field.dcField]).some(
      (key: string) => hasDealCenterDataValue(dealCenterData, key)
    );
    if (!hasAnyKey) return false;
    return resolveAllocationAvail(field, dealCenterData) === 0;
  }

  if (!hasDealCenterContext(dealCenterData)) {
    return false;
  }

  return resolveAllocationAvail(field, dealCenterData) === 0;
}

function isTabLockedByLegacyRules(tab: any, dealCenterData: any = {}) {
  const dealCenterActive = hasDealCenterContext(dealCenterData);

  if (tab.lockedByDefault) return true;

  if (hasExplicitTabVisibility(tab)) {
    return false;
  }

  if (tab.dcField && dealCenterActive && !hasDealCenterDataValue(dealCenterData, tab.dcField)) {
    return true;
  }

  const allocations = collectAllocationFields(tab);
  if (!allocations.length) return false;

  return allocations.some((field) => isAllocationExcluded(field, dealCenterData));
}

export function isTabVisible(tab: any, _vertical: any, ctx: any = {}) {
  if (!tab) return false;
  if (tab.isSummary) return true;

  const dealCenterData = ctx.dealCenterData || {};

  if (hasExplicitTabVisibility(tab)) {
    const state = typeof ctx.getState === 'function' ? ctx.getState(tab.id) || {} : ctx.state || {};
    const ruleCtx = { dealCenterData, state };
    return evaluateRuleGroup(tab.dependencies.visibility.when, ruleCtx);
  }

  if (tab.lockedByDefault) return false;

  return !isTabLockedByLegacyRules(tab, dealCenterData);
}

export function getLockedTabIds(vertical: any, dealCenterData: any = {}, ctx: any = {}) {
  const fullCtx = {
    dealCenterData,
    getState: ctx.getState,
    state: ctx.state,
  };

  return (vertical?.tabs || [])
    .filter((tab: any) => !isTabVisible(tab, vertical, fullCtx))
    .map((tab: any) => tab.id);
}

export function getPreviewLockedTabIds(vertical: any) {
  return (vertical?.tabs || [])
    .filter((tab: any) => tab.lockedByDefault)
    .map((tab: any) => tab.id);
}

export function getFirstUnlockedTabId(tabs: any[] = [], lockedTabIds: string[] = []) {
  if (!tabs.length) return '';
  const locked = new Set(lockedTabIds);
  const unlocked = tabs.find((tab) => tab?.id && !locked.has(tab.id));
  return unlocked?.id || tabs[0]?.id || '';
}

export function resolveVerticalLockedTabIds(
  vertical: any,
  { dealCenterData = {}, previewMode = false, applyConditions = true } = {}
) {
  if (!vertical) return [];
  if (previewMode && !applyConditions) return [];
  return getLockedTabIds(vertical, dealCenterData);
}

function collectDescendantFieldRefs(containerField: any) {
  const ids = new Set<string>();
  const keys = new Set<string>();

  const walk = (fields: any[]) => {
    (fields || []).forEach((child) => {
      if (child.id) ids.add(child.id);
      if (child.key) keys.add(child.key);
      if (isContainerFieldType(child.type)) walk(child.fields);
    });
  };

  walk(containerField?.fields);
  return { ids, keys };
}

function isDescendantFieldRef(ref: string, descendants: { ids: Set<string>; keys: Set<string> }) {
  if (!ref) return false;
  if (isJobBuilderFieldIdRef(ref)) return descendants.ids.has(ref);
  return descendants.keys.has(ref);
}

export function isAccordionSelfReferentialVisibility(accordionField: any, visibleWhen: any) {
  if (accordionField?.type !== 'accordion' || !visibleWhen) return false;

  const descendants = collectDescendantFieldRefs(accordionField);
  if (!descendants.ids.size && !descendants.keys.size) return false;

  const normalized = normalizeRuleGroup(visibleWhen);
  const stateRefs = (normalized?.rules || []).flatMap((rule: any) => {
    if ((rule?.source || 'dealCenter') !== 'state') return [];
    return getJobBuilderFieldRefs(rule);
  });

  if (!stateRefs.length) return false;
  return stateRefs.every((ref) => isDescendantFieldRef(ref, descendants));
}

export function isFieldVisible(field: any, state: any = {}, ctx: any = {}) {
  const dropdownVisibility = isVisibleByDropdownMapping(field, ctx.sectionFields, state);
  if (dropdownVisibility === false) return false;

  const visibleWhen = field?.dependencies?.visibleWhen;
  if (!visibleWhen) return true;

  if (field?.type === 'accordion' && isAccordionSelfReferentialVisibility(field, visibleWhen)) {
    return true;
  }

  return evaluateRuleGroup(visibleWhen, buildRuleEvaluationContext(ctx, state));
}

export function isFieldVisibleWithConditions(field: any, state: any = {}, ctx: any = {}, applyConditions = true) {
  if (!applyConditions) return true;
  return isFieldVisible(field, state, ctx);
}

export function isFieldRequired(field: any, state: any = {}, ctx: any = {}) {
  if (field?.required) return true;

  const requiredWhen = field?.dependencies?.requiredWhen;
  if (!requiredWhen) return false;

  return evaluateRuleGroup(requiredWhen, buildRuleEvaluationContext(ctx, state));
}

/** True when a configured default color should apply for the current state.
 * Web parity: src/components/dynamic-job-builder/engine/dependency-engine.js. */
export function isDefaultColorActive(field: any, state: any = {}, ctx: any = {}) {
  const useDefault = field?.useDefaultColor ?? Boolean(field?.defaultValue);
  if (!useDefault || !field?.defaultValue) return false;

  const defaultWhen = field?.dependencies?.defaultWhen;
  if (!defaultWhen) return true;

  return evaluateRuleGroup(defaultWhen, buildRuleEvaluationContext(ctx, state));
}

/**
 * Fallback default for `resolveLockedValue` on a field whose default is conditional
 * (`dependencies.defaultWhen`). Returns '' when the condition is NOT met so the raw
 * `field.defaultValue` is never leaked past the rule (this is what stops a
 * not-included product — e.g. a LeafFilter whose inclusion condition isn't met — from
 * persisting a phantom non-zero default that the portal then renders as a product),
 * and `undefined` when the field has no conditional default at all, letting the caller
 * keep its existing `field.defaultValue` behaviour untouched.
 * Web parity: dependency-engine.js:608.
 */
export function resolveConditionalDefault(field: any, state: any = {}, ctx: any = {}) {
  if (!field?.dependencies?.defaultWhen) return undefined;
  return isDefaultColorActive(field, state, ctx) ? (field.defaultValue ?? '') : '';
}

function walkFields(fields: any[], visitor: (field: any) => void) {
  (fields || []).forEach((field) => visitor(field));
}

function collectFieldsFromTab(tab: any) {
  const fields: any[] = [];

  walkFields(tab?.fields, (f) => fields.push(f));

  getTabSections(tab).forEach((section: any) => {
    walkFields(section.fields, (f) => fields.push(f));
  });

  if (tab?.combinations?.fields) {
    walkFields(tab.combinations.fields, (f) => fields.push(f));
  }

  return fields;
}

export function collectFieldRefs(config: any) {
  const refs: any = {};

  (config?.verticals || []).forEach((vertical: any) => {
    (vertical.tabs || []).forEach((tab: any) => {
      const tabFields = collectFieldsFromTab(tab)
        .filter((f) => f.key && f.type !== 'sectionLabel' && f.type !== 'allocation')
        .map((f) => ({ key: f.key, label: f.label || f.title || f.key, type: f.type, id: f.id }));

      refs[tab.id] = {
        tabLabel: tab.label,
        verticalId: vertical.id,
        fields: tabFields,
      };
    });
  });

  return refs;
}

function collectAllFields(config: any) {
  const all: any[] = [];

  (config?.verticals || []).forEach((vertical: any) => {
    (vertical.tabs || []).forEach((tab: any) => {
      collectFieldsFromTab(tab).forEach((field) => {
        all.push({ field, tab, vertical });
      });
    });
  });

  return all;
}

function normalizeRuleGroup(group: any) {
  if (!group) return null;
  if (group.rules) return group;
  if (group.fieldId || group.fieldIds?.length || group.field || group.fields?.length) {
    return { match: 'all', rules: [group] };
  }
  return null;
}

function validateRuleRefs(rule: any, knownKeys: Set<string>, location: string, errors: string[], warnings: string[], knownIds = new Set<string>()) {
  if (!rule) return;

  const source = rule.source || 'dealCenter';

  if (source === 'state') {
    getJobBuilderFieldRefs(rule).forEach((ref) => {
      if (!ref) return;
      if (isJobBuilderFieldIdRef(ref)) {
        if (!knownIds.has(ref)) {
          errors.push(`${location}: references unknown field id "${ref}"`);
        }
        return;
      }
      if (!knownKeys.has(ref)) {
        errors.push(`${location}: references unknown field "${ref}"`);
      }
    });
  }

  if (source === 'dealCenter' && rule.field && !String(rule.field).trim()) {
    errors.push(`${location}: Deal Center field key is required`);
  }

  if (rule.operator && !RULE_OPERATORS.includes(rule.operator)) {
    warnings.push(`${location}: unknown operator "${rule.operator}"`);
  }
}

function validateRuleGroupRefs(group: any, knownKeys: Set<string>, location: string, errors: string[], warnings: string[], knownIds = new Set<string>()) {
  const normalized = normalizeRuleGroup(group);
  if (!normalized?.rules?.length) return;

  normalized.rules.forEach((rule: any, index: number) => {
    validateRuleRefs(rule, knownKeys, `${location} rule ${index + 1}`, errors, warnings, knownIds);
  });
}

export function detectCircularVisibility(fieldsInTab: any[]) {
  const graph = new Map<string, string[]>();

  fieldsInTab.forEach(({ field }) => {
    const group = normalizeRuleGroup(field.dependencies?.visibleWhen);
    if (!group?.rules?.length || !field.key) return;

    const deps = group.rules
      .filter((r: any) => (r.source || 'dealCenter') === 'state' && r.field)
      .map((r: any) => r.field);

    if (deps.length) graph.set(field.key, deps);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[] = [];

  function dfs(node: string, path: string[]) {
    if (visiting.has(node)) {
      cycles.push([...path, node].join(' → '));
      return;
    }
    if (visited.has(node)) return;

    visiting.add(node);
    (graph.get(node) || []).forEach((next) => dfs(next, [...path, node]));
    visiting.delete(node);
    visited.add(node);
  }

  graph.forEach((_deps, node) => {
    if (!visited.has(node)) dfs(node, []);
  });

  return cycles;
}

function validateAllocationFieldRefs(field: any, knownKeys: Set<string>, knownIds: Set<string>, location: string, errors: string[], warnings: string[], knownFieldsByKey = new Map<string, any>()) {
  const metrics = normalizeAllocationMetrics(field);
  const metricIds = new Set(metrics.map((metric: any) => metric.id).filter(Boolean));

  const hasBudget = metrics.some((metric: any) => metric.role === 'budget');
  const hasBalance = metrics.some(
    (metric: any) => metric.role === 'balance' || metric.valueSource?.type === 'computed'
  );

  if (!hasBudget) {
    warnings.push(`${location}: allocation card has no budget metric (role: budget)`);
  }

  if (!hasBalance) {
    warnings.push(`${location}: allocation card has no balance metric for status messages`);
  }

  metrics.forEach((metric: any, metricIndex: number) => {
    const metricLoc = `${location} › metric ${metricIndex + 1} (${metric.label || metric.id})`;
    const valueSource = metric.valueSource || {};

    if (valueSource.type === 'state' && valueSource.fieldKey && !knownKeys.has(valueSource.fieldKey)) {
      errors.push(`${metricLoc}: references unknown field "${valueSource.fieldKey}"`);
    }

    if (valueSource.type === 'computed') {
      (valueSource.operands || []).forEach((operandId: string) => {
        if (operandId && !metricIds.has(operandId)) {
          errors.push(`${metricLoc}: computed operand "${operandId}" is not a metric on this card`);
        }
      });
    }

    if (valueSource.type === 'contributors') {
      (valueSource.contributors || []).forEach((contributor: any, contributorIndex: number) => {
        const contributorLoc = `${metricLoc} › contributor ${contributorIndex + 1}`;
        validateRuleGroupRefs(contributor.when, knownKeys, `${contributorLoc} when`, errors, warnings, knownIds);

        (contributor.sources || []).forEach((source: any, sourceIndex: number) => {
          const sourceLoc = `${contributorLoc} › source ${sourceIndex + 1}`;

          if (source.source === 'state' && source.fieldKey && !knownKeys.has(source.fieldKey)) {
            errors.push(`${sourceLoc}: references unknown field "${source.fieldKey}"`);
          }

          if (source.source === 'state' && source.aggregate === 'columnSum') {
            const referencedField = knownFieldsByKey.get(source.fieldKey);

            if (referencedField && referencedField.type !== 'locationGrid') {
              warnings.push(`${sourceLoc}: column sum is only supported for location grid fields`);
            }

            if (!source.columnKeys?.length) {
              warnings.push(`${sourceLoc}: column sum requires at least one selected column`);
            } else if (referencedField?.type === 'locationGrid') {
              const validColumnKeys = new Set(
                (resolveLocationGridConfig(referencedField).columns || []).map((col: any) => col.key)
              );

              source.columnKeys.forEach((columnKey: string) => {
                if (!validColumnKeys.has(columnKey)) {
                  warnings.push(
                    `${sourceLoc}: references unknown column "${columnKey}" on field "${source.fieldKey}"`
                  );
                }
              });
            }
          }
        });
      });
    }
  });

  if (field.dependencies?.requiredWhen) {
    warnings.push(`${location}: requiredWhen on allocation fields is not supported`);
  }
}

export function validateDependencies(config: any) {
  const errors: string[] = [];
  const warnings: string[] = [];

  (config?.verticals || []).forEach((vertical: any) => {
    const tabs = vertical.tabs || [];
    const nonSummaryTabs = tabs.filter((t: any) => !t.isSummary);

    if (nonSummaryTabs.length === 0) {
      warnings.push(`${vertical.label || vertical.id}: no non-summary tabs configured`);
    }

    tabs.forEach((tab: any) => {
      const tabFields = collectFieldsFromTab(tab);
      const knownKeys = new Set(tabFields.map((f) => f.key).filter(Boolean));
      const knownIds = new Set(tabFields.map((f) => f.id).filter(Boolean));
      const knownFieldsByKey = new Map<string, any>();
      tabFields.forEach((tabField) => {
        if (tabField.key && !knownFieldsByKey.has(tabField.key)) {
          knownFieldsByKey.set(tabField.key, tabField);
        }
      });
      const keyCounts: Record<string, number> = {};

      tabFields.forEach((field) => {
        if (!field.key) return;
        keyCounts[field.key] = (keyCounts[field.key] || 0) + 1;
      });

      Object.entries(keyCounts).forEach(([key, count]) => {
        if (count > 1) {
          errors.push(`${vertical.label} › ${tab.label}: duplicate field key "${key}"`);
        }
      });

      if (tab.dependencies?.visibility?.when) {
        validateRuleGroupRefs(
          tab.dependencies.visibility.when,
          knownKeys,
          `${vertical.label} › ${tab.label} visibility`,
          errors,
          warnings,
          knownIds
        );
      }

      getTabSections(tab).forEach((section: any) => {
        if (section.dependencies?.visibleWhen) {
          validateRuleGroupRefs(
            section.dependencies.visibleWhen,
            knownKeys,
            `${vertical.label} › ${tab.label} › ${section.label || section.id} visibility`,
            errors,
            warnings,
            knownIds
          );
        }
      });

      tabFields.forEach((field) => {
        const loc = `${vertical.label} › ${tab.label} › ${field.label || field.key || field.id}`;

        if (field.type === 'sectionLabel') {
          if (field.dependencies?.visibleWhen || field.dependencies?.requiredWhen) {
            warnings.push(`${loc}: dependency rules on ${field.type} fields are ignored at runtime`);
          }
        }

        if (field.type === 'accordion' && field.dependencies?.requiredWhen) {
          warnings.push(`${loc}: requiredWhen on accordion fields is not supported`);
        }

        if (field.type === 'accordion' && isAccordionSelfReferentialVisibility(field, field.dependencies?.visibleWhen)) {
          warnings.push(
            `${loc}: visibleWhen references fields inside this accordion — accordion stays visible; header badge shows allocation status instead`
          );
        }

        if (field.type === 'allocation') {
          validateAllocationFieldRefs(field, knownKeys, knownIds, loc, errors, warnings, knownFieldsByKey);
        }

        validateRuleGroupRefs(field.dependencies?.visibleWhen, knownKeys, `${loc} visibleWhen`, errors, warnings, knownIds);
        validateRuleGroupRefs(field.dependencies?.requiredWhen, knownKeys, `${loc} requiredWhen`, errors, warnings, knownIds);
        if (field.type === 'locationGrid' && field.gridConfig?.columns) {
          field.gridConfig.columns.forEach((col: any, colIndex: number) => {
            if (col.visibleWhen) {
              validateRuleGroupRefs(
                col.visibleWhen,
                knownKeys,
                `${loc} › column ${colIndex + 1} (${col.label || col.key}) visibleWhen`,
                errors,
                warnings
              );
            }
          });
        }

        if (
          (field.type === 'toggle' || field.type === 'optionList') &&
          field.optionVisibility
        ) {
          Object.entries(field.optionVisibility).forEach(([option, ruleGroup]) => {
            if (ruleGroup) {
              validateRuleGroupRefs(
                ruleGroup,
                knownKeys,
                `${loc} › option "${option}" visibleWhen`,
                errors,
                warnings
              );
            }
          });
        }

        validateRuleGroupRefs(field.dependencies?.visibleWhen, knownKeys, `${loc} visibleWhen`, errors, warnings);
        validateRuleGroupRefs(field.dependencies?.requiredWhen, knownKeys, `${loc} requiredWhen`, errors, warnings);

        if (field.type === 'dropdown' && field.optionShowFields) {
          Object.entries(field.optionShowFields).forEach(([option, fieldIds]) => {
            (fieldIds as string[]).forEach((fieldId) => {
              if (!knownIds.has(fieldId)) {
                errors.push(
                  `${loc}: option "${option}" references unknown field id "${fieldId}"`
                );
              }
            });
          });
        }
      });

      const cycles = detectCircularVisibility(
        tabFields.filter((f) => f.key).map((field) => ({ field }))
      );
      cycles.forEach((cycle) => {
        errors.push(`${vertical.label} › ${tab.label}: circular visibleWhen chain (${cycle})`);
      });
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function migrateConfigDependencies(config: any, verticalId = 'gutters-roofline') {
  if (!config) return config;

  const GUTTER_DC_FIELDS = [
    'downspoutFootage',
    'modifyHeight',
    'wedges',
    'straps',
    'groundSpout',
    'replaceCorner',
    'extendedSplashGuard',
    'extendedSplashGuard032',
    'gutter5DsE',
    'gutter6Ft1',
    'gutter6Ft2',
    'gutter6Ft3',
    'gutter7DsE',
  ];

  const LF_DC_FIELDS = [
    'csr',
    'cornersFilter',
    'sawzallHanger',
    'removeProtection',
    'ribbedRoof',
    'versaMaxFt1',
    'versaMaxFt2',
    'versaMaxFt3',
    'versa6Ft1',
    'versa6Ft2',
    'versa6Ft3',
    'versa7Ft1',
    'versa7Ft2',
    'versa7Ft3',
    'filter45Ft1',
    'filter45Ft2',
    'filter45Ft3',
  ];

  const SUGGESTED_TAB_RULES: Record<string, string[]> = {
    gutter: GUTTER_DC_FIELDS,
    guard: LF_DC_FIELDS,
    leaffilter: LF_DC_FIELDS,
  };

  const next = JSON.parse(JSON.stringify(config));

  (next.verticals || []).forEach((vertical: any) => {
    if (verticalId && vertical.id !== verticalId && vertical.productId !== verticalId) return;

    (vertical.tabs || []).forEach((tab: any) => {
      if (tab.dependencies?.visibility?.when?.rules?.length) return;

      const fields = SUGGESTED_TAB_RULES[tab.id];
      if (!fields) return;

      tab.dependencies = {
        ...(tab.dependencies || {}),
        visibility: {
          when: {
            match: 'any',
            rules: [
              {
                source: 'dealCenter',
                fields,
                operator: 'anyNonZero',
              },
            ],
          },
        },
      };
    });
  });

  return next;
}
