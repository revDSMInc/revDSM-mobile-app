import { isContainerFieldType, migrateConfigColorFields } from '../constants/field-types';
import { getDealCenterDataValue, sumDealCenterRefs } from './deal-center-field-utils';
import { isDefaultValueOptedIn } from './dropdown-utils';

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
    } else if (
      (field.type === 'text' || field.type === 'dropdown') &&
      field.defaultValue &&
      isDefaultValueOptedIn(field)
    ) {
      // Ticket 1063: a `dropdown` seeds its configured default the same way `text`
      // always has. Deliberately CONDITION-BLIND — this file must not import the
      // dependency engine, so `dependencies.defaultWhen` is NOT consulted here; the
      // gate is applied at hydrate time (`dynamic-job-state-storage.hydrateFieldValue`)
      // and at render time (`DropdownField`). `isDefaultValueOptedIn` is only a flag
      // read, not a rule, so it is safe here — and it is what stops a
      // `useDefaultValue: false` config from seeding a leftover `defaultValue`.
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
  // Never below the highest chip already on screen: a stale stored number (from a
  // saved draft) would otherwise hand the new combination a number that is taken.
  const highest = combos.reduce(
    (max: number, combo: any, idx: number) =>
      Math.max(max, getCombinationDisplayNumber(combo, idx, indexOffset)),
    indexOffset
  );
  return {
    ...buildComboGroupDefaultItem(section),
    _combinationNumber: Math.max(indexOffset + combos.length, highest) + 1,
  };
}

/**
 * The first combination of a section is its PARENT: hydration seeds exactly one per
 * section (locked from the Job Summary), and everything after it was added by the rep.
 * The parent cannot be removed.
 *
 * `firstShownIndex` — in My Deals an unfinished saved combination can be hidden, so
 * the parent is the first combination actually SHOWN. 0 everywhere else.
 */
export function isParentCombination(index: number, firstShownIndex = 0) {
  return index === firstShownIndex;
}

/**
 * The combinations a combination section renders — its `comboGroups` list, the legacy
 * tab-level `combinations` for the `default` section, else the one unsaved default item.
 * Mirrors `getSectionCombos` in `DynamicTabRenderer.tsx`.
 */
export function getRenderedSectionCombos(section: any, tabState: any = {}) {
  const fromGroups = tabState?.comboGroups?.[section.id]?.combinations;
  if (fromGroups?.length) return fromGroups;
  if (section.id === 'default' && tabState?.combinations?.length) return tabState.combinations;
  return [{ ...(section.defaultItem || {}) }];
}

/**
 * Renumber every combination of a tab 1..N, in the order the sections render.
 *
 * Numbering runs ACROSS sections (LeafFilter's 6" section holds #1, its 7" section
 * #2, …). Each section used to number only from its own count, so adding to the 7"
 * section first (#3) and then to the 6" one handed out #2 a second time — the 7"
 * section's stored numbers were never shifted. Running this after every change keeps
 * the stored `_combinationNumber` (read by the summary, logs and diff) in step with
 * what is on screen.
 *
 * `sections` must be the combination sections actually rendered, in order. A section
 * with nothing saved yet still counts its one default combination, which is not
 * written into state (it has no stored number and displays by position).
 *
 * `isShown(combo, section)` — My Deals hides unfinished saved combinations; those
 * are skipped (keep their stored number, take no slot) so the visible chips run
 * 1..N with no gap. Defaults to counting every combination.
 */
export function renumberTabCombinations(
  sections: any[] = [],
  tabState: any = {},
  isShown: (combo: any, section: any) => boolean = () => true
) {
  let next = tabState;
  let number = 0;
  sections.forEach((section: any) => {
    const saved = tabState?.comboGroups?.[section.id]?.combinations;
    const legacy = !saved?.length && section.id === 'default' && tabState?.combinations?.length;
    const combos = getRenderedSectionCombos(section, tabState);
    if (!saved?.length && !legacy) {
      number += combos.filter((combo: any) => isShown(combo, section)).length;
      return;
    }
    let changed = false;
    const renumbered = combos.map((combo: any) => {
      if (!isShown(combo, section)) return combo;
      number += 1;
      if (combo?._combinationNumber === number) return combo;
      changed = true;
      return { ...combo, _combinationNumber: number };
    });
    if (!changed) return;
    next = legacy
      ? { ...next, combinations: renumbered }
      : {
          ...next,
          comboGroups: {
            ...(next.comboGroups || {}),
            [section.id]: { ...(next.comboGroups?.[section.id] || {}), combinations: renumbered },
          },
        };
  });
  return next;
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
  // rowFields is already flattened, so grid/number inputs nested inside a stack
  // or accordion are included — allocation tracking works regardless of how the
  // combination fields are grouped in the config.
  const rowFields = getFlattenedCombinationSectionRowFields(group);

  // Measurement grids define the consumed quantity when present. Sum only the
  // grids and ignore sibling numbers (e.g. miters / end-caps) so add-on inputs
  // that share the combination aren't double-counted against the allocation.
  const gridFields = rowFields.filter((f: any) => f.type === 'locationGrid');
  if (gridFields.length) {
    return combos.reduce(
      (sum: number, combo: any) =>
        sum +
        gridFields.reduce((gridSum: number, gf: any) => {
          // The grid may be stored under the field id, its `key`, or the legacy
          // `grid` slot — a grid that resolves `undefined` reads as 0 used, which
          // is what silently froze the price when footage changed.
          const grid = combo[gf.id] ?? (gf.key ? combo[gf.key] : undefined) ?? combo.grid;
          return (
            gridSum +
            Object.values(grid || {}).reduce(
              (gs: number, stories: any) =>
                gs +
                Object.values(stories || {}).reduce((ss: number, v: any) => ss + (Number(v) || 0), 0),
              0
            )
          );
        }, 0),
      0
    );
  }

  // No grid: the consumed quantity is the sum of every numeric input in the
  // combination. Config-driven — does NOT rely on specific field keys, so any
  // tab's allocation (sqft, linear feet, units, custom names…) tracks correctly.
  const numberFields = rowFields.filter((f: any) => f.type === 'number');
  if (numberFields.length) {
    return combos.reduce(
      (sum: number, combo: any) =>
        sum +
        numberFields.reduce(
          (ns: number, nf: any) =>
            ns + (Number(combo[nf.id] ?? (nf.key ? combo[nf.key] : undefined)) || 0),
          0
        ),
      0
    );
  }

  return 0;
}
