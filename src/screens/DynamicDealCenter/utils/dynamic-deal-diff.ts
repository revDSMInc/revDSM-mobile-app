// Field-level diff between the original and edited dynamic job state, labelled
// via the job-builder config, for the deal-edit Review step.
//
// Ported from web `src/sections/deal/components/dynamic-deal-diff.js`, with one
// deliberate DIVERGENCE: combination rows are matched by IDENTITY instead of by
// array position — see `matchCombinations`. Web still collapses them (and has
// the bug that motivated this).
//
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

/** Non-empty `{ fieldId: displayString }` for one object of the job state. */
function readValues(obj: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.entries(obj).forEach(([k, v]) => {
    if (SKIP_LEAF_KEYS.has(k)) return;
    const disp = displayValue(v);
    if (disp !== '') out[k] = disp;
  });
  return out;
}

/** One combination row of a combination section (or a legacy tab-level combo). */
interface ComboSnapshot {
  /** The chip number the builder shows ("Combination #N"). */
  number: number;
  values: Record<string, string>;
}

/** Every combination row of one section, kept as a LIST rather than collapsed. */
interface ComboGroupSnapshot {
  scopeId: string;
  combos: ComboSnapshot[];
}

interface StateSnapshot {
  /** Section fields, combination-section header state, and tab-level fields. */
  flat: Record<string, string>;
  /** Keyed by `<verticalKey>\0<tabId>\0<scopeId>` so groups never cross tabs. */
  groups: Record<string, ComboGroupSnapshot>;
}

/**
 * Split a runtime job state into its single-valued fields (`flat`) and its
 * combination LISTS (`groups`).
 *
 * The split is the whole point: combination rows must NOT be folded into `flat`,
 * because a section holds several of them under one section id and folding makes
 * the last one win. See `matchCombinations`.
 */
function collectStateSnapshot(jobState: any): StateSnapshot {
  const flat: Record<string, string> = {};
  const groups: Record<string, ComboGroupSnapshot> = {};

  const ingestFlat = (scopeId: string, obj: any) => {
    Object.entries(readValues(obj)).forEach(([k, v]) => {
      flat[qualify(scopeId, k)] = v;
    });
  };

  const ingestCombos = (groupKey: string, scopeId: string, combos: any[]) => {
    const snapshots: ComboSnapshot[] = [];
    (combos || []).forEach((combo: any, index: number) => {
      const values = readValues(combo);
      // A combination with nothing entered carries no information either way, and
      // the builder seeds an empty default combo into any section that saved none
      // (`ensureTabStateShape`). Keeping them would report a phantom add/remove.
      if (!Object.keys(values).length) return;
      const stored = Number(combo?._combinationNumber);
      snapshots.push({
        number: Number.isFinite(stored) && stored > 0 ? stored : index + 1,
        values,
      });
    });
    if (snapshots.length) groups[groupKey] = { scopeId, combos: snapshots };
  };

  Object.entries(jobState || {}).forEach(([vKey, vertical]: [string, any]) => {
    if (STRUCTURAL_STATE_KEYS.has(vKey) || !vertical || typeof vertical !== 'object') return;
    Object.entries(vertical).forEach(([tabId, tab]: [string, any]) => {
      if (!tab || typeof tab !== 'object') return;
      Object.entries(tab.sectionFields || {}).forEach(([secId, secState]) => ingestFlat(secId, secState));
      Object.entries(tab.comboGroups || {}).forEach(([secId, group]: [string, any]) => {
        ingestCombos(`${vKey}${SCOPE_SEP}${tabId}${SCOPE_SEP}${secId}`, secId, group?.combinations || []);
        // The section-scoped header state is a single object, not a row.
        if (group?.sectionState) ingestFlat(secId, group.sectionState);
      });
      const { sectionFields, comboGroups, combinations, ...rest } = tab;
      ingestFlat(tabId, rest);
      // Legacy tab-level combinations are scoped by the tab id.
      ingestCombos(`${vKey}${SCOPE_SEP}${tabId}${SCOPE_SEP}${tabId}`, tabId, combinations || []);
    });
  });

  return { flat, groups };
}

/**
 * Flatten a runtime job state to `{ "<scopeId>\0<fieldId>": displayString }`.
 *
 * ⚠️ LOSSY for combination sections — every combination of a section collapses
 * into the same keys and the last one wins. The Review diff deliberately does
 * NOT use this (see `computeDynamicBuildChanges`); it is kept as the module's
 * flat-value view for callers that only need "what is entered anywhere".
 */
