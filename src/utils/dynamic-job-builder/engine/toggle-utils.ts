import { evaluateRuleGroup, buildRuleEvaluationContext } from './dependency-engine';
import { getEffectiveDropdownOptions } from './dropdown-utils';

export function getBaseFieldOptions(field: any = {}) {
  if (field?.type === 'dropdown' || field?.type === 'select') {
    return getEffectiveDropdownOptions(field);
  }
  return field?.options || [];
}

export function getVisibleFieldOptions(field: any = {}, ctx: any = {}, state: any = {}, applyConditions = true) {
  const options = getBaseFieldOptions(field);
  const visibilityMap = field?.optionVisibility || {};

  if (!applyConditions) return options;
  if (!Object.keys(visibilityMap).length) return options;

  const ruleCtx = buildRuleEvaluationContext(ctx, state);

  return options.filter((opt: string) => {
    const condition = visibilityMap[opt];
    if (!condition) return true;
    return evaluateRuleGroup(condition, ruleCtx);
  });
}

export const filterVisibleToggleOptions = getVisibleFieldOptions;

export function pruneOptionVisibility(optionVisibility: any = {}, options: string[] = []) {
  const optionSet = new Set(options);
  let changed = false;
  const pruned: any = {};

  Object.entries(optionVisibility).forEach(([key, value]) => {
    if (optionSet.has(key)) {
      pruned[key] = value;
    } else {
      changed = true;
    }
  });

  return changed ? pruned : optionVisibility;
}
