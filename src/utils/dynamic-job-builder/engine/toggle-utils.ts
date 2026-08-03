// Uses the canonical rule evaluator (matches web toggle-utils.js). The
// dependency-engine <-> toggle-utils relationship is not circular; even the
// grid cycle web has is safe because the binding is only called at runtime.
import { evaluateRuleGroup } from './dependency-engine';

export function filterVisibleToggleOptions(field: any = {}, dealCenterData: any = {}, state: any = {}, applyConditions = true) {
  const options = field.options || [];
  const visibilityMap = field.optionVisibility || {};

  if (!applyConditions) return options;
  if (!Object.keys(visibilityMap).length) return options;

  return options.filter((opt: string) => {
    const condition = visibilityMap[opt];
    if (!condition) return true;
    return evaluateRuleGroup(condition, { dealCenterData, state });
  });
}

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
