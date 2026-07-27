import {
  getTabSections,
  getCombinationSectionHeaderFields,
  getCombinationSectionRowFields,
  buildComboGroupSectionState,
} from './combination-utils';
import { isAllocationField, computeGridTotal } from './allocation-utils';
import {
  buildAllocationStatus,
  isAllocationCardActive,
  normalizeAllocationStatusMessages,
} from './allocation-config-utils';
import { resolveAllocationMetrics } from './allocation-value-resolver';
import { resolveAccordionAllocationStatus } from './accordion-allocation-utils';
import {
  evaluateRuleGroup,
  isAllocationExcluded,
  isDefaultColorActive,
  isFieldRequired,
  isFieldVisibleWithConditions,
} from './dependency-engine';
import { filterVisibleToggleOptions } from './toggle-utils';
import { isRequiredFieldValueMissing } from './field-value-utils';
import { getWarningConfig } from './field-layout-utils';

// Ported to full web parity. Previously this file was a heavily stripped
// reimplementation that omitted section-visibility gating, per-field visibleWhen
// skipping, allocation-balance gating, toggle option-visibility skipping and
// warningConfig blocking — so tabs (esp. gutter/leaffilter) could report complete
// while allocations were unbalanced or conditionally-hidden fields were empty.
// Web ref: src/components/dynamic-job-builder/engine/tab-validation.js

const SKIPPED_FIELD_TYPES = new Set([
  'locked',
  'lockedWithColor',
  'allocation',
  'combinationSummary',
  'sectionLabel',
]);

// mobile bridge: web sources these from field-blocks-renderer.js (absent here).
// getCombinationSectionComboFields === getCombinationSectionRowFields; and the
// section allocation set is the section's top-level allocation fields — their
// visibility/exclusion gating happens inside isAllocationComplete below.
const getCombinationSectionComboFields = (section: any) => getCombinationSectionRowFields(section);
const getCombinationSectionAllocations = (section: any) =>
  (section?.fields || []).filter(isAllocationField);

function buildFlatTabState(tabState: any, tab: any) {
  const state: any = {};
  const sections = getTabSections(tab);
  sections.forEach((s: any) => {
    if (s.sectionType === 'simple') {
      const sectionState = tabState?.sectionFields?.[s.id] || {};
      Object.keys(sectionState).forEach((key) => {
        if (key !== 'colorValues') state[key] = sectionState[key];
      });
    } else {
      const combos = tabState?.comboGroups?.[s.id]?.combinations || [];
      if (combos.length > 0) {
        Object.keys(combos[0]).forEach((key) => {
          if (key !== 'colorValues') state[key] = combos[0][key];
        });
      }
    }
  });
  return state;
}

function isSectionVisible(section: any, tabState: any, dealCenterData: any, tab: any) {
  const visibleWhen = section?.dependencies?.visibleWhen;
  if (!visibleWhen) return true;
  const state = buildFlatTabState(tabState, tab);
  return evaluateRuleGroup(visibleWhen, {
    dealCenterData: dealCenterData || {},
    state,
    tab,
    tabState,
    section,
  });
}

function buildInitialSectionState(section: any) {
  const state: any = { colorValues: {} };
  (section.fields || []).forEach((field: any) => {
    if (!field.id || (field.key && field.key.startsWith('_'))) return;
    if (field.type === 'locationGrid') state[field.id] = null;
    else if (field.type === 'roomPicker') state[field.id] = [];
    else state[field.id] = '';
  });
  return state;
}

function getSectionCombos(section: any, tabState: any) {
  const fromGroups = tabState?.comboGroups?.[section.id]?.combinations;
  if (fromGroups?.length) return fromGroups;

  if (section.id === 'default' && tabState?.combinations?.length) {
    return tabState.combinations;
  }

  return [{ ...(section.defaultItem || {}) }];
}

function resolveFieldStateValue(field: any, state: any, colorValues: any = {}) {
  const byId = state?.[field.id];
  if (byId !== undefined && byId !== null && byId !== '') return byId;

  if (field.key) {
    const byKey = state?.[field.key];
    if (byKey !== undefined && byKey !== null && byKey !== '') return byKey;
    const colorByKey = colorValues?.[field.key];
    if (colorByKey) return colorByKey;
  }

  const colorById = colorValues?.[field.id];
  if (colorById) return colorById;

  return byId;
}

