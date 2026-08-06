// Field-level diff between the original and edited dynamic job state, labelled
// via the job-builder config, for the deal-edit Review step.
//
// Faithful port of web `src/sections/deal/components/dynamic-deal-diff.js`.
// Pure functions — no RN/web dependencies. Used by the 4-step deal-edit wizard's
// "Review & Submit" step to show the rep exactly what changed.

import { isContainerFieldType } from '../../../utils/dynamic-job-builder/constants/field-types';

const STRUCTURAL_STATE_KEYS = new Set(['_storageVersion', 'scheduleTime', 'agreements', 'orderSheets']);

const SKIP_LEAF_KEYS = new Set(['colorValues', '_combinationNumber', '_storageVersion']);

const COLOR_FIELD_TYPES = new Set(['swatch', 'colorSelection', 'customColor']);

// Field ids are reused across sections in authored configs (e.g. the Soffit
// "Vinyl Soffit" and "Porch Ceiling" sections share the same field ids). The
// runtime job state keeps them apart by section, so every flatten/label key must
// be qualified by its section (or tab) scope — otherwise an edit in one section
// is masked by another section's unchanged same-id value.
//
// NUL is the separator (matching web) precisely because it can never occur in an
// authored id — a plain space could let `"a b" + "c"` collide with `"a" + "b c"`.
const SCOPE_SEP = '\u0000';
const qualify = (scopeId: string, fieldId: string) => `${scopeId}${SCOPE_SEP}${fieldId}`;

interface FieldLabelMeta {
  label: string;
  tab?: string;
  sectionLabel?: string;
  vertical?: string;
}

/**
 * A field's own label, else the enclosing container's (a `stack`/`accordion`
 * wrapper names its unlabelled children), else "Color" for swatch-style fields
 * — which are authored without a label because the swatch itself is the label.
 */
function resolveFieldLabel(field: any, parentLabel = ''): string {
  const own = (field?.label || field?.title || field?.name || '').trim();
  if (own) return own;
  if (parentLabel) return parentLabel;
  if (COLOR_FIELD_TYPES.has(field?.type)) return 'Color';
  return field?.id || '';
}

/** Build `{ "<scopeId>\0<fieldId>": { label, tab, sectionLabel, vertical } }` from the config. */
export function buildFieldLabelMap(config: any): Record<string, FieldLabelMeta> {
  const map: Record<string, FieldLabelMeta> = {};
  const collect = (
    fields: any[],
    scopeId: string,
    tabLabel?: string,
    verticalLabel?: string,
    sectionLabel = '',
    parentLabel = ''
  ) => {
    (fields || []).forEach((f) => {
      const isContainer = isContainerFieldType(f?.type);
      const containerLabel = (f?.label || f?.title || f?.name || '').trim();
      const nextParent = isContainer && containerLabel ? containerLabel : parentLabel;

      if (f?.id) {
        const qk = qualify(scopeId, f.id);
        if (!map[qk]) {
          map[qk] = {
            label: isContainer ? containerLabel || f.id : resolveFieldLabel(f, parentLabel),
            tab: tabLabel,
            sectionLabel: sectionLabel || '',
            vertical: verticalLabel,
          };
        }
      }
      if (Array.isArray(f?.fields)) {
        collect(f.fields, scopeId, tabLabel, verticalLabel, sectionLabel, nextParent);
      }
    });
  };
  (config?.verticals || []).forEach((v: any) => {
    (v.tabs || []).forEach((t: any) => {
      // Tab-level fields live directly on the tab state → scope by tab id.
      collect(t.fields, t.id, t.label, v.label);
      // Section fields (simple + combination) live under section id → scope by it.
      // The section's own label is carried so the Review row names the SECTION the
      // rep actually filled in ("Porch Ceiling SqFT"), not the tab it sits under
      // ("Soffit") — a tab holds several sections that share field ids.
      (t.sections || []).forEach((s: any) => collect(s.fields, s.id, t.label, v.label, s.label || ''));
      if (t.combinations?.fields) collect(t.combinations.fields, t.id, t.label, v.label);
    });
  });
  return map;
}