export function flattenStateValues(jobState: any): Record<string, string> {
  const { flat, groups } = collectStateSnapshot(jobState);
  const out: Record<string, string> = {};
  Object.values(groups).forEach(({ scopeId, combos }) => {
    combos.forEach((combo) => {
      Object.entries(combo.values).forEach(([k, v]) => {
        out[qualify(scopeId, k)] = v;
      });
    });
  });
  return { ...out, ...flat };
}

export type BuildChangeKind = 'change' | 'added' | 'removed';

export interface BuildChange {
  field: string;
  from: string;
  to: string;
  /** Omitted for an ordinary field edit. */
  kind?: BuildChangeKind;
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
 *
 * `comboLabel` is inserted between the two for sections holding more than one
 * combination, so a row names the combination the rep actually edited.
 */
function formatChangeFieldLabel(meta: FieldLabelMeta, comboLabel = ''): string {
  const parts = [
    (meta.sectionLabel || meta.tab || '').trim(),
    comboLabel.trim(),
    (meta.label || '').trim(),
  ].filter(Boolean);
  return parts.join(' · ');
}

/** "<section>" alone — the heading for a whole-combination add/remove row. */
function formatScopeLabel(meta: FieldLabelMeta): string {
  return (meta.sectionLabel || meta.tab || '').trim();
}

/** "Footage 85 · Type PARTIAL · Color Musket Brown" — names a combination by its contents. */
function describeCombo(
  combo: ComboSnapshot,
  scopeId: string,
  labels: Record<string, FieldLabelMeta>
): string {
  const parts: string[] = [];
  Object.entries(combo.values).forEach(([fieldId, value]) => {
    const meta = labels[qualify(scopeId, fieldId)];
    if (!meta) return;
    const name = (meta.label || '').trim();
    parts.push(name ? `${name} ${value}` : value);
  });
  return parts.length ? parts.join(' · ') : '—';
}

function comboSignature(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('\u0001');
}

/** How many fields two combinations agree on — the pairing score. */
function overlapScore(a: Record<string, string>, b: Record<string, string>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let same = 0;
  keys.forEach((k) => {
    if ((a[k] || '') === (b[k] || '')) same += 1;
  });
  return same;
}

interface ComboMatch {
  pairs: Array<[number, number]>;
  removedIdx: number[];
  addedIdx: number[];
}

/**
 * Pair the original combinations with the edited ones by CONTENT, never by array
 * position.
 *
 * Position is unusable: removing a combination shifts every later one down (and
 * `handleRemoveCombo` renumbers `_combinationNumber` on top of that), so slot 1
 * of the edited list is a different physical combination than slot 1 of the
 * original. Diffing them positionally is what made "removed the 85ft black
 * soffit" render as "changed 85 → 200 / PARTIAL → FULL / Musket Brown → White".
 */
function matchCombinations(orig: ComboSnapshot[], next: ComboSnapshot[]): ComboMatch {
  const pairs: Array<[number, number]> = [];
  const usedOrig = new Set<number>();
  const usedNext = new Set<number>();

  // Pass 1 — identical combinations claim each other FIRST. This is the pass that
  // fixes the ticket: the untouched survivor locks onto its own original, so it
  // can never be paired with the one the rep deleted.
  const nextSignatures = next.map((n) => comboSignature(n.values));
  orig.forEach((o, oi) => {
    const sig = comboSignature(o.values);
    const ni = nextSignatures.findIndex((s, i) => !usedNext.has(i) && s === sig);
    if (ni < 0) return;
    usedOrig.add(oi);
    usedNext.add(ni);
    pairs.push([oi, ni]);
  });

  // Pass 2 — greedy best-overlap over what is left, so a genuinely EDITED
  // combination still reads as a field change rather than a remove plus an add.
  const candidates: Array<{ oi: number; ni: number; score: number; dist: number }> = [];
  orig.forEach((o, oi) => {
    if (usedOrig.has(oi)) return;
    next.forEach((n, ni) => {
      if (usedNext.has(ni)) return;
      const score = overlapScore(o.values, n.values);
      if (score > 0) candidates.push({ oi, ni, score, dist: Math.abs(oi - ni) });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.dist - b.dist || a.oi - b.oi || a.ni - b.ni);
  candidates.forEach((c) => {
    if (usedOrig.has(c.oi) || usedNext.has(c.ni)) return;
    usedOrig.add(c.oi);
    usedNext.add(c.ni);
    pairs.push([c.oi, c.ni]);
  });

  const removedIdx = orig.map((_, i) => i).filter((i) => !usedOrig.has(i));
  const addedIdx = next.map((_, i) => i).filter((i) => !usedNext.has(i));

  // Pass 3 — one left on each side can only be an edit, however little the two
  // have in common. Without this, rewriting every field of a section's only
  // combination would report it as removed AND added.
  if (removedIdx.length === 1 && addedIdx.length === 1) {
    pairs.push([removedIdx[0], addedIdx[0]]);
    return { pairs, removedIdx: [], addedIdx: [] };
  }

  return { pairs, removedIdx, addedIdx };
}

/**
 * Compare two dynamic job states and return labelled changes grouped by
 * vertical: `[{ vertical, changes: [{ field, from, to, kind }] }]`.
 */
export function computeDynamicBuildChanges(
  originalState: any,
  editedState: any,
  config: any
): BuildChangeGroup[] {
  if (!editedState) return [];
  const labels = buildFieldLabelMap(config);
  const oldSnap = collectStateSnapshot(originalState);
  const newSnap = collectStateSnapshot(editedState);

  const byVertical: Record<string, BuildChange[]> = {};
  const push = (meta: FieldLabelMeta, change: BuildChange) => {
    const verticalKey = meta.vertical || 'Job Build';
    if (!byVertical[verticalKey]) byVertical[verticalKey] = [];
    byVertical[verticalKey].push(change);
  };

  // ── single-valued fields (sections, combination headers, tab fields) ─────────
  const flatKeys = new Set([...Object.keys(oldSnap.flat), ...Object.keys(newSnap.flat)]);
  flatKeys.forEach((key) => {
    const from = oldSnap.flat[key] || '';
    const to = newSnap.flat[key] || '';
    if (from === to) return;
    const meta = labels[key];
    if (!meta) return; // unknown field id — skip noise
    push(meta, { field: formatChangeFieldLabel(meta), from: from || '—', to: to || '—' });
  });

  // ── combination rows ────────────────────────────────────────────────────────
  const groupKeys = new Set([...Object.keys(oldSnap.groups), ...Object.keys(newSnap.groups)]);
  groupKeys.forEach((groupKey) => {
    const oldGroup = oldSnap.groups[groupKey];
    const newGroup = newSnap.groups[groupKey];
    const scopeId = (oldGroup || newGroup).scopeId;
    const origCombos = oldGroup?.combos || [];
    const nextCombos = newGroup?.combos || [];

    // The group's own meta names the section on add/remove rows. Any labelled
    // field of any combination resolves it; if none does, the section isn't in
    // the config we were handed and reporting it would be noise.
    let groupMeta: FieldLabelMeta | null = null;
    [...origCombos, ...nextCombos].some((combo) =>
      Object.keys(combo.values).some((fieldId) => {
        const meta = labels[qualify(scopeId, fieldId)];
        if (meta) groupMeta = meta;
        return Boolean(meta);
      })
    );
    if (!groupMeta) return;

    const scopeLabel = formatScopeLabel(groupMeta);
    const { pairs, removedIdx, addedIdx } = matchCombinations(origCombos, nextCombos);

    // The chip number only disambiguates rows when the section actually holds
    // more than one combination — a single-combination section keeps the plain
    // "<section> · <field>" label it has always had.
    const isMulti = origCombos.length > 1 || nextCombos.length > 1;

    pairs.forEach(([oi, ni]) => {
      const from = origCombos[oi].values;
      const to = nextCombos[ni].values;
      const comboLabel = isMulti ? `Combination #${nextCombos[ni].number}` : '';
      const fieldIds = new Set([...Object.keys(from), ...Object.keys(to)]);
      fieldIds.forEach((fieldId) => {
        const fromVal = from[fieldId] || '';
        const toVal = to[fieldId] || '';
        if (fromVal === toVal) return;
        const meta = labels[qualify(scopeId, fieldId)];
        if (!meta) return;
        push(meta, {
          field: formatChangeFieldLabel(meta, comboLabel),
          from: fromVal || '—',
          to: toVal || '—',
        });
      });
    });

    // An addendum is "the original agreement PLUS what we added here and MINUS
    // what we removed here", so a dropped combination has to read as a removal
    // in its own right — never as an edit of whatever combination survived it.
    removedIdx.forEach((oi) => {
      push(groupMeta as FieldLabelMeta, {
        field: [scopeLabel, 'Combination Removed'].filter(Boolean).join(' · '),
        from: describeCombo(origCombos[oi], scopeId, labels),
        to: '—',
        kind: 'removed',
      });
    });
    addedIdx.forEach((ni) => {
      push(groupMeta as FieldLabelMeta, {
        field: [scopeLabel, 'Combination Added'].filter(Boolean).join(' · '),
        from: '—',
        to: describeCombo(nextCombos[ni], scopeId, labels),
        kind: 'added',
      });
    });
  });

  return Object.entries(byVertical).map(([vertical, changes]) => ({ vertical, changes }));
}
