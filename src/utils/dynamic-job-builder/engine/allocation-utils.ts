import {
  computeGroupUsed,
  getCombinationGroups,
  getTabSections,
  hasCombinationGroups,
} from './combination-utils';
import { getDealCenterDataValue, sumDealCenterRefs } from './deal-center-field-utils';
import { isContainerFieldType } from '../constants/field-types';

export function computeGridTotal(grid: any = {}) {
  if (!grid) return 0;
  return Object.values(grid).reduce(
    (gs: number, stories: any) => gs + Object.values(stories || {}).reduce((ss: number, v: any) => ss + (Number(v) || 0), 0),
    0
  );
}

export function computeComboTotal(combos: any[] = [], key = 'grid') {
  if (key === 'grid') {
    return combos.reduce((s: number, c: any) => s + computeGridTotal(c.grid), 0);
  }
  return combos.reduce((s: number, c: any) => s + (Number(c[key]) || 0), 0);
}

export function isAllocationField(field: any) {
  return field?.type === 'allocation';
}

export function getNonAllocationFields(fields: any[] = []) {
  return (fields || []).filter((f) => !isAllocationField(f));
}

export function splitFieldListIntoBlocks(fields: any[] = []) {
  const blocks: any[] = [];
  let currentFields: any[] = [];

  (fields || []).forEach((field) => {
    if (isAllocationField(field)) {
      if (currentFields.length) {
        blocks.push({ type: 'fields', fields: currentFields });
        currentFields = [];
      }
      blocks.push({ type: 'allocation', field });
    } else {
      currentFields.push(field);
    }
  });

  if (currentFields.length) {
    blocks.push({ type: 'fields', fields: currentFields });
  }

  return blocks;
}

export function collectAllocationFields(tab: any) {
  const allocations: any[] = [];

  (tab?.fields || []).forEach((field: any) => {
    if (isAllocationField(field)) allocations.push(field);
  });

  getTabSections(tab).forEach((section: any) => {
    (section.fields || []).forEach((field: any) => {
      if (isAllocationField(field)) allocations.push(field);
    });
  });

  return allocations;
}

export function tabHasAllocationContent(tab: any) {
  return collectAllocationFields(tab).length > 0;
}

export function computeFieldsUsed(fields: any[] = [], state: any = {}) {
  return (fields || []).reduce((total: number, field: any) => {
    if (isAllocationField(field)) return total;
    if (isContainerFieldType(field.type) && field.fields?.length) {
      return total + computeFieldsUsed(field.fields, state);
    }
    if (field.type === 'number' && state?.[field.id] !== undefined) {
      return total + (Number(state[field.id]) || 0);
    }
    if (field.type === 'locationGrid') {
      return total + computeGridTotal(state?.[field.id]);
    }
    return total;
  }, 0);
}

export function getTabLevelUsed(tabState: any, tabConfig: any) {
  if (hasCombinationGroups(tabConfig)) {
    return getCombinationGroups(tabConfig).reduce((total: number, group: any) => {
      const groupState = tabState?.comboGroups?.[group.id];
      const combos = groupState?.combinations || [];
      return total + computeGroupUsed(combos, group);
    }, 0);
  }

  if (!tabConfig?.combinations?.enabled) {
    return computeFieldsUsed(tabConfig?.fields, tabState);
  }

  const combos = tabState?.combinations || [];
  const hasGrid = tabConfig.combinations.fields?.some((f: any) => f.type === 'locationGrid');
  if (hasGrid) return computeComboTotal(combos, 'grid');

  const sqField = tabConfig.combinations.fields?.find((f: any) =>
    ['sqft', 'sq', 'count'].includes(f.key)
  );
  if (sqField) return computeComboTotal(combos, sqField.key);

  return computeComboTotal(combos, 'grid');
}

export function getAllocationUsed(tabState: any, tabConfig: any) {
  return getTabLevelUsed(tabState, tabConfig);
}

export function getSectionUsed(tabState: any, section: any) {
  if (section.sectionType === 'simple') {
    const sectionState = tabState?.sectionFields?.[section.id];
    return computeFieldsUsed(section.fields, sectionState);
  }

  const combos =
    tabState?.comboGroups?.[section.id]?.combinations ||
    (section.id === 'default' ? tabState?.combinations : null) ||
    [];

  return computeGroupUsed(combos, section);
}

function getFollowingFieldsUsed(fields: any[], fieldIndex: number, state: any) {
  const followingFields: any[] = [];
  for (let i = fieldIndex + 1; i < fields.length; i += 1) {
    if (isAllocationField(fields[i])) break;
    followingFields.push(fields[i]);
  }
  return {
    followingFields,
    used: computeFieldsUsed(followingFields, state),
  };
}

function hasMeasurableFields(fields: any[] = []) {
  return fields.some((field: any) => {
    if (isContainerFieldType(field.type) && field.fields?.length) {
      return hasMeasurableFields(field.fields);
    }
    return field.type === 'number' || field.type === 'locationGrid';
  });
}

export function getAllocationUsedForField(
  _allocationField: any,
  { tabState, tab, section, sectionState, combos, fields, fieldIndex }: any
) {
  const isSectionRootFieldList =
    Boolean(section?.fields && fields && fields === section.fields);

  if (section && section.sectionType !== 'simple' && combos && isSectionRootFieldList) {
    return computeGroupUsed(combos, section);
  }

  if (fields && fieldIndex !== undefined && fieldIndex >= 0) {
    const state = sectionState || tabState;
    const { followingFields, used } = getFollowingFieldsUsed(fields, fieldIndex, state);

    if (hasMeasurableFields(followingFields)) {
      return used;
    }

    if (!section) {
      return getTabLevelUsed(tabState, tab);
    }

    return used;
  }

  return 0;
}

export function isFieldLocked(field: any) {
  return Boolean(field?.locked) || field?.type === 'locked';
}

export function resolveLockedValue(field: any, dealCenterData: any = {}) {
  const dcFields = field.dcFields?.length
    ? field.dcFields
    : field.dcField
      ? [field.dcField]
      : [];

  if (dcFields.length > 1) {
    const aggregate = field.dcAggregate || 'sum';
    const result = sumDealCenterRefs(dealCenterData, dcFields, aggregate);
    if (result !== 0) return result;
    if (dcFields.some((ref: string) => getDealCenterDataValue(dealCenterData, ref) !== undefined)) {
      return result;
    }
    return field.defaultValue ?? '—';
  }

  if (field.dcField) {
    const resolved = getDealCenterDataValue(dealCenterData, field.dcField);
    if (resolved !== undefined) return resolved;
  }
  return field.defaultValue ?? '—';
}

export {
  resolveAllocationAvail,
  getLockedTabIds,
  getPreviewLockedTabIds,
  getFirstUnlockedTabId,
  resolveVerticalLockedTabIds,
} from './dependency-engine';
