import { isContainerFieldType, migrateConfigColorFields } from '../constants/field-types';
import { getDealCenterDataValue, sumDealCenterRefs } from './deal-center-field-utils';

export function flattenLeafFields(fields: any[] = []): any[] {
  const result: any[] = [];

  (fields || []).forEach((field) => {
    if (isContainerFieldType(field?.type) && field.fields?.length) {
      result.push(...flattenLeafFields(field.fields));
      return;
    }
    if (field?.id) result.push(field);
  });

  return result;
}

function resolveFieldDealCenterValue(field: any, dealCenterData: any = {}) {
  const dcFields = field.dcFields?.length ? field.dcFields : field.dcField ? [field.dcField] : [];
  if (!dcFields.length || !dealCenterData || !Object.keys(dealCenterData).length) {
    return undefined;
  }

  if (dcFields.length > 1) {
    return sumDealCenterRefs(dealCenterData, dcFields, field.dcAggregate || 'sum');
  }

  return getDealCenterDataValue(dealCenterData, dcFields[0]);
}

function isLockedField(field: any) {
  return Boolean(field?.locked) || field?.type === 'locked';
}

export function buildDefaultItemFromFields(fields: any[] = [], existing: any = {}, dealCenterData: any = {}) {
  const item = { ...(existing || {}) };

  flattenLeafFields(fields).forEach((field) => {
    if (field.key && field.key.startsWith('_')) return;

    // Web parity: toggle/optionList always seed empty, even when locked with a
    // dcValue — this block must come before the locked/dcValue check below.
    if (field.type === 'toggle' || field.type === 'optionList') {
      item[field.id] = field.multiSelect ? [] : '';
      return;
    }

    const dcValue = resolveFieldDealCenterValue(field, dealCenterData);
    if (isLockedField(field) && dcValue !== undefined) {
      item[field.id] = dcValue;
      return;
    }

    if (item[field.id] !== undefined) return;

    if (dcValue !== undefined) {
      item[field.id] = dcValue;
      return;
    }

    if (field.type === 'locationGrid') {
      item[field.id] = null;
    } else if (field.type === 'roomPicker') {
      item[field.id] = [];
    } else if (field.type === 'text' && field.defaultValue) {
      item[field.id] = field.defaultValue;
    } else {
      item[field.id] = '';
    }
  });

  return item;
}

export function createEmptySection(overrides: any = {}) {
  return {
    id: `section_${Date.now()}`,
    label: 'Section',
    sectionType: 'combination',
    defaultItem: {},
    fields: [],
    dependencies: {},
    bordered: true,
    allowMultipleCombinations: true,
    ...overrides,
  };
}

export function createEmptyCombinationGroup(overrides: any = {}) {
  return createEmptySection(overrides);
}

function normalizeSection(section: any) {
  const sectionType = section.sectionType || 'combination';
  const rowFields =
    sectionType === 'simple'
      ? section.fields || []
      : getFlattenedCombinationSectionRowFields(section);
  return {
    ...section,
    sectionType,
    defaultItem:
      sectionType === 'simple'
        ? {}
        : buildDefaultItemFromFields(rowFields, section.defaultItem),
  };
}

export function isSectionScopedCombinationField(field: any) {
  return field?.combinationScope === 'section';
}

function isCombinationRowField(field: any) {
  return (
    field.type !== 'allocation' &&
    field.type !== 'combinationSummary' &&
    field.type !== 'sectionLabel' &&
    !isSectionScopedCombinationField(field)
  );
}

function flattenCombinationFieldList(fields: any[] = []) {
  return flattenLeafFields(fields);
}

export function getCombinationSectionRowFields(section: any) {
  return (section?.fields || []).filter(isCombinationRowField);
}

export function getFlattenedCombinationSectionRowFields(section: any) {
  return flattenCombinationFieldList(section?.fields || []).filter(isCombinationRowField);
}

export function getCombinationSectionHeaderFields(section: any) {
  return flattenLeafFields(section?.fields || []).filter(
    (field) =>
      field.type !== 'allocation' &&
      field.type !== 'combinationSummary' &&
      isSectionScopedCombinationField(field)
  );
}

export function getSectionScopedToggleFields(section: any) {
  return getCombinationSectionHeaderFields(section).filter((field) => field.type === 'toggle');
}

export function isAffirmativeToggleValue(value: any) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === 'on';
}

export function canAddMoreCombinations(section: any) {
  if (section?.allowMultipleCombinations === false) return false;
  return true;
}

export function getCombinationDisplayNumber(combo: any, index: number, indexOffset = 0) {
  const stored = Number(combo?._combinationNumber);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return indexOffset + index + 1;
}

