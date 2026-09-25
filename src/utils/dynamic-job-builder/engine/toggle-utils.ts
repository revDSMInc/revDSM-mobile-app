// Uses the canonical rule evaluator (matches web toggle-utils.js). The
// dependency-engine <-> toggle-utils relationship is not circular; even the
// grid cycle web has is safe because the binding is only called at runtime.
import { evaluateRuleGroup, buildRuleEvaluationContext } from './dependency-engine';
import { getEffectiveDropdownOptions } from './dropdown-utils';

/**
 * The option list an option-bearing field starts from, BEFORE visibility rules.
 *
 * Ticket 1063: for a `dropdown` this is `getEffectiveDropdownOptions`, which
 * returns the KEYS of `optionShowFields` when the field is in dependency mode —
 * `field.options` is stale for those fields, so reading it directly offered the
 * rep options the config had already moved on from.
 *
 * `select` is included because `DynamicTabRenderer` renders it through the SAME
 * `case 'dropdown': case 'select':` branch, which previously called
 * `getEffectiveDropdownOptions` unconditionally — gating on `'dropdown'` alone
 * would silently drop `optionShowFields` support for a `select`. toggle /
 * optionList are deliberately NOT included: `optionShowFields` is a dropdown-only
 * concept there (`isVisibleByDropdownMapping`, `collectDropdownControlledFieldIds`).
 */
export function getBaseFieldOptions(field: any = {}) {
  if (field?.type === 'dropdown' || field?.type === 'select') {
    return getEffectiveDropdownOptions(field);
  }
  return field?.options || [];
}

/**
 * Per-option `Show when` filtering for toggle / optionList / dropdown.
 *
 * ⚠️ The 2nd argument is the FULL rule context (`{ dealCenterData, tab, tabState,
 * section, sectionState, combos, sections, sectionFields }`) — NOT `dealCenterData`.
 * An `optionVisibility` entry is an ordinary rule group: given only
 * `{ dealCenterData, state }` it cannot resolve a field by KEY, reach another
 * section, or read an allocation metric, so every such reference evaluates to
 * `undefined`, reads as "rule not met", and the option SILENTLY DISAPPEARS.
 * Passing `dealCenterData` still type-checks (`any`) and still "works" for
 * same-section rules, which is exactly how that bug stayed invisible.
 */
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

/** Web-parity alias kept so existing toggle/optionList call sites read the same. */
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
