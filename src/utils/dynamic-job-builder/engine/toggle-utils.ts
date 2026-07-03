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

function evaluateRuleGroup(group: any, ctx: any = {}) {
  if (!group) return true;
  const rules = group.rules || (group.field || group.fields ? [group] : []);
  if (!rules.length) return true;
  const match = group.match || 'all';
  const results = rules.map((rule: any) => evaluateRule(rule, ctx));
  if (match === 'any') return results.some(Boolean);
  return results.every(Boolean);
}

function evaluateRule(rule: any, ctx: any = {}) {
  if (!rule) return true;
  const operator = rule.operator || 'truthy';
  const operand = rule.value;
  const source = rule.source || 'dealCenter';
  const data = source === 'dealCenter' ? ctx.dealCenterData : ctx.state;
  const fieldValue = data?.[rule.field];

  switch (operator) {
    case 'truthy': return Boolean(fieldValue);
    case 'falsy': return !fieldValue;
    case 'eq': return fieldValue === operand;
    case 'neq': return fieldValue !== operand;
    case 'gt': return Number(fieldValue) > Number(operand);
    case 'gte': return Number(fieldValue) >= Number(operand);
    case 'lt': return Number(fieldValue) < Number(operand);
    case 'lte': return Number(fieldValue) <= Number(operand);
    case 'in': return Array.isArray(operand) && operand.includes(fieldValue);
    case 'notIn': return Array.isArray(operand) && !operand.includes(fieldValue);
    case 'exists': return fieldValue !== undefined && fieldValue !== null;
    default: return Boolean(fieldValue);
  }
}
