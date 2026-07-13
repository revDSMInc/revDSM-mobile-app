// Field-level diff between the original and edited dynamic job state, labelled
// via the job-builder config, for the deal-edit Review step.
//
// Faithful port of web `src/sections/deal/components/dynamic-deal-diff.js`.
// Pure functions — no RN/web dependencies. Used by the 4-step deal-edit wizard's
// "Review & Submit" step to show the rep exactly what changed.

const STRUCTURAL_STATE_KEYS = new Set(['_storageVersion', 'scheduleTime', 'agreements', 'orderSheets']);

const SKIP_LEAF_KEYS = new Set(['colorValues', '_combinationNumber', '_storageVersion']);

// Field ids are reused across sections in authored configs (e.g. the Soffit
// "Vinyl Soffit" and "Porch Ceiling" sections share the same field ids). The
// runtime job state keeps them apart by section, so every flatten/label key must
// be qualified by its section (or tab) scope — otherwise an edit in one section
// is masked by another section's unchanged same-id value.
const SCOPE_SEP = ' ';
const qualify = (scopeId: string, fieldId: string) => `${scopeId}${SCOPE_SEP}${fieldId}`;

interface FieldLabelMeta {
  label: string;
  tab?: string;
  vertical?: string;
}

/** Build `{ "<scopeId> <fieldId>": { label, tab, vertical } }` from the config. */
export function buildFieldLabelMap(config: any): Record<string, FieldLabelMeta> {
  const map: Record<string, FieldLabelMeta> = {};
  const collect = (fields: any[], scopeId: string, tabLabel?: string, verticalLabel?: string) => {
    (fields || []).forEach((f) => {
      if (f?.id) {
        const qk = qualify(scopeId, f.id);
        if (!map[qk]) {
          map[qk] = {
            label: f.label || f.title || f.name || f.id,
            tab: tabLabel,
            vertical: verticalLabel,
          };
        }
      }
      if (Array.isArray(f?.fields)) collect(f.fields, scopeId, tabLabel, verticalLabel);
    });
  };
  (config?.verticals || []).forEach((v: any) => {
    (v.tabs || []).forEach((t: any) => {
      // Tab-level fields live directly on the tab state → scope by tab id.
      collect(t.fields, t.id, t.label, v.label);
      // Section fields (simple + combination) live under section id → scope by it.
      (t.sections || []).forEach((s: any) => collect(s.fields, s.id, t.label, v.label));
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

/** Flatten a runtime job state to `{ "<scopeId> <fieldId>": displayString }`. */
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
      field: meta.tab ? `${meta.tab} · ${meta.label}` : meta.label,
      from: from || '—',
      to: to || '—',
    });
  });

  return Object.entries(byVertical).map(([vertical, changes]) => ({ vertical, changes }));
}