function isStackWarningActive(field: any, state: any, ctx: any = {}) {
  const warning = getWarningConfig(field);
  if (!warning) return false;

  if (!warning.visibleWhen) return true;

  return evaluateRuleGroup(warning.visibleWhen, {
    dealCenterData: ctx.dealCenterData || {},
    state,
    tab: ctx.tab,
    tabState: ctx.tabState,
    section: ctx.section,
  });
}

function isEmptyRequiredValue(field: any, state: any, colorValues: any = {}, depCtx: any = {}) {
  const value = resolveFieldStateValue(field, state, colorValues);

  switch (field.type) {
    case 'text':
    case 'toggle':
    case 'optionList':
    case 'dropdown':
    case 'textarea':
      return !value;
    case 'number':
      // Field-aware: a required number of 0 is missing EXCEPT for miters/end caps,
      // where an explicitly-entered 0 is a valid count (blank still blocks). Same
      // helper the render warning uses, so the `*`/banner and the gate agree.
      return isRequiredFieldValueMissing(field, value);
    case 'roomPicker':
      return !Array.isArray(value) || value.length === 0;
    case 'swatch':
    case 'colorSelection': {
      // Web parity: a field with a configured (active) default color counts as
      // filled even when the rep hasn't tapped a swatch yet — otherwise required
      // gutter/leaffilter color swatches with a default block the tab forever.
      if (value) return false;
      return !isDefaultColorActive(field, state, depCtx);
    }
    case 'inputWithColor': {
      const inputType = field.inputType || 'text';
      const hasUsage = inputType === 'number' ? parseFloat(value) > 0 : Boolean(value);
      if (!hasUsage) return false;
      const colorKey = field.colorKey || 'color';
      const color = colorValues?.[colorKey] || state?.[colorKey] || '';
      return !color;
    }
    case 'locationGrid':
      return !value || Object.keys(value).length === 0 || computeGridTotal(value) === 0;
    default:
      return false;
  }
}

function buildDepCtx(ctx: any, state: any) {
  return {
    dealCenterData: ctx.dealCenterData,
    sectionFields: ctx.sectionFields,
    tab: ctx.tab,
    tabState: ctx.tabState,
    section: ctx.section,
    sectionState: ctx.sectionState ?? state,
    combos: ctx.combos,
  };
}

export function isFieldValueComplete(field: any, state: any, ctx: any = {}) {
  if (SKIPPED_FIELD_TYPES.has(field.type)) return true;

  const { applyConditions = true, dealCenterData, colorValues = {} } = ctx;
  const depCtx = buildDepCtx(ctx, state);

  if (applyConditions && !isFieldVisibleWithConditions(field, state, depCtx, applyConditions)) {
    return true;
  }

  if (field.type === 'toggle' || field.type === 'optionList') {
    const visibleOptions = filterVisibleToggleOptions(field, dealCenterData, state, applyConditions);
    if (!visibleOptions.length) {
      return true;
    }
  }

  if (!isFieldRequired(field, state, depCtx)) {
    return true;
  }

  const effectiveColorValues = colorValues || state?.colorValues || {};
  const empty = isEmptyRequiredValue(field, state, effectiveColorValues, depCtx);
  if (empty && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(
      `[TabCheck] required field "${field?.label || field?.id}" (type=${field?.type}) blocks completion: value is empty` +
        (field?.type === 'number' ? ' (note: a required number of 0 counts as empty, except miters/end caps where a typed 0 is valid).' : '.')
    );
  }
  return !empty;
}

