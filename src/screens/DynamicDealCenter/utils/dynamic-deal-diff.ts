import { isContainerFieldType } from '../../../utils/dynamic-job-builder/constants/field-types';
import { resolveLocationGridConfig } from '../../../utils/dynamic-job-builder/engine/location-grid-utils';

const STRUCTURAL_STATE_KEYS = new Set(['_storageVersion', 'scheduleTime', 'agreements', 'orderSheets']);

const SKIP_LEAF_KEYS = new Set(['colorValues', '_combinationNumber', '_addedInEdit', '_storageVersion']);

const COLOR_FIELD_TYPES = new Set(['swatch', 'colorSelection', 'customColor']);

const SCOPE_SEP = '\u0000';
const qualify = (scopeId: string, fieldId: string) => `${scopeId}${SCOPE_SEP}${fieldId}`;

const CELL_SEP = '\u0002';

function isGridValue(v: any): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const rows = Object.values(v);
  return rows.length > 0 && rows.every((row) => !!row && typeof row === 'object' && !Array.isArray(row));
}

interface FieldLabelMeta {
  label: string;
  tab?: string;
  sectionLabel?: string;
  vertical?: string;
  gridRowLabels?: Record<string, string>;
  gridColLabels?: Record<string, string>;
  order?: number;
}

function splitCellKey(fieldKey: string): { fieldId: string; rowKey?: string; colKey?: string } {
  const [fieldId, rowKey, colKey] = fieldKey.split(CELL_SEP);
  return { fieldId, rowKey, colKey };
}

function resolveFieldLabel(field: any, parentLabel = ''): string {
  const own = (field?.label || field?.title || field?.name || '').trim();
  if (own) return own;
  if (parentLabel) return parentLabel;
  if (COLOR_FIELD_TYPES.has(field?.type)) return 'Color';
  return field?.id || '';
}

function gridCellLabels(field: any): Pick<FieldLabelMeta, 'gridRowLabels' | 'gridColLabels'> {
  const cfg = resolveLocationGridConfig(field || {});
  const toMap = (entries: any[]) => {
    const out: Record<string, string> = {};
    (entries || []).forEach((e: any) => {
      if (e?.key) out[e.key] = String(e.label ?? e.key);
    });
    return out;
  };
  return { gridRowLabels: toMap(cfg.rows), gridColLabels: toMap(cfg.columns) };
}

export function buildFieldLabelMap(config: any): Record<string, FieldLabelMeta> {
  const map: Record<string, FieldLabelMeta> = {};
  let order = 0;
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
            order: order++,
            label: isContainer ? containerLabel || f.id : resolveFieldLabel(f, parentLabel),
            tab: tabLabel,
            sectionLabel: sectionLabel || '',
            vertical: verticalLabel,
            ...(f?.type === 'locationGrid' || f?.type === 'grid' ? gridCellLabels(f) : null),
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
      collect(t.fields, t.id, t.label, v.label);
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

function readValues(obj: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.entries(obj).forEach(([k, v]) => {
    if (SKIP_LEAF_KEYS.has(k)) return;

    if (isGridValue(v)) {
      Object.entries(v as Record<string, any>).forEach(([rowKey, row]) => {
        Object.entries(row || {}).forEach(([colKey, cell]) => {
          if (!(Number(cell) > 0)) return;
          out[`${k}${CELL_SEP}${rowKey}${CELL_SEP}${colKey}`] = String(cell);
        });
      });
      return;
    }

    const disp = displayValue(v);
    if (disp !== '') out[k] = disp;
  });
  return out;
}

interface ComboSnapshot {
  number: number;
  values: Record<string, string>;
}

interface ComboGroupSnapshot {
  scopeId: string;
  combos: ComboSnapshot[];
}

interface StateSnapshot {
  flat: Record<string, string>;
  groups: Record<string, ComboGroupSnapshot>;
}

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
        if (group?.sectionState) ingestFlat(secId, group.sectionState);
      });
      const { sectionFields, comboGroups, combinations, ...rest } = tab;
      ingestFlat(tabId, rest);
      ingestCombos(`${vKey}${SCOPE_SEP}${tabId}${SCOPE_SEP}${tabId}`, tabId, combinations || []);
    });
  });

  return { flat, groups };
}

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