function gridTotal(grid: any): number {
  return Object.values(grid || {}).reduce(
    (gs: number, stories: any) =>
      gs + Object.values(stories || {}).reduce((ss: number, v: any) => ss + (Number(v) || 0), 0),
    0
  );
}

function displayValue(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.filter((x) => x !== '' && x != null).join(', ');
  if (typeof v === 'object') {
    const total = gridTotal(v);
    return total ? `${total}` : '';
  }
  return String(v);
}

/** Flatten a runtime job state to `{ "<scopeId>\0<fieldId>": displayString }`. */
export function flattenStateValues(jobState: any): Record<string, string> {
  const out: Record<string, string> = {};
  const ingest = (scopeId: string, obj: any) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.entries(obj).forEach(([k, v]) => {
      if (SKIP_LEAF_KEYS.has(k)) return;
      const disp = displayValue(v);
      // Later writes (e.g. a later combination in the SAME section) override
      // earlier ones — per-combo granularity is intentionally collapsed, but
      // scoping by section keeps different sections' same-id fields separate.
      if (disp !== '') out[qualify(scopeId, k)] = disp;
    });
  };
  Object.entries(jobState || {}).forEach(([vKey, vertical]: [string, any]) => {
    if (STRUCTURAL_STATE_KEYS.has(vKey) || !vertical || typeof vertical !== 'object') return;
    Object.entries(vertical).forEach(([tabId, tab]: [string, any]) => {
      if (!tab || typeof tab !== 'object') return;
      Object.entries(tab.sectionFields || {}).forEach(([secId, secState]) => ingest(secId, secState));
      Object.entries(tab.comboGroups || {}).forEach(([secId, group]: [string, any]) => {
        (group?.combinations || []).forEach((combo: any) => ingest(secId, combo));
        if (group?.sectionState) ingest(secId, group.sectionState);
      });
      const { sectionFields, comboGroups, combinations, ...rest } = tab;
      ingest(tabId, rest);
      (combinations || []).forEach((combo: any) => ingest(tabId, combo));
    });
  });
  return out;
}

export interface BuildChange {
  field: string;
  from: string;
  to: string;
}
export interface BuildChangeGroup {
  vertical: string;
  changes: BuildChange[];
}

/**
 * "<section> · <field>" — the SECTION wins over the tab, because a tab groups
 * several sections that reuse the same field ids ("Soffit" holds both "Vinyl
 * Soffit" and "Porch Ceiling SqFT", each with Location/Footage/Type/Color).
 * Naming the row after the tab would tell the rep they changed regular Soffit
 * when they actually filled in Porch Ceiling. Falls back to the tab for
 * tab-level fields, which have no section.
 */
function formatChangeFieldLabel(meta: FieldLabelMeta): string {
  const prefix = (meta.sectionLabel || meta.tab || '').trim();
  const suffix = (meta.label || '').trim();
  if (prefix && suffix) return `${prefix} · ${suffix}`;
  return prefix || suffix;
}

/**
 * Compare two dynamic job states and return labelled changes grouped by
 * vertical: `[{ vertical, changes: [{ field, from, to }] }]`.
 */
export function computeDynamicBuildChanges(
  originalState: any,
  editedState: any,
  config: any
): BuildChangeGroup[] {
  if (!editedState) return [];
  const labels = buildFieldLabelMap(config);
  const oldFlat = flattenStateValues(originalState);
  const newFlat = flattenStateValues(editedState);

  const fieldIds = new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]);
  const byVertical: Record<string, BuildChange[]> = {};

  fieldIds.forEach((fieldId) => {
    const from = oldFlat[fieldId] || '';
    const to = newFlat[fieldId] || '';
    if (from === to) return;
    const meta = labels[fieldId];
    if (!meta) return; // unknown field id — skip noise
    const verticalKey = meta.vertical || 'Job Build';
    if (!byVertical[verticalKey]) byVertical[verticalKey] = [];
    byVertical[verticalKey].push({
      field: formatChangeFieldLabel(meta),
      from: from || '—',
      to: to || '—',
    });
  });

  return Object.entries(byVertical).map(([vertical, changes]) => ({ vertical, changes }));
}
