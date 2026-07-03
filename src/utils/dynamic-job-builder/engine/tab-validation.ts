import {
  getTabSections,
  getFlattenedCombinationSectionRowFields,
  flattenLeafFields,
} from './combination-utils';
import { isContainerFieldType } from '../constants/field-types';
import { isFieldVisible } from './dependency-engine';
import { computeGridTotal } from './allocation-utils';
import { isRequiredFieldValueMissing } from './field-value-utils';

export function isFieldValueComplete(field: any, state: any, ctx: any = {}) {
  const value = state?.[field.id];
  if (!isRequiredFieldValueMissing(field, value)) return true;

  return !isFieldRequired(field, state, ctx);
}

function isFieldRequired(field: any, state: any, ctx: any) {
  if (field?.required) return true;
  const requiredWhen = field?.dependencies?.requiredWhen;
  if (!requiredWhen) return false;
  const { evaluateRuleGroup } = require('./dependency-engine');
  return evaluateRuleGroup(requiredWhen, { dealCenterData: ctx.dealCenterData || {}, state });
}

function isCombinationIncomplete(section: any, combo: any, ctx: any = {}) {
  const rowFields = getFlattenedCombinationSectionRowFields(section);
  return rowFields.some((field) => {
    if (field.type === 'sectionLabel' || field.type === 'allocation') return false;
    if (field.type === 'locationGrid') {
      const grid = combo[field.id];
      return !grid || computeGridTotal(grid) === 0;
    }
    return isRequiredFieldValueMissing(field, combo[field.id]);
  });
}

function validateFieldTree(fields: any[], state: any, ctx: any) {
  return fields.every((field) => {
    if (isContainerFieldType(field.type) && field.fields?.length) {
      return validateFieldTree(field.fields, state, ctx);
    }
    return isFieldValueComplete(field, state, ctx);
  });
}

function validateSimpleSection(section: any, tabState: any, ctx: any) {
  const sectionState = tabState?.sectionFields?.[section.id] || {};
  return validateFieldTree(section.fields || [], sectionState, ctx);
}

function validateCombinationSection(section: any, tabState: any, ctx: any) {
  const combos =
    tabState?.comboGroups?.[section.id]?.combinations ||
    (section.id === 'default' ? tabState?.combinations : null) ||
    [];

  if (!combos.length) return false;
  return combos.every((combo) => !isCombinationIncomplete(section, combo, ctx));
}

function isAllocationComplete(field: any, tabState: any, ctx: any) {
  if (field.type !== 'allocation') return true;
  const { resolveAllocationMetrics } = require('./allocation-value-resolver');
  const resolved = resolveAllocationMetrics(field, {
    field,
    tabState,
    tab: ctx.tab,
    section: ctx.section,
    sectionState: ctx.sectionState,
    combos: ctx.combos,
    fields: ctx.fields,
    fieldIndex: ctx.fieldIndex,
    dealCenterData: ctx.dealCenterData || {},
  });
  const tolerance = Number(field?.statusMessages?.tolerance) || 0.1;
  return Math.abs(resolved.remaining) <= tolerance;
}

export function isTabComplete(tab: any, tabState: any, ctx: any = {}) {
  const sections = getTabSections(tab);
  if (!sections.length) return true;

  return sections.every((section) => {
    if (section.sectionType === 'simple') {
      return validateSimpleSection(section, tabState, ctx);
    }
    return validateCombinationSection(section, tabState, ctx);
  });
}