export interface ComboField {
  label: string;
  value: string;
  from?: string;
  unchanged?: boolean;
}

export interface BuildChange {
  field: string;
  from: string;
  to: string;
  kind?: BuildChangeKind;
  comboFields?: ComboField[];
  comboKey?: string;
}
export interface BuildChangeGroup {
  vertical: string;
  changes: BuildChange[];
}

function formatChangeFieldLabel(meta: FieldLabelMeta, comboLabel = '', cellLabel = ''): string {
  const parts = [
    (meta.sectionLabel || meta.tab || '').trim(),
    comboLabel.trim(),
    (meta.label || '').trim(),
    cellLabel.trim(),
  ].filter(Boolean);
  return parts.join(' · ');
}

function formatScopeLabel(meta: FieldLabelMeta): string {
  return (meta.sectionLabel || meta.tab || '').trim();
}

function resolveKeyMeta(
  scopeId: string,
  fieldKey: string,
  labels: Record<string, FieldLabelMeta>
): { meta: FieldLabelMeta; cellLabel: string } | null {
  const { fieldId, rowKey, colKey } = splitCellKey(fieldKey);
  const meta = labels[qualify(scopeId, fieldId)];
  if (!meta) return null;
  if (!rowKey && !colKey) return { meta, cellLabel: '' };
  const rowLabel = meta.gridRowLabels?.[rowKey || ''] || rowKey || '';
  const colLabel = meta.gridColLabels?.[colKey || ''] || colKey || '';
  return { meta, cellLabel: [rowLabel, colLabel].filter(Boolean).join(' · ') };
}

function comboFields(
  combo: ComboSnapshot,
  scopeId: string,
  labels: Record<string, FieldLabelMeta>
): ComboField[] {
  const rows: Array<{ order: number; label: string; value: string }> = [];
  Object.entries(combo.values).forEach(([fieldKey, value]) => {
    const resolved = resolveKeyMeta(scopeId, fieldKey, labels);
    if (!resolved) return;
    const label = [(resolved.meta.label || '').trim(), resolved.cellLabel]
      .filter(Boolean)
      .join(' · ');
    rows.push({ order: resolved.meta.order ?? Number.MAX_SAFE_INTEGER, label, value });
  });
  return rows
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ label, value }) => ({ label, value }));
}

function comboFieldsForPair(
  orig: ComboSnapshot,
  next: ComboSnapshot,
  scopeId: string,
  labels: Record<string, FieldLabelMeta>
): ComboField[] {
  const rows: Array<{ order: number; i: number; field: ComboField }> = [];
  const keys = [...new Set([...Object.keys(next.values), ...Object.keys(orig.values)])];
  keys.forEach((fieldKey, i) => {
    const resolved = resolveKeyMeta(scopeId, fieldKey, labels);
    if (!resolved) return;
    const label = [(resolved.meta.label || '').trim(), resolved.cellLabel]
      .filter(Boolean)
      .join(' · ');
    const fromVal = orig.values[fieldKey] || '';
    const toVal = next.values[fieldKey] || '';
    rows.push({
      order: resolved.meta.order ?? Number.MAX_SAFE_INTEGER,
      i,
      field:
        fromVal === toVal
          ? { label, value: toVal || '—', unchanged: true }
          : { label, value: toVal || '—', from: fromVal || '—' },
    });
  });
  return rows.sort((a, b) => a.order - b.order || a.i - b.i).map((r) => r.field);
}

