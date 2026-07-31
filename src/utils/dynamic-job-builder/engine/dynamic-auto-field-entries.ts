import { getTabSections } from './combination-utils';
import { isContainerFieldType } from '../constants/field-types';
import { isFieldLocked, resolveLockedValue } from './allocation-utils';
import { resolveConditionalDefault } from './dependency-engine';
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

/**
 * Collect locked leaf fields while tracking the group each belongs to, so fields
 * that share a label across gutter sizes (e.g. a "LeafFilter Profile" per 5"/6"/7"
 * size) can be logged distinctly. The group is the nearest enclosing stack/accordion
 * container label, or the nearest preceding `sectionLabel` header — whichever most
 * recently applies in render order. Returns [{ field, groupLabel }]. (Web parity —
 * `dynamic-auto-field-entries.js#collectLockedFieldsWithGroup`.)
 */
function collectLockedFieldsWithGroup(fields: any[], inheritedGroup: string, out: any[]) {
  let currentGroup = inheritedGroup;

  (fields || []).forEach((field: any) => {
    if (!field) return;

    if (field.type === 'sectionLabel') {
      const title = String(field.title || field.label || '').trim();
      if (title) currentGroup = title;
      return;
    }

    if (isContainerFieldType(field.type) && field.fields?.length) {
      const containerLabel =
        field.label && field.showLabel !== false ? String(field.label).trim() : '';
      collectLockedFieldsWithGroup(field.fields, containerLabel || currentGroup, out);
      return;
    }

    if (field.id && isFieldLocked(field)) {
      out.push({ field, groupLabel: currentGroup });
    }
  });
}

/** Prefix a field label with its group when that adds distinguishing context. */
function buildGroupedAutoFieldLabel(field: any, groupLabel: string): string {
  const rawLabel = String(field.label || field.id || '').trim();
  const group = String(groupLabel || '').trim();
  if (!group) return rawLabel;
  if (rawLabel.toLowerCase().includes(group.toLowerCase())) return rawLabel;
  return `${group} - ${rawLabel}`;
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
    const locked: any[] = [];
    // Seed the group with the section label so multi-section tabs still get context
    // even when a section has no inner headers/containers (web parity).
    collectLockedFieldsWithGroup(section.fields || [], String(section.label || '').trim(), locked);

    locked.forEach(({ field, groupLabel }: any) => {
      // Web parity: resolve the locked value with the CONDITIONAL default as the
      // fallback (not the static `field.defaultValue`), so a field that resolves blank
      // via its dcField but has a conditional default still logs its real value instead
      // of being dropped.
      const value = resolveLockedValue(field, dealCenterData, {
        fallbackDefault: resolveConditionalDefault(field, {}, { dealCenterData }),
      });
      const displayValue = formatDisplayValue(value);
      if (displayValue === null || displayValue === '—') return;

      mergeAutoFieldEntry(entries, {
        key: field.id,
        label: buildGroupedAutoFieldLabel(field, groupLabel),
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