function validateFieldTree(field: any, state: any, ctx: any): boolean {
  if (!field) return true;

  if (field.type === 'stack') {
    const { applyConditions = true } = ctx;
    const depCtx = buildDepCtx(ctx, state);

    if (applyConditions && !isFieldVisibleWithConditions(field, state, depCtx, applyConditions)) {
      return true;
    }

    if (isStackWarningActive(field, state, ctx)) {
      return false;
    }

    const children = field.fields || [];
    return children.every((child: any) => validateFieldTree(child, state, ctx));
  }

  if (field.type === 'accordion') {
    const { applyConditions = true } = ctx;
    const depCtx = buildDepCtx(ctx, state);

    if (applyConditions && !isFieldVisibleWithConditions(field, state, depCtx, applyConditions)) {
      return true;
    }

    const children = field.fields || [];
    const allChildrenValid = children.every((child: any) => validateFieldTree(child, state, ctx));
    if (!allChildrenValid) {
      return false;
    }

    const warning = getWarningConfig(field);
    if (warning) {
      const showWarning =
        !warning.visibleWhen ||
        evaluateRuleGroup(warning.visibleWhen, {
          dealCenterData: ctx.dealCenterData || {},
          state: state || ctx.tabState || {},
          tab: ctx.tab,
          tabState: ctx.tabState || {},
          section: ctx.section,
        });
      if (showWarning) {
        return false;
      }
    }

    const badge = resolveAccordionAllocationStatus(field, ctx);
    if (badge && (badge.type === 'warning' || badge.type === 'error')) {
      return false;
    }
    return true;
  }

  if (isAllocationField(field)) {
    return isAllocationComplete(field, ctx);
  }

  return isFieldValueComplete(field, state, ctx);
}

function isAllocationTrackerVisible(field: any, ctx: any = {}) {
  const { tabState, sectionState, dealCenterData = {}, applyConditions = true } = ctx;

  if (isAllocationExcluded(field, dealCenterData)) {
    return false;
  }

  const state = sectionState ?? tabState ?? {};
  const depCtx = buildDepCtx(ctx, state);

  if (applyConditions && !isFieldVisibleWithConditions(field, state, depCtx, applyConditions)) {
    return false;
  }

  return true;
}

function isAllocationComplete(field: any, ctx: any = {}) {
  const { tabState, tab, section, sectionState, combos = [], dealCenterData = {} } = ctx;

  if (!isAllocationTrackerVisible(field, ctx)) {
    return true;
  }

  if (!isAllocationCardActive(field, tabState, tab)) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log(
        `[TabCheck] allocation "${field?.label || field?.id}" blocks completion: card is active but its optionBinding is not satisfied (bound toggle not set / combos empty).`
      );
    }
    return false;
  }

  const statusMessages = normalizeAllocationStatusMessages(field?.statusMessages);
  if (!statusMessages.enabled) return true;

  const fields = ctx.sectionFields || [];
  const fieldIndex = fields.findIndex((f: any) => f.id === field.id);

  const resolved = resolveAllocationMetrics(field, {
    field,
    tabState,
    tab,
    section,
    sectionState,
    combos,
    fields,
    fieldIndex: fieldIndex >= 0 ? fieldIndex : 0,
    dealCenterData,
  });

  const status = buildAllocationStatus(field, resolved.remaining, field.unit || 'ft');
  if (!status) return true;
  const ok = status.type === 'success';
  if (!ok && typeof __DEV__ !== 'undefined' && __DEV__) {
    // Prime suspect for "filled everything but tab won't complete": the budget
    // (available) resolves to 0 because dealCenterData lacks the dcField key(s)
    // this allocation references — so remaining can never reach zero.
    const dcRefs = field?.dcFields?.length ? field.dcFields : field?.dcField ? [field.dcField] : [];
    const dcPresent = dcRefs.filter((k: string) => dealCenterData && dealCenterData[k] !== undefined);
    console.log(
      `[TabCheck] allocation "${field?.label || field?.id}" blocks completion: status=${status.type} ` +
        `available=${resolved.available} used=${resolved.allocated} remaining=${resolved.remaining}. ` +
        `dcField(s)=${JSON.stringify(dcRefs)} present-in-dealCenterData=${JSON.stringify(dcPresent)}` +
        (dcRefs.length && dcPresent.length === 0
          ? ' → BUDGET FELL BACK TO field.avail because none of the dcField keys are in dealCenterData (calculator not filled, or config dcField ≠ calculator field id/name).'
          : '')
    );
  }
  return ok;
}