function describeCombo(
  combo: ComboSnapshot,
  scopeId: string,
  labels: Record<string, FieldLabelMeta>
): string {
  const parts = comboFields(combo, scopeId, labels).map(({ label, value }) =>
    label ? `${label} ${value}` : value
  );
  return parts.length ? parts.join(' · ') : '—';
}

function comboSignature(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('\u0001');
}

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

function matchCombinations(orig: ComboSnapshot[], next: ComboSnapshot[]): ComboMatch {
  const pairs: Array<[number, number]> = [];
  const usedOrig = new Set<number>();
  const usedNext = new Set<number>();

  const nextSignatures = next.map((n) => comboSignature(n.values));
  orig.forEach((o, oi) => {
    const sig = comboSignature(o.values);
    const ni = nextSignatures.findIndex((s, i) => !usedNext.has(i) && s === sig);
    if (ni < 0) return;
    usedOrig.add(oi);
    usedNext.add(ni);
    pairs.push([oi, ni]);
  });

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

  if (removedIdx.length === 1 && addedIdx.length === 1) {
    pairs.push([removedIdx[0], addedIdx[0]]);
    return { pairs, removedIdx: [], addedIdx: [] };
  }

  return { pairs, removedIdx, addedIdx };
}

export interface ComboBlock {
  title: string;
  kind: BuildChangeKind;
  rows: ComboField[];
}

export type ReviewEntry =
  | { change: BuildChange; blocks?: undefined; label?: undefined }
  | { change?: undefined; blocks: ComboBlock[]; label: string };

function splitComboHead(label: string): { head: string; chip: string } {
  const parts = label.split(' · ');
  const last = parts[parts.length - 1] || '';
  if (/^Combination #\d+$/.test(last)) {
    return { head: parts.slice(0, -1).join(' · '), chip: last };
  }
  return { head: label, chip: '' };
}

export function groupComboRows(changes: BuildChange[]): ReviewEntry[] {
  const out: ReviewEntry[] = [];

  const addBlock = (head: string, block: ComboBlock) => {
    const last = out[out.length - 1];
    if (last?.blocks && last.label === head) {
      last.blocks.push(block);
      return;
    }
    out.push({ label: head, blocks: [block] });
  };

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];

    if (change.comboKey) {
      let j = i;
      while (j < changes.length && changes[j].comboKey === change.comboKey) j += 1;
      const run = changes.slice(i, j);
      i = j;
      if (run.length < 2) {
        run.forEach((c) => out.push({ change: c }));
        continue;
      }
      const prefix = commonLabelPrefix(run.map((c) => c.field));
      const { head, chip } = splitComboHead(prefix);
      addBlock(head, {
        title: chip,
        kind: 'change',
        rows:
          run.find((c) => c.comboFields?.length)?.comboFields ||
          run.map((c) => ({
            label: c.field.slice(prefix ? prefix.length + 3 : 0) || c.field,
            value: c.to,
            from: c.from,
          })),
      });
      continue;
    }

    if (change.comboFields?.length && (change.kind === 'added' || change.kind === 'removed')) {
      const parts = change.field.split(' · ');
      const head = parts.length > 1 ? parts.slice(0, -1).join(' · ') : change.field;
      addBlock(head, { title: '', kind: change.kind, rows: change.comboFields });
      i += 1;
      continue;
    }

    out.push({ change });
    i += 1;
  }

  out.forEach((entry) => {
    entry.blocks?.forEach((block, idx) => {
      if (!block.title) block.title = `Combination #${idx + 1}`;
    });
  });

  return out;
}

