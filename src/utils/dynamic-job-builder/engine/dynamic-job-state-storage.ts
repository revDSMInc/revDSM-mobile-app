import {
  buildComboGroupDefaultItem,
  buildComboGroupSectionState,
  buildDefaultItemFromFields,
  getCombinationSectionHeaderFields,
  getFlattenedCombinationSectionRowFields,
  getTabSections,
} from './combination-utils';
import { isFieldLocked, resolveLockedValue } from './allocation-utils';
import { resolveConditionalDefault } from './dependency-engine';
import { buildTabKey } from './product-catalog-utils';
import { isContainerFieldType } from '../constants/field-types';

export const DYNAMIC_JOB_STATE_STORAGE_VERSION = 1;

const ROOT_PASSTHROUGH_KEYS = new Set(['scheduleTime', 'agreements', 'orderSheets']);

function slugifyStorageLabel(label: string) {
  return (label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

export function buildStorageKey(canonicalId: string, slug: string) {
  const safeSlug = slugifyStorageLabel(slug);
  return `${String(canonicalId)}__${safeSlug}`;
}

function assignUniqueSlug(baseSlug: string, usedSlugs: Set<string>) {
  const normalized = slugifyStorageLabel(baseSlug);
  if (!usedSlugs.has(normalized)) {
    usedSlugs.add(normalized);
    return normalized;
  }

  let counter = 2;
  while (usedSlugs.has(`${normalized}-${counter}`)) {
    counter += 1;
  }
  const unique = `${normalized}-${counter}`;
  usedSlugs.add(unique);
  return unique;
}

function resolveFieldSlug(field: any) {
  if (field?.key && !field.key.startsWith('_')) {
    return slugifyStorageLabel(field.key);
  }
  return slugifyStorageLabel(field?.label || 'field');
}

function flattenFields(fields: any[] = []): any[] {
  const result: any[] = [];
  (fields || []).forEach((field) => {
    if (isContainerFieldType(field?.type) && field.fields?.length) {
      result.push(...flattenFields(field.fields));
      return;
    }
    if (field?.id) result.push(field);
  });
  return result;
}

function collectSectionFieldList(section: any) {
  if (!section) return [];
  if (section.sectionType === 'simple') {
    return flattenFields(section.fields || []);
  }
  return [
    ...getCombinationSectionHeaderFields(section),
    ...getFlattenedCombinationSectionRowFields(section),
  ].filter((field) => field?.id && !(field.key && field.key.startsWith('_')));
}

function resolveExistingFieldValue(field: any, source: any = {}) {
  if (!field?.id) return undefined;
  if (source[field.id] !== undefined) return source[field.id];
  if (field.key && source[field.key] !== undefined) return source[field.key];
  return undefined;
}

function resolveExistingColorValue(field: any, colorValues: any = {}, source: any = {}) {
  const colorKey = field?.colorKey || field?.id;
  if (colorValues?.[field.id] !== undefined) return colorValues[field.id];
  if (field.key && colorValues?.[field.key] !== undefined) return colorValues[field.key];
  if (colorKey && colorValues?.[colorKey] !== undefined) return colorValues[colorKey];
  if (source?.[colorKey] !== undefined) return source[colorKey];
  if (field.key && source?.[field.key] !== undefined) return source[field.key];
  return undefined;
}

function hydrateFieldValue(
  field: any,
  existing: any = {},
  colorValues: any = {},
  dealCenterData: any = {},
  preserveExisting = false
) {
  if (!field?.id || (field.key && field.key.startsWith('_'))) return undefined;

  const existingValue = resolveExistingFieldValue(field, existing);

  if (isFieldLocked(field)) {
    // In edit mode the rep can override a locked (calculator-driven) field. Keep
    // their explicit entry instead of re-resolving it from the (often stale)
    // dealCenterData snapshot, which would silently revert the change on save.
    if (preserveExisting && existingValue !== undefined) return existingValue;
    // Pass the conditional default so a NOT-included product (a locked field whose
    // `dependencies.defaultWhen` inclusion condition is not met) resolves to '' — and
    // RETURN that '' so the field is emptied. Emptying is what makes an unbuilt
    // product's combo match the prune's default (`buildComboGroupDefaultItem` seeds a
    // locked optionList/toggle empty too), so the combo is dropped from storage.
    // Treating '' as "blank" and falling through to the existing value instead kept the
    // phantom value (e.g. LeafFilter Profile "Versa") and made the portal render an
    // un-built product (LeafFilter Combination #1-4 though never built).
    // Only a genuinely-unresolvable ref ('—') or undefined falls through — and that is
    // handled below by `if (existingValue !== undefined) return existingValue`, so a
    // real saved value is still never destroyed. Web parity: dynamic-job-state-
    // storage.js hydrateFieldValue (`if (locked !== undefined && locked !== '—')`).
    const locked = resolveLockedValue(field, dealCenterData, {
      fallbackDefault: resolveConditionalDefault(field, existing, { dealCenterData }),
    });
    if (locked !== undefined && locked !== '—') return locked;
  }

  if (existingValue !== undefined) return existingValue;

  const defaults = buildDefaultItemFromFields([field], {}, dealCenterData);
  return defaults[field.id];
}

function hydrateFieldMap(
  fields: any[] = [],
  existing: any = {},
  colorValues: any = {},
  dealCenterData: any = {},
  preserveExisting = false
) {
  const item: any = {};
  const nextColorValues = { ...(colorValues || {}) };

  flattenFields(fields).forEach((field) => {
    if (!field?.id || (field.key && field.key.startsWith('_'))) return;

    const value = hydrateFieldValue(field, existing, nextColorValues, dealCenterData, preserveExisting);
    if (value !== undefined) {
      item[field.id] = value;
    }

    const colorValue = resolveExistingColorValue(field, nextColorValues, existing);
    if (colorValue !== undefined && colorValue !== '') {
      nextColorValues[field.id] = colorValue;
    }
  });

  return { item, colorValues: nextColorValues };
}

function ensureTabStateShape(tabState: any = {}, tab: any, dealCenterData: any = {}, preserveExisting = false) {
  const next: any = {
    colorValues: { ...(tabState.colorValues || {}) },
    sectionFields: { ...(tabState.sectionFields || {}) },
  };

  const sections = getTabSections(tab);
  const combinationSections = sections.filter((section) => section.sectionType !== 'simple');
  const simpleSections = sections.filter((section) => section.sectionType === 'simple');

  if (combinationSections.length) {
    next.comboGroups = { ...(tabState.comboGroups || {}) };
    combinationSections.forEach((section) => {
      const group = tabState.comboGroups?.[section.id] || {};
      const existingCombos = group.combinations?.length
        ? group.combinations
        : [buildComboGroupDefaultItem(section, dealCenterData)];

      const hydratedCombos = existingCombos.map((combo: any) => {
        const rowFields = getFlattenedCombinationSectionRowFields(section);
        const { item, colorValues: comboColors } = hydrateFieldMap(
          rowFields,
          combo,
          combo.colorValues || {},
          dealCenterData,
          preserveExisting
        );
        return {
          ...item,
          ...(Object.keys(comboColors).length ? { colorValues: comboColors } : {}),
          ...(combo._combinationNumber ? { _combinationNumber: combo._combinationNumber } : {}),
        };
      });

      const headerFields = getCombinationSectionHeaderFields(section);
      const { item: sectionState, colorValues: sectionColors } = hydrateFieldMap(
        headerFields,
        group.sectionState || {},
        group.sectionState?.colorValues || {},
        dealCenterData,
        preserveExisting
      );

      next.comboGroups[section.id] = {
        combinations: hydratedCombos,
        sectionState: {
          ...sectionState,
          ...(Object.keys(sectionColors).length ? { colorValues: sectionColors } : {}),
        },
      };
    });
  } else if (tab.combinations?.enabled) {
    const existingCombos = tabState.combinations?.length
      ? tabState.combinations
      : [buildDefaultItemFromFields(tab.combinations.fields, tab.combinations.defaultItem, dealCenterData)];

    next.combinations = existingCombos.map((combo: any) => {
      const { item, colorValues: comboColors } = hydrateFieldMap(
        tab.combinations.fields || [],
        combo,
        combo.colorValues || {},
        dealCenterData,
        preserveExisting
      );
      return {
        ...item,
        ...(Object.keys(comboColors).length ? { colorValues: comboColors } : {}),
        ...(combo._combinationNumber ? { _combinationNumber: combo._combinationNumber } : {}),
      };
    });
  }

  simpleSections.forEach((section) => {
    const existingSection = tabState.sectionFields?.[section.id] || {};
    const { item, colorValues: sectionColors } = hydrateFieldMap(
      section.fields || [],
      existingSection,
      existingSection.colorValues || {},
      dealCenterData,
      preserveExisting
    );

    next.sectionFields[section.id] = {
      ...item,
      ...(Object.keys(sectionColors).length ? { colorValues: sectionColors } : {}),
    };
  });

  const tabLevelColors = hydrateFieldMap(
    flattenFields(tab.fields || []),
    tabState,
    next.colorValues,
    dealCenterData,
    preserveExisting
  );
  next.colorValues = tabLevelColors.colorValues;

  return next;
}

export function hydrateJobStateForPersistence(
  jobState: any = {},
  config: any,
  dealCenterData: any = {},
  preserveExisting = false
) {
  const source = jobState && typeof jobState === 'object' ? jobState : {};
  const hydrated: any = {};

  Object.entries(source).forEach(([key, value]) => {
    if (ROOT_PASSTHROUGH_KEYS.has(key)) {
      hydrated[key] = value;
    }
  });

  (config?.verticals || []).forEach((vertical: any) => {
    const verticalState = source[vertical.id] || {};
    hydrated[vertical.id] = {};

    (vertical.tabs || []).forEach((tab: any) => {
      hydrated[vertical.id][tab.id] = ensureTabStateShape(
        verticalState[tab.id] || {},
        tab,
        dealCenterData,
        preserveExisting
      );
    });
  });

  return hydrated;
}

export function buildConfigStorageIndex(config: any) {
  const verticalToStorage = new Map<string, string>();
  const verticalFromStorage = new Map<string, string>();
  const tabToStorage = new Map<string, string>();
  const tabFromStorage = new Map<string, string>();
  const sectionToStorage = new Map<string, string>();
  const sectionFromStorage = new Map<string, string>();
  const fieldToStorage = new Map<string, string>();
  const fieldFromStorage = new Map<string, string>();

  (config?.verticals || []).forEach((vertical: any) => {
    const verticalId = String(vertical.id);
    const verticalSlugUsed = new Set<string>();
    const verticalSlug = assignUniqueSlug(vertical.label || 'vertical', verticalSlugUsed);
    const verticalStorageKey = buildStorageKey(verticalId, verticalSlug);
    verticalToStorage.set(verticalId, verticalStorageKey);
    verticalFromStorage.set(verticalStorageKey, verticalId);

    (vertical.tabs || []).forEach((tab: any) => {
      const tabId = String(tab.id);
      let tabStorageKey = tabId;

      if (!tabId.includes('__')) {
        const productId = vertical.productId || vertical.id;
        const categoryName = tab.productCategory || tab.label;
        tabStorageKey = categoryName
          ? buildTabKey(productId, categoryName)
          : buildStorageKey(tabId, tab.label || 'tab');
      }

      tabToStorage.set(tabId, tabStorageKey);
      tabFromStorage.set(tabStorageKey, tabId);

      const sectionSlugUsed = new Set<string>();

      getTabSections(tab).forEach((section: any) => {
        const sectionId = String(section.id);
        const sectionSlug = assignUniqueSlug(section.label || 'section', sectionSlugUsed);
        const sectionStorageKey = buildStorageKey(sectionId, sectionSlug);
        sectionToStorage.set(sectionId, sectionStorageKey);
        sectionFromStorage.set(sectionStorageKey, sectionId);

        const fieldSlugUsed = new Set<string>();
        collectSectionFieldList(section).forEach((field) => {
          const fieldId = String(field.id);
          const fieldSlug = assignUniqueSlug(resolveFieldSlug(field), fieldSlugUsed);
          const fieldStorageKey = buildStorageKey(fieldId, fieldSlug);
          fieldToStorage.set(fieldId, fieldStorageKey);
          fieldFromStorage.set(fieldStorageKey, fieldId);
        });
      });

      flattenFields(tab.fields || []).forEach((field) => {
        const fieldId = String(field.id);
        if (fieldToStorage.has(fieldId)) return;
        const fieldStorageKey = buildStorageKey(fieldId, resolveFieldSlug(field));
        fieldToStorage.set(fieldId, fieldStorageKey);
        fieldFromStorage.set(fieldStorageKey, fieldId);
      });

      if (tab.combinations?.enabled) {
        const fieldSlugUsed = new Set<string>();
        flattenFields(tab.combinations.fields || []).forEach((field) => {
          const fieldId = String(field.id);
          if (fieldToStorage.has(fieldId)) return;
          const fieldSlug = assignUniqueSlug(resolveFieldSlug(field), fieldSlugUsed);
          const fieldStorageKey = buildStorageKey(fieldId, fieldSlug);
          fieldToStorage.set(fieldId, fieldStorageKey);
          fieldFromStorage.set(fieldStorageKey, fieldId);
        });
      }
    });
  });

  return {
    verticalToStorage,
    verticalFromStorage,
    tabToStorage,
    tabFromStorage,
    sectionToStorage,
    sectionFromStorage,
    fieldToStorage,
    fieldFromStorage,
  };
}

function remapFieldKeyedObject(obj: any, index: any, { reverse = false } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;

  const fieldMap = reverse ? index.fieldFromStorage : index.fieldToStorage;
  const next: any = {};

  Object.entries(obj).forEach(([key, value]) => {
    if (key === 'colorValues') {
      next.colorValues = remapFieldKeyedObject(value, index, { reverse });
      return;
    }

    const mappedKey = reverse
      ? fieldMap.get(key) || resolveCanonicalKeyFromStorage(key, fieldMap, 'field_')
      : fieldMap.get(key) || key;

    next[mappedKey] = value;
  });

  return next;
}

function resolveCanonicalKeyFromStorage(storageKey: string, reverseMap: Map<string, string>, prefix: string) {
  if (reverseMap.has(storageKey)) {
    return reverseMap.get(storageKey);
  }

  if (!storageKey.includes('__')) {
    return storageKey;
  }

  const canonical = storageKey.split('__')[0];
  if (prefix && canonical.startsWith(prefix)) {
    return canonical;
  }

  return storageKey;
}

function remapTabStateForStorage(tabState: any, index: any) {
  if (!tabState || typeof tabState !== 'object') return tabState;

  const next: any = {};

  if (tabState.colorValues) {
    next.colorValues = remapFieldKeyedObject(tabState.colorValues, index);
  }

  if (tabState.sectionFields) {
    next.sectionFields = {};
    Object.entries(tabState.sectionFields).forEach(([sectionId, sectionState]) => {
      const storageSectionKey = index.sectionToStorage.get(sectionId) || sectionId;
      next.sectionFields[storageSectionKey] = remapFieldKeyedObject(sectionState, index);
    });
  }

  if (tabState.comboGroups) {
    next.comboGroups = {};
    Object.entries(tabState.comboGroups).forEach(([sectionId, group]: [string, any]) => {
      const storageSectionKey = index.sectionToStorage.get(sectionId) || sectionId;
      next.comboGroups[storageSectionKey] = {
        ...group,
        combinations: (group.combinations || []).map((combo: any) => remapFieldKeyedObject(combo, index)),
        sectionState: remapFieldKeyedObject(group.sectionState || {}, index),
      };
    });
  }

  if (tabState.combinations) {
    next.combinations = (tabState.combinations || []).map((combo: any) =>
      remapFieldKeyedObject(combo, index)
    );
  }

  return next;
}

function remapTabStateFromStorage(tabState: any, index: any) {
  if (!tabState || typeof tabState !== 'object') return tabState;

  const next: any = {};

  if (tabState.colorValues) {
    next.colorValues = remapFieldKeyedObject(tabState.colorValues, index, { reverse: true });
  }

  if (tabState.sectionFields) {
    next.sectionFields = {};
    Object.entries(tabState.sectionFields).forEach(([sectionKey, sectionState]) => {
      const canonicalSectionId =
        index.sectionFromStorage.get(sectionKey) ||
        resolveCanonicalKeyFromStorage(sectionKey, index.sectionFromStorage, 'section_');
      next.sectionFields[canonicalSectionId] = remapFieldKeyedObject(sectionState, index, {
        reverse: true,
      });
    });
  }

  if (tabState.comboGroups) {
    next.comboGroups = {};
    Object.entries(tabState.comboGroups).forEach(([sectionKey, group]: [string, any]) => {
      const canonicalSectionId =
        index.sectionFromStorage.get(sectionKey) ||
        resolveCanonicalKeyFromStorage(sectionKey, index.sectionFromStorage, 'section_');
      next.comboGroups[canonicalSectionId] = {
        ...group,
        combinations: (group.combinations || []).map((combo: any) =>
          remapFieldKeyedObject(combo, index, { reverse: true })
        ),
        sectionState: remapFieldKeyedObject(group.sectionState || {}, index, { reverse: true }),
      };
    });
  }

  if (tabState.combinations) {
    next.combinations = (tabState.combinations || []).map((combo: any) =>
      remapFieldKeyedObject(combo, index, { reverse: true })
    );
  }

  return next;
}

// ─── Pruning: drop fabricated default/empty combinations before persistence ───
// Faithful port of web `pruneHydratedStateForStorage` & helpers. Structure is
// preserved (verticals/tabs/sectionState/simple sections) so the builder
// re-hydrates editable empty rows on reload; only untouched combinations are
// removed so they are never stored as phantom products.

function gridObjectHasValue(grid: any): boolean {
  if (!grid || typeof grid !== 'object') return false;
  return Object.values(grid).some(
    (stories: any) =>
      stories &&
      typeof stories === 'object' &&
      Object.values(stories).some((v: any) => Number(v) > 0)
  );
}

function normalizeComparableValue(value: any): any {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return value === 0 ? '' : String(value);
  return value;
}

/**
 * A field value counts as "entered" only when it is non-empty AND differs from
 * the field's default. Text descriptors left at their configured defaultValue are
 * treated as not-entered; grids count only when they hold a real measurement;
 * arrays count when non-empty.
 */
function isEnteredFieldValue(value: any, defaultValue: any): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return gridObjectHasValue(value);
  const normalized = normalizeComparableValue(value);
  if (normalized === '') return false;
  return normalized !== normalizeComparableValue(defaultValue);
}

/**
 * A combination is meaningful (the rep actually BUILT it) only when a NON-LOCKED field
 * holds a value that differs from BOTH the group default AND the field's own configured
 * default. Rationale (fixes an un-built product persisting/showing, e.g. LeafFilter):
 *  - LOCKED fields are auto-resolved from the calculator (dcField-driven), so they are
 *    never rep input and never mark a combo as built — a product the rep didn't build
 *    carries only these auto values (profile "Versa", gutter width 6"/7").
 *  - A value equal to the field's `defaultValue` is a config-seeded default (an
 *    optionList/toggle whose default the state carries), not user input.
 * (Stronger than web's `comboHasEnteredData`, which compares only against the group
 * default and so lets a locked/seeded-default combo survive — a bug on web too.)
 */
function comboHasEnteredData(
  combo: any,
  defaults: any = {},
  fieldsById: Map<string, any> = new Map()
): boolean {
  if (!combo || typeof combo !== 'object') return false;
  const colorValues =
    combo.colorValues && typeof combo.colorValues === 'object' ? combo.colorValues : {};
  const keys = new Set([...Object.keys(combo), ...Object.keys(colorValues)]);

  return [...keys].some((key) => {
    if (key === 'colorValues' || key === '_combinationNumber') return false;
    const field = fieldsById.get(key);
    if (field && isFieldLocked(field)) return false; // auto-resolved, not rep-built
    const value = combo[key] !== undefined ? combo[key] : colorValues[key];
    if (!isEnteredFieldValue(value, defaults[key])) return false;
    // Equal to the field's own configured default → a seeded default, not user input.
    if (
      field &&
      field.defaultValue !== undefined &&
      field.defaultValue !== '' &&
      normalizeComparableValue(value) === normalizeComparableValue(field.defaultValue)
    ) {
      return false;
    }
    return true;
  });
}

const sectionFieldsById = (section: any): Map<string, any> =>
  new Map(
    (section ? getFlattenedCombinationSectionRowFields(section) : []).map((f: any) => [f.id, f])
  );

function pruneTabStateForStorage(tabState: any, tab: any, dealCenterData: any): any {
  if (!tabState || typeof tabState !== 'object') return tabState;

  const sections = getTabSections(tab);
  const sectionById = new Map(sections.map((section: any) => [String(section.id), section]));
  const next: any = { ...tabState };

  if (next.comboGroups) {
    const prunedGroups: any = {};
    Object.entries(next.comboGroups).forEach(([sectionId, group]: [string, any]) => {
      const section = sectionById.get(String(sectionId));
      const defaults = section ? buildComboGroupDefaultItem(section, dealCenterData) : {};
      const fieldsById = sectionFieldsById(section);
      const combinations = (group?.combinations || []).filter((combo: any) =>
        comboHasEnteredData(combo, defaults, fieldsById)
      );
      prunedGroups[sectionId] = { ...group, combinations };
    });
    next.comboGroups = prunedGroups;
  }

  if (next.combinations) {
    const defaults = sections[0] ? buildComboGroupDefaultItem(sections[0], dealCenterData) : {};
    const fieldsById = sectionFieldsById(sections[0]);
    next.combinations = (next.combinations || []).filter((combo: any) =>
      comboHasEnteredData(combo, defaults, fieldsById)
    );
  }

  return next;
}

function pruneHydratedStateForStorage(hydrated: any, config: any, dealCenterData: any): any {
  const result: any = {};

  Object.keys(hydrated || {}).forEach((key) => {
    if (ROOT_PASSTHROUGH_KEYS.has(key)) result[key] = hydrated[key];
  });

  (config?.verticals || []).forEach((vertical: any) => {
    const verticalState = hydrated?.[vertical.id];
    if (!verticalState) return;

    const prunedVertical: any = {};
    (vertical.tabs || []).forEach((tab: any) => {
      if (verticalState[tab.id] === undefined) return;
      prunedVertical[tab.id] = pruneTabStateForStorage(verticalState[tab.id], tab, dealCenterData);
    });

    result[vertical.id] = prunedVertical;
  });

  return result;
}

export function serializeDynamicJobStateForStorage(
  jobState: any,
  config: any,
  dealCenterData: any = {},
  preserveExisting = false
) {
  const hydrated = hydrateJobStateForPersistence(jobState, config, dealCenterData, preserveExisting);
  const pruned = pruneHydratedStateForStorage(hydrated, config, dealCenterData);
  const index = buildConfigStorageIndex(config);
  const serialized: any = {
    _storageVersion: DYNAMIC_JOB_STATE_STORAGE_VERSION,
  };

  Object.entries(pruned).forEach(([key, value]) => {
    if (ROOT_PASSTHROUGH_KEYS.has(key)) {
      serialized[key] = value;
      return;
    }

    const storageVerticalKey = index.verticalToStorage.get(key) || key;
    serialized[storageVerticalKey] = {};

    Object.entries(value || {}).forEach(([tabId, tabState]) => {
      const storageTabKey = index.tabToStorage.get(tabId) || tabId;
      serialized[storageVerticalKey][storageTabKey] = remapTabStateForStorage(tabState, index);
    });
  });

  return serialized;
}

export function deserializeDynamicJobStateFromStorage(saved: any, config: any) {
  if (!saved || typeof saved !== 'object') return saved;

  const index = buildConfigStorageIndex(config);
  const { _storageVersion, ...rest } = saved;
  const runtime: any = {};

  Object.entries(rest).forEach(([verticalKey, verticalState]) => {
    if (ROOT_PASSTHROUGH_KEYS.has(verticalKey)) {
      runtime[verticalKey] = verticalState;
      return;
    }

    const canonicalVerticalId =
      index.verticalFromStorage.get(verticalKey) || verticalKey;

    runtime[canonicalVerticalId] = {};

    Object.entries(verticalState || {}).forEach(([tabKey, tabState]) => {
      const canonicalTabId = index.tabFromStorage.get(tabKey) || tabKey;

      runtime[canonicalVerticalId][canonicalTabId] = remapTabStateFromStorage(tabState, index);
    });
  });

  return runtime;
}