export function createNextCombinationItem(section: any, combos: any[] = [], indexOffset = 0) {
  return {
    ...buildComboGroupDefaultItem(section),
    _combinationNumber: indexOffset + combos.length + 1,
  };
}

export function buildComboGroupSectionState(section: any, dealCenterData: any = {}) {
  return buildDefaultItemFromFields(getCombinationSectionHeaderFields(section), {}, dealCenterData);
}

export function buildComboGroupDefaultItem(section: any, dealCenterData: any = {}) {
  return buildDefaultItemFromFields(
    getFlattenedCombinationSectionRowFields(section),
    section.defaultItem,
    dealCenterData
  );
}

export function getTabSections(tab: any) {
  if (tab?.sections?.length) {
    return tab.sections.map(normalizeSection);
  }

  if (tab?.combinationGroups?.length) {
    return tab.combinationGroups.map((group: any) =>
      normalizeSection({ ...group, sectionType: group.sectionType || 'combination' })
    );
  }

  if (tab?.combinations?.enabled) {
    return [
      normalizeSection({
        id: tab.combinations.id || 'default',
        label: tab.combinations.label || 'Combinations',
        sectionType: 'combination',
        defaultItem: buildDefaultItemFromFields(
          tab.combinations.fields,
          tab.combinations.defaultItem
        ),
        fields: tab.combinations.fields || [],
      }),
    ];
  }

  return [];
}

export function getCombinationGroups(tab: any) {
  return getTabSections(tab).filter((s: any) => s.sectionType !== 'simple');
}

export function getSimpleSections(tab: any) {
  return getTabSections(tab).filter((s: any) => s.sectionType === 'simple');
}

export function hasCombinationGroups(tab: any) {
  return getCombinationGroups(tab).length > 0;
}

export function hasTabSections(tab: any) {
  return getTabSections(tab).some((s: any) => (s.fields || []).length > 0);
}

export function migrateTabFieldsToSections(tab: any) {
  const tabFields = tab?.fields || [];
  if (!tabFields.length) return tab;

  const existingSections = getTabSections(tab);
  const generalSection = createEmptySection({
    id: `section_general_${tab.id}`,
    label: 'General',
    sectionType: 'simple',
    fields: [...tabFields],
  });
  generalSection.defaultItem = buildDefaultItemFromFields(tabFields, {});

  return syncTabSections({ ...tab, fields: [] }, [generalSection, ...existingSections]);
}

export function migrateConfigTabFields(config: any) {
  if (!config?.verticals?.length) return migrateConfigColorFields(config);

  return migrateConfigColorFields({
    ...config,
    verticals: config.verticals.map((vertical: any) => ({
      ...vertical,
      tabs: (vertical.tabs || []).map((tab: any) => migrateTabFieldsToSections(tab)),
    })),
  });
}

export function syncTabSections(tab: any, sections: any[]) {
  const normalized = (sections || []).map((section) => normalizeSection(section));
  const combinationSections = normalized.filter((s) => s.sectionType !== 'simple');

  return {
    ...tab,
    sections: normalized,
    combinationGroups: combinationSections,
    combinations: {
      ...(tab.combinations || {}),
      enabled: combinationSections.length > 0,
      label: combinationSections[0]?.label || tab.combinations?.label || 'Combinations',
      defaultItem: combinationSections[0]?.defaultItem || {},
      fields: combinationSections[0]?.fields || [],
    },
  };
}

export function syncTabCombinationGroups(tab: any, combinationGroups: any[]) {
  return syncTabSections(tab, combinationGroups);
}

export function computeGroupUsed(combos: any[] = [], group: any) {
  const rowFields = getFlattenedCombinationSectionRowFields(group);
  const hasGrid = rowFields.some((f: any) => f.type === 'locationGrid');
  if (hasGrid) {
    return combos.reduce((sum: number, combo: any) => {
      const gridField = rowFields.find((f: any) => f.type === 'locationGrid');
      const grid = gridField ? combo[gridField.id] : combo.grid;
      return (
        sum +
        Object.values(grid || {}).reduce(
          (gs: number, stories: any) =>
            gs + Object.values(stories || {}).reduce((ss: number, v: any) => ss + (Number(v) || 0), 0),
          0
        )
      );
    }, 0);
  }

  const sqField = rowFields.find((f: any) => ['sqft', 'sq', 'count'].includes(f.key));
  if (sqField) {
    return combos.reduce((sum: number, combo: any) => sum + (Number(combo[sqField.id]) || 0), 0);
  }

  return 0;
}