function commonLabelPrefix(labels: string[]): string {
  const parts = labels.map((l) => l.split(' · '));
  const head: string[] = [];
  for (let i = 0; i < parts[0].length - 1; i += 1) {
    const seg = parts[0][i];
    if (!parts.every((p) => p.length > i + 1 && p[i] === seg)) break;
    head.push(seg);
  }
  return head.join(' · ');
}

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

  const flatKeys = new Set([...Object.keys(oldSnap.flat), ...Object.keys(newSnap.flat)]);
  flatKeys.forEach((key) => {
    const from = oldSnap.flat[key] || '';
    const to = newSnap.flat[key] || '';
    if (from === to) return;
    const sep = key.indexOf(SCOPE_SEP);
    const resolved =
      sep < 0
        ? null
        : resolveKeyMeta(key.slice(0, sep), key.slice(sep + SCOPE_SEP.length), labels);
    if (!resolved) return; // unknown field id — skip noise
    push(resolved.meta, {
      field: formatChangeFieldLabel(resolved.meta, '', resolved.cellLabel),
      from: from || '—',
      to: to || '—',
    });
  });

  const groupKeys = new Set([...Object.keys(oldSnap.groups), ...Object.keys(newSnap.groups)]);
  groupKeys.forEach((groupKey) => {
    const oldGroup = oldSnap.groups[groupKey];
    const newGroup = newSnap.groups[groupKey];
    const scopeId = (oldGroup || newGroup).scopeId;
    const origCombos = oldGroup?.combos || [];
    const nextCombos = newGroup?.combos || [];

    let groupMeta: FieldLabelMeta | null = null;
    [...origCombos, ...nextCombos].some((combo) =>
      Object.keys(combo.values).some((fieldKey) => {
        const meta = labels[qualify(scopeId, splitCellKey(fieldKey).fieldId)];
        if (meta) groupMeta = meta;
        return Boolean(meta);
      })
    );
    if (!groupMeta) return;

    const scopeLabel = formatScopeLabel(groupMeta);
    const { pairs, removedIdx, addedIdx } = matchCombinations(origCombos, nextCombos);

    const isMulti = origCombos.length > 1 || nextCombos.length > 1;

    pairs.forEach(([oi, ni]) => {
      const from = origCombos[oi].values;
      const to = nextCombos[ni].values;
      const comboLabel = isMulti ? `Combination #${nextCombos[ni].number}` : '';
      const comboKey = `${groupKey}#${ni}`;
      let comboAll: ComboField[] | undefined = comboFieldsForPair(
        origCombos[oi],
        nextCombos[ni],
        scopeId,
        labels
      );
      const fieldKeys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
      fieldKeys
        .map((fieldKey, i) => ({ fieldKey, i, resolved: resolveKeyMeta(scopeId, fieldKey, labels) }))
        .sort(
          (a, b) =>
            (a.resolved?.meta.order ?? Number.MAX_SAFE_INTEGER) -
              (b.resolved?.meta.order ?? Number.MAX_SAFE_INTEGER) || a.i - b.i
        )
        .forEach(({ fieldKey, resolved }) => {
          const fromVal = from[fieldKey] || '';
          const toVal = to[fieldKey] || '';
          if (fromVal === toVal) return;
          if (!resolved) return;
          push(resolved.meta, {
            field: formatChangeFieldLabel(resolved.meta, comboLabel, resolved.cellLabel),
            from: fromVal || '—',
            to: toVal || '—',
            comboKey,
            ...(comboAll ? { comboFields: comboAll } : null),
          });
          comboAll = undefined;
        });
    });

    removedIdx.forEach((oi) => {
      push(groupMeta as FieldLabelMeta, {
        field: [scopeLabel, 'Combination Removed'].filter(Boolean).join(' · '),
        from: describeCombo(origCombos[oi], scopeId, labels),
        to: '—',
        kind: 'removed',
        comboFields: comboFields(origCombos[oi], scopeId, labels),
      });
    });
    addedIdx.forEach((ni) => {
      push(groupMeta as FieldLabelMeta, {
        field: [scopeLabel, 'Combination Added'].filter(Boolean).join(' · '),
        from: '—',
        to: describeCombo(nextCombos[ni], scopeId, labels),
        kind: 'added',
        comboFields: comboFields(nextCombos[ni], scopeId, labels),
      });
    });
  });

  return Object.entries(byVertical).map(([vertical, changes]) => ({ vertical, changes }));
}
