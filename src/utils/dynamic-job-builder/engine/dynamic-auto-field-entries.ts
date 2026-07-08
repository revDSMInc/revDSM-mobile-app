import {
  getTabSections,
  getFlattenedCombinationSectionRowFields,
  flattenLeafFields,
} from './combination-utils';
import { isFieldLocked, resolveLockedValue } from './allocation-utils';
import { getAutoFieldEntriesForSection } from '../../activity-log/auto-fields';

export async function fetchAutoFieldEntries(leadId: string, calculatorData: any) {
  if (!leadId || !calculatorData) return {};
  return {};
}

export function resolveAutoFieldEntries(config: any, dealCenterData: any = {}) {
  const entries: Record<string, any> = {};

  (config?.verticals || []).forEach((vertical: any) => {
    (vertical.tabs || []).forEach((tab: any) => {
      if (tab.isSummary) return;
      (tab.fields || []).forEach((field: any) => {
        if (field.dcField && dealCenterData[field.dcField] !== undefined) {
          entries[field.id] = dealCenterData[field.dcField];
        }
      });
    });
  });

  return entries;
}

// ---------------------------------------------------------------------------
// Activity-log auto-field entries (RN port of web dynamic-auto-field-entries.js).
// Used by the dynamic activity-log hook to fire one `auto-populated` event per
// locked/auto-filled field on a tab (mirrors the static getAutoFieldEntriesForSection).
// ---------------------------------------------------------------------------

/** Map dynamic tab ids to static auto-field section keys (gutter, leaffilter, …). */
const TAB_ID_TO_AUTO_FIELD_SECTION: Record<string, string> = {
  gutter: 'gutter',
  gutters: 'gutter',
  guard: 'leaffilter',
  leaffilter: 'leaffilter',
  leaf_filter: 'leaffilter',
  soffit: 'soffit',
  fascia: 'fascia',
  additional: 'additional',
  misc: 'additional',
  miscellaneous: 'additional',
  lighting: 'lighting',
};

function resolveAutoFieldSectionKey(tab: any): string | null {
  const tabId = String(tab?.id || '').toLowerCase();
  if (TAB_ID_TO_AUTO_FIELD_SECTION[tabId]) {
    return TAB_ID_TO_AUTO_FIELD_SECTION[tabId];
  }
  return tabId || null;
}

function mergeAutoFieldEntry(entries: any[], entry: any) {
  if (!entry?.key) return;
  if (entries.some((existing) => existing.key === entry.key)) return;
  entries.push(entry);
}

function formatDisplayValue(val: any) {
  if (val === undefined || val === null || val === '') return null;
  if (Array.isArray(val)) return val.filter(Boolean).join(', ');
  if (typeof val === 'object') return null;
  return val;
}

function collectSectionFields(section: any): any[] {
  if (!section) return [];
  if (section.sectionType === 'simple') {
    return flattenLeafFields(section.fields || []);
  }
  return getFlattenedCombinationSectionRowFields(section) || section.fields || [];
}

export function buildDynamicTabLogKey(verticalId?: string, tabId?: string): string {
  return `${verticalId || ''}:${tabId || ''}`;
}

export function normalizeCalculatorAutoFieldsLogged(raw: any): Record<string, any> {
  if (raw === true) return {};
  if (raw && typeof raw === 'object') return { ...raw };
  return {};
}

export function extractLoggedSectionsFromCalculatorJobBuilder(jobBuilder: any) {
  return normalizeCalculatorAutoFieldsLogged(jobBuilder?.autoFieldsLogged);
}

/**
 * Schema-driven locked-field entries for activity logging (mirrors the static
 * getAutoFieldEntriesForSection). Returns [{ key, label, value, fieldType }].
 */
export function getDynamicAutoFieldEntriesForTab(tab: any, dealCenterData: any = {}): any[] {
  if (!tab) return [];

  const entries: any[] = [];
  const sections = getTabSections(tab);

  sections.forEach((section: any) => {
    collectSectionFields(section).forEach((field: any) => {
      if (!field?.id) return;
      if (!isFieldLocked(field)) return;

      const value = resolveLockedValue(field, dealCenterData);
      const displayValue = formatDisplayValue(value);
      if (displayValue === null || displayValue === '—') return;

      mergeAutoFieldEntry(entries, {
        key: field.id,
        label: field.label || field.id,
        value: displayValue,
        fieldType: 'locked',
      });
    });
  });

  const autoSectionKey = resolveAutoFieldSectionKey(tab);
  if (autoSectionKey) {
    getAutoFieldEntriesForSection(autoSectionKey, dealCenterData).forEach((entry: any) => {
      mergeAutoFieldEntry(entries, {
        key: entry.key,
        label: entry.label,
        value: entry.value,
        fieldType: entry.fieldType || 'locked',
      });
    });
  }

  return entries;
}