export function isCombinationIncomplete(section: any, combo: any, ctx: any = {}) {
  const comboFields = getCombinationSectionComboFields(section);
  const fieldCtx = {
    ...ctx,
    section,
    sectionFields: section.fields || [],
    sectionState: combo,
    colorValues: combo?.colorValues || {},
    combos: ctx.combos || [],
  };

  return comboFields.some((field: any) => !validateFieldTree(field, combo, fieldCtx));
}

function validateFieldsList(fields: any[], state: any, ctx: any) {
  return (fields || []).every((field: any) => validateFieldTree(field, state, ctx));
}

function validateSectionAllocations(section: any, _tabState: any, ctx: any) {
  const allocations = getCombinationSectionAllocations(section);

  return allocations.every((field: any) =>
    isAllocationComplete(field, {
      ...ctx,
      section,
      sectionFields: section.fields || [],
    })
  );
}

function validateSimpleSection(section: any, tabState: any, ctx: any) {
  const sectionState = tabState?.sectionFields?.[section.id] || buildInitialSectionState(section);
  const sectionCtx = {
    ...ctx,
    section,
    sectionState,
    sectionFields: section.fields || [],
    colorValues: sectionState.colorValues || {},
    combos: [],
  };

  if (!validateSectionAllocations(section, tabState, sectionCtx)) return false;

  const contentFields = getCombinationSectionComboFields(section);
  if (!validateFieldsList(contentFields, sectionState, sectionCtx)) return false;

  const warning = getWarningConfig(section);
  if (warning) {
    const showWarning =
      !warning.visibleWhen ||
      evaluateRuleGroup(warning.visibleWhen, {
        dealCenterData: ctx.dealCenterData || {},
        state: tabState || {},
        tab: ctx.tab,
        tabState: tabState || {},
        section,
      });
    if (showWarning) {
      return false;
    }
  }

  return true;
}

function validateCombinationSection(section: any, tabState: any, ctx: any) {
  const combos = getSectionCombos(section, tabState);
  const sectionState =
    tabState?.comboGroups?.[section.id]?.sectionState ||
    buildComboGroupSectionState(section, ctx.dealCenterData);
  const sectionCtx = {
    ...ctx,
    section,
    sectionFields: section.fields || [],
    combos,
    sectionState,
    colorValues: sectionState?.colorValues || {},
  };

  if (!validateSectionAllocations(section, tabState, sectionCtx)) return false;

  const headerFields = getCombinationSectionHeaderFields(section);
  if (headerFields.length && !validateFieldsList(headerFields, sectionState, sectionCtx)) {
    return false;
  }

  return combos.every((combo: any) => !isCombinationIncomplete(section, combo, sectionCtx));
}

export function isTabComplete(tab: any, tabState: any = {}, ctx: any = {}) {
  if (!tab || tab.isSummary) {
    return true;
  }

  const sections = getTabSections(tab);
  const tabFields = tab.fields || [];
  const hasTabFields = tabFields.length > 0;
  const hasRenderableSections = sections.some((s: any) => (s.fields || []).length > 0);

  if (!hasTabFields && !hasRenderableSections) return true;

  const validationCtx = {
    dealCenterData: ctx.dealCenterData || {},
    applyConditions: ctx.applyConditions !== false,
    products: ctx.products,
    tab,
    tabState,
  };

  if (hasTabFields) {
    const tabFieldCtx = {
      ...validationCtx,
      section: null,
      sectionState: tabState,
      sectionFields: tabFields,
      colorValues: tabState?.colorValues || {},
      combos: [],
    };

    const tabFieldsValid = tabFields.every((field: any) => {
      if (isAllocationField(field)) {
        return isAllocationComplete(field, tabFieldCtx);
      }
      return validateFieldTree(field, tabState, tabFieldCtx);
    });

    if (!tabFieldsValid) return false;
  }

  return sections.every((section: any) => {
    if (!(section.fields || []).length) {
      return true;
    }
    if (
      validationCtx.applyConditions &&
      !isSectionVisible(section, tabState, validationCtx.dealCenterData, tab)
    ) {
      return true;
    }

    if (section.sectionType === 'simple') {
      return validateSimpleSection(section, tabState, validationCtx);
    }

    return validateCombinationSection(section, tabState, validationCtx);
  });
}
