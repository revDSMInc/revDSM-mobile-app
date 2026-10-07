import { paymentPlans } from '../../../utils/calculator/payment-plans';
import { resolveAllocationMetrics } from '../../../utils/dynamic-job-builder/engine/allocation-value-resolver';
import { collectAllocationFields } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import { extractDealCenterFieldOptions, type DealCenterFieldOption } from './build-deal-center-data';
import { resolveFieldTierPrice, applyFeesToTier, type PricingConfig } from './pricing-config-util';

const DEAL_PRICING_DEBUG = false;

export interface Tiers {
  cost: number;
  par: number;
  retail: number;
}

export interface EditedTiersResult {
  previous: Tiers;
  next: Tiers;
  delta: Tiers;
  changed: boolean;
  debug?: string;
}

interface TierOpts {
  schemas: any[];
  paymentMethod?: string;
  isLowesLead?: boolean;
  pricingConfig?: PricingConfig | null;
}

export const parsePrice = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
};

export function resolveTierPaymentMethod(balanceMethod: any): 'amex' | 'mcVisaDscvr' | 'check' {
  const m = String(balanceMethod || '').toLowerCase();
  if (m.includes('amex')) return 'amex';
  if (m.includes('visa') || m.includes('mc') || m.includes('dscvr')) return 'mcVisaDscvr';
  return 'check';
}

const STRUCTURAL_STATE_KEYS = new Set(['_storageVersion', 'scheduleTime', 'agreements', 'orderSheets']);

const SCOPE_SEP = '::';
const qualify = (scopeId: string, fieldId: string) => `${scopeId}${SCOPE_SEP}${fieldId}`;

const markupToTierKey = (markupKey: string): keyof Tiers =>
  markupKey === '50' ? 'cost' : markupKey === '65' ? 'par' : 'retail';

const normName = (s: any): string =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function tierFor(details: any, markupKey: string, { schemas, paymentMethod, pricingConfig }: TierOpts): number {
  const tierKey = markupToTierKey(markupKey);
  const plan = paymentPlans[paymentMethod || 'check'] || {};
  const fee = Number(plan.fee) || 0;

  let checkRetail = 0;
  if (details?.totals && typeof details.totals === 'object') {
    checkRetail = Number(details.totals[tierKey]) || 0;
  } else if (Array.isArray(details?.entries) && details.entries.length > 0) {
    checkRetail = details.entries.reduce(
      (sum: number, e: any) => sum + (Number(e?.computed?.[tierKey]) || 0),
      0
    );
  } else {
    (schemas || []).forEach((schema: any) => {
      (schema?.categories || []).forEach((cat: any) => {
        const directFields = cat.directFields || cat.fields || [];
        directFields.forEach((field: any) => {
          const qty = Number(details?.[field.name] ?? details?.[field.id] ?? 0);
          if (qty > 0) checkRetail += qty * resolveFieldTierPrice(field, tierKey, pricingConfig);
        });
        (cat.sections || []).forEach((sec: any) => {
          (sec.fields || []).forEach((field: any) => {
            const qty = Number(details?.[field.name] ?? details?.[field.id] ?? 0);
            if (qty > 0) checkRetail += qty * resolveFieldTierPrice(field, tierKey, pricingConfig);
          });
        });
      });
    });
  }

  checkRetail = applyFeesToTier(checkRetail, tierKey, pricingConfig, { hasLineItems: checkRetail > 0 });

  let price = fee >= 1 ? checkRetail : checkRetail / (1 - fee);
  if (price < 200 && checkRetail > 0) price = 200;
  return Math.round(Number(price) || 0);
}

function schemaRetailBreakdown(
  details: any,
  schemas: any[],
  pricingConfig?: PricingConfig | null
): Array<{ field: string; qty: number; unit: number; subtotal: number }> {
  const rows: Array<{ field: string; qty: number; unit: number; subtotal: number }> = [];
  (schemas || []).forEach((schema: any) => {
    (schema?.categories || []).forEach((cat: any) => {
      const all = [
        ...(cat.directFields || cat.fields || []),
        ...((cat.sections || []) as any[]).flatMap((s: any) => s.fields || []),
      ];
      all.forEach((field: any) => {
        const qty = Number(details?.[field.name] ?? details?.[field.id] ?? 0);
        if (qty > 0) {
          const unit = resolveFieldTierPrice(field, 'retail', pricingConfig);
          if (unit > 0) {
            rows.push({
              field: field.label || field.name || field.id,
              qty,
              unit,
              subtotal: Math.round(qty * unit),
            });
          }
        }
      });
    });
  });
  return rows.sort((a, b) => b.subtotal - a.subtotal).slice(0, 20);
}

function describeBridge(
  dealCenterData: any,
  originalJobState: any,
  editedJobState: any,
  config: any,
  schemas: any[]
) {
  const flatPrev = extractQuantitiesByFieldId(originalJobState);
  const flatNext = extractQuantitiesByFieldId(editedJobState);
  const keyMap = buildFieldCalcKeyMap(config);
  const keyMapHits = Object.keys(keyMap).filter((qid) => flatNext[qid] !== undefined);
  const allocNext = buildAllocationQtyMap(editedJobState, config, dealCenterData);
  const allocPrev = buildAllocationQtyMap(originalJobState, config, dealCenterData);
  const fieldOptions = extractDealCenterFieldOptions(schemas);
  const prev = buildCalculatorDetails(dealCenterData, originalJobState, config, fieldOptions);
  const next = buildCalculatorDetails(dealCenterData, editedJobState, config, fieldOptions);
  const isNumericValue = (v: any) =>
    v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const overlayDiff = Object.keys(next)
    .filter((k) => {
      if (!isNumericValue(next[k]) && !isNumericValue(prev[k])) return false;
      return Number(next[k] ?? 0) !== Number(prev[k] ?? 0);
    })
    .slice(0, 25)
    .map((k) => ({ key: k, from: prev[k] ?? null, to: next[k] ?? null }));
  const allocMoved = Object.keys({ ...allocPrev, ...allocNext })
    .filter((ref) => Number(allocNext[ref] ?? 0) !== Number(allocPrev[ref] ?? 0))
    .map((ref) => ({ ref, from: allocPrev[ref] ?? 0, to: allocNext[ref] ?? 0 }));
  const schemaKeys = new Set<string>();
  (schemas || []).forEach((s: any) =>
    (s?.categories || []).forEach((c: any) => {
      [...(c.directFields || c.fields || []), ...((c.sections || []) as any[]).flatMap((x: any) => x.fields || [])]
        .forEach((f: any) => {
          if (f?.id) schemaKeys.add(String(f.id));
          if (f?.name) schemaKeys.add(String(f.name));
        });
    })
  );
  const allocDetail: any[] = [];
  (config?.verticals || []).forEach((v: any) =>
    (v.tabs || []).forEach((t: any) => {
      let tabState = editedJobState?.[v.id]?.[t.id];
      if (!tabState) {
        const vs = Object.values(editedJobState || {}).filter(
          (x: any) => x && typeof x === 'object' && !Array.isArray(x)
        );
        for (let i = 0; i < vs.length; i += 1) {
          if ((vs[i] as any)[t.id]) {
            tabState = (vs[i] as any)[t.id];
            break;
          }
        }
      }
      const allocs = collectAllocationFields(t);
      if (!allocs.length) return;
      allocs.forEach((a: any) => {
        let allocated: any = 0;
        let error = '';
        try {
          allocated =
            resolveAllocationMetrics(a, { field: a, tab: t, tabState, dealCenterData })?.allocated ?? 0;
        } catch (e: any) {
          error = String(e?.message || e);
        }
        allocDetail.push({
          tab: t.label || t.id,
          alloc: a.label || a.id,
          tabStateFound: Boolean(tabState),
          allocated,
          refs: collectAllocationDcRefs(a),
          ...(error ? { error } : {}),
        });
      });
    })
  );

  const priceable = overlayDiff.filter((d) => schemaKeys.has(d.key)).map((d) => d.key);

  return {
    flatPrev: Object.keys(flatPrev).length,
    flatNext: Object.keys(flatNext).length,
    keyMapSize: Object.keys(keyMap).length,
    keyMapHits: keyMapHits.length,
    allocRefs: Object.keys(allocNext).length,
    allocSample: Object.entries(allocNext).slice(0, 10),
    allocDetail,
    allocMoved,
    schemaKeyCount: schemaKeys.size,
    overlayDiff,
    overlayDiffPriceable: priceable,
    flatNextSample: Object.entries(flatNext).slice(0, 12),
    summary:
      `schemas=${(schemas || []).length} schemaKeys=${schemaKeys.size} ` +
      `alloc=${Object.keys(allocNext).length} allocMoved=${allocMoved.length} ` +
      `numDiff=${overlayDiff.length} priceable=${priceable.length}` +
      (allocMoved.length
        ? `\nMOVED ${allocMoved.slice(0, 4).map((m) => `${m.ref}:${m.from}→${m.to}`).join(' ')}`
        : '\nMOVED none — no allocation total changed') +
      (priceable.length ? `\nPRICEABLE ${priceable.slice(0, 4).join(' ')}` : ''),
  };
}

function tiersFromDetails(details: any, opts: TierOpts): Tiers {
  return {
    cost: tierFor(details, '50', opts),
    par: tierFor(details, '65', opts),
    retail: tierFor(details, '100', opts),
  };
}

export function computeStoredTiers(calculatorData: any, opts: TierOpts): Tiers {
  if (!calculatorData || typeof calculatorData !== 'object') {
    return { cost: 0, par: 0, retail: 0 };
  }
  return tiersFromDetails(calculatorData, opts);
}

function sumGrid(grid: any): number {
  return Object.values(grid || {}).reduce(
    (gs: number, stories: any) =>
      gs + Object.values(stories || {}).reduce((ss: number, v: any) => ss + (Number(v) || 0), 0),
    0
  );
}

function isNumericLike(v: any): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim() !== '' && !Number.isNaN(Number(v));
  return false;
}

export function extractQuantitiesByFieldId(jobState: any): Record<string, number> {
  const map: Record<string, number> = {};

  const add = (scopeId: string, fieldId: string, val: any) => {
    const num = Number(val);
    if (!fieldId || !Number.isFinite(num) || num === 0) return;
    const qk = qualify(scopeId, fieldId);
    map[qk] = (map[qk] || 0) + num;
  };

  const ingestFieldMap = (scopeId: string, obj: any) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.entries(obj).forEach(([k, v]) => {
      if (k === 'colorValues') return;
      if (isNumericLike(v)) {
        add(scopeId, k, v);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const total = sumGrid(v);
        if (total) add(scopeId, k, total);
      }
    });
  };

  Object.entries(jobState || {}).forEach(([vKey, vertical]: [string, any]) => {
    if (STRUCTURAL_STATE_KEYS.has(vKey)) return;
    if (!vertical || typeof vertical !== 'object') return;

    Object.entries(vertical).forEach(([tabId, tab]: [string, any]) => {
      if (!tab || typeof tab !== 'object') return;

      Object.entries(tab.sectionFields || {}).forEach(([secId, secState]) =>
        ingestFieldMap(secId, secState)
      );

      Object.entries(tab.comboGroups || {}).forEach(([secId, group]: [string, any]) => {
        (group?.combinations || []).forEach((combo: any) => ingestFieldMap(secId, combo));
        if (group?.sectionState) ingestFieldMap(secId, group.sectionState);
      });

      const rest: Record<string, any> = {};
      Object.keys(tab).forEach((k) => {
        if (k !== 'sectionFields' && k !== 'comboGroups') rest[k] = (tab as any)[k];
      });
      const combinations = rest.combinations;
      delete rest.combinations;
      ingestFieldMap(tabId, rest);
      (combinations || []).forEach((combo: any) => ingestFieldMap(tabId, combo));
    });
  });

  return map;
}

function buildFieldCalcKeyMap(config: any): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  const walk = (fields: any[], scopeId: string) =>
    (fields || []).forEach((f: any) => {
      if (f?.id) {
        const keys = new Set<string>();
        const dcs = f.dcFields?.length ? f.dcFields : f.dcField ? [f.dcField] : [];
        dcs.forEach((d: string) => d && keys.add(d));
        if (f.key) keys.add(f.key);
        if (f.name) keys.add(f.name);
        keys.add(f.id);
        keys.add(String(f.id).split('__')[0]);
        map[qualify(scopeId, f.id)] = keys;
      }
      if (f?.fields) walk(f.fields, scopeId);
    });
  (config?.verticals || []).forEach((v: any) =>
    (v.tabs || []).forEach((t: any) => {
      walk(t.fields, t.id);
      (t.sections || []).forEach((s: any) => walk(s.fields, s.id));
      if (t.combinations?.fields) walk(t.combinations.fields, t.id);
      (t.combinationGroups || []).forEach((cg: any) => walk(cg.fields, cg.id));
    })
  );
  return map;
}

function collectDealCenterKeysForFieldId(fieldId: string, fieldOptions: DealCenterFieldOption[]): string[] {
  const keys = new Set<string>();
  if (!fieldId) return [];
  keys.add(fieldId);
  const opt =
    (fieldOptions || []).find((o) => o.key === fieldId || o.fieldId === fieldId) ||
    (fieldOptions || []).find((o) => o.legacyKey && o.legacyKey === fieldId);
  if (opt) {
    keys.add(opt.key);
    if (opt.legacyKey) keys.add(opt.legacyKey);
  }
  return Array.from(keys);
}

function collectAllocationDcRefs(alloc: any): string[] {
  const refs = new Set<string>();
  const push = (r: any) => {
    if (r) refs.add(r);
  };
  push(alloc?.dcField);
  (alloc?.dcFields || []).forEach(push);
  (alloc?.metrics || []).forEach((m: any) => {
    const vs = m?.valueSource;
    if (vs && vs.type === 'dealCenter') {
      push(vs.dcField);
      (vs.dcFields || []).forEach(push);
    }
  });
  return [...refs];
}

function buildAllocationQtyMap(jobState: any, config: any, dealCenterData: any = {}): Record<string, number> {
  const map: Record<string, number> = {};
  const add = (ref: any, qty: number) => {
    if (ref === undefined || ref === null || ref === '') return;
    map[ref] = (map[ref] || 0) + qty;
  };

  (config?.verticals || []).forEach((v: any) =>
    (v.tabs || []).forEach((t: any) => {
      let tabState = jobState?.[v.id]?.[t.id];
      if (!tabState) {
        const verticals = Object.values(jobState || {}).filter(
          (x: any) => x && typeof x === 'object' && !Array.isArray(x)
        );
        for (let i = 0; i < verticals.length; i += 1) {
          if ((verticals[i] as any)[t.id]) {
            tabState = (verticals[i] as any)[t.id];
            break;
          }
        }
      }
      if (!tabState) return;
      const allocFields = collectAllocationFields(t);
      allocFields.forEach((alloc: any) => {
        let allocated = 0;
        try {
          allocated =
            resolveAllocationMetrics(alloc, { field: alloc, tab: t, tabState, dealCenterData })
              ?.allocated || 0;
        } catch {
          allocated = 0;
        }
        if (!allocated) return;
        collectAllocationDcRefs(alloc).forEach((ref) => {
          add(ref, allocated);
          add(normName(ref), allocated);
        });
      });
    })
  );

  return map;
}

function buildBuilderQtyIndex(jobState: any, config: any, dealCenterData: any = {}): {
  byDcField: Record<string, number>;
  byId: Record<string, number>;
  byName: Record<string, number>;
  bySection: Record<string, number>;
} {
  const flat = extractQuantitiesByFieldId(jobState);
  const byDcField: Record<string, number> = {};
  const byId: Record<string, number> = {};
  const byName: Record<string, number> = {};
  const bySection: Record<string, number> = {};

  const addSum = (bucket: Record<string, number>, key: any, qty: number) => {
    if (key === undefined || key === null || key === '') return;
    bucket[key] = (bucket[key] || 0) + qty;
  };

  const walk = (fields: any[], sectionLabel: string, scopeId: string) =>
    (fields || []).forEach((f: any) => {
      if (f?.id) {
        const qty = flat[qualify(scopeId, f.id)];
        if (qty !== undefined) {
          const dcs = f.dcFields?.length ? f.dcFields : f.dcField ? [f.dcField] : [];
          dcs.forEach((d: string) => {
            addSum(byDcField, d, qty);
            addSum(byDcField, normName(d), qty);
          });
          addSum(byId, f.id, qty);
          const base = String(f.id).split('__')[0];
          if (base !== f.id) addSum(byId, base, qty);
          addSum(byName, normName(f.label), qty);
          addSum(byName, normName(f.name), qty);
          addSum(byName, normName(f.key), qty);
          addSum(bySection, normName(sectionLabel), qty);
        }
      }
      if (f?.fields) walk(f.fields, sectionLabel, scopeId);
    });

  (config?.verticals || []).forEach((v: any) =>
    (v.tabs || []).forEach((t: any) => {
      walk(t.fields, t.label, t.id);
      (t.sections || []).forEach((s: any) => walk(s.fields, s.label, s.id));
      if (t.combinations?.fields) walk(t.combinations.fields, t.label, t.id);
      (t.combinationGroups || []).forEach((cg: any) => walk(cg.fields, cg.label || cg.id, cg.id));
    })
  );

  const allocMap = buildAllocationQtyMap(jobState, config, dealCenterData);
  Object.entries(allocMap).forEach(([ref, qty]) => addSum(byDcField, ref, qty));

  return { byDcField, byId, byName, bySection };
}

export function rebuildCalculatorEntries(
  calculatorData: any,
  editedJobState: any,
  originalJobState: any,
  config: any,
  dealCenterData: any = {}
): { entries: any[]; changed: boolean } | null {
  const entries = calculatorData?.entries;
  if (!Array.isArray(entries) || !entries.length || !editedJobState || !config) return null;

  const editedIdx = buildBuilderQtyIndex(editedJobState, config, dealCenterData);
  const originalIdx = originalJobState
    ? buildBuilderQtyIndex(originalJobState, config, dealCenterData)
    : editedIdx;
  let changed = false;

  const resolveQty = (idx: ReturnType<typeof buildBuilderQtyIndex>, entry: any): number | undefined => {
    const fid = entry?.fieldId;
    if (fid !== undefined && fid !== null && fid !== '') {
      if (idx.byDcField[fid] !== undefined) return idx.byDcField[fid];
      if (idx.byId[fid] !== undefined) return idx.byId[fid];
      const fidN = normName(fid);
      if (fidN && idx.byDcField[fidN] !== undefined) return idx.byDcField[fidN];
      if (fidN && idx.byName[fidN] !== undefined) return idx.byName[fidN];
    }
    const cands = [entry?.name, entry?.label].map(normName).filter(Boolean);
    for (let i = 0; i < cands.length; i += 1) {
      if (idx.byName[cands[i]] !== undefined) return idx.byName[cands[i]];
    }
    for (let i = 0; i < cands.length; i += 1) {
      if (idx.byDcField[cands[i]] !== undefined) return idx.byDcField[cands[i]];
    }
    for (let i = 0; i < cands.length; i += 1) {
      if (idx.bySection[cands[i]] !== undefined) return idx.bySection[cands[i]];
    }
    return undefined;
  };

  const nextEntries = entries.map((e: any) => {
    const editedQty = resolveQty(editedIdx, e);
    if (editedQty === undefined) return e;
    const originalQty = resolveQty(originalIdx, e) ?? 0;
    if (editedQty === originalQty) return e;

    const inputValue = Number(e.inputValue) || 0;
    const newQty = Math.max(0, editedQty);

    const unit = e.pricingAtTimeOfEntry && typeof e.pricingAtTimeOfEntry === 'object'
      ? e.pricingAtTimeOfEntry
      : inputValue
        ? {
            cost: (Number(e.computed?.cost) || 0) / inputValue,
            par: (Number(e.computed?.par) || 0) / inputValue,
            retail: (Number(e.computed?.retail) || 0) / inputValue,
          }
        : null;
    if (!unit) return e;

    changed = true;
    return {
      ...e,
      inputValue: newQty,
      computed: {
        cost: newQty * (Number(unit.cost) || 0),
        par: newQty * (Number(unit.par) || 0),
        retail: newQty * (Number(unit.retail) || 0),
      },
    };
  });

  return { entries: nextEntries, changed };
}

export function buildCalculatorDetails(
  dealCenterData: any,
  jobState: any,
  config: any,
  fieldOptions: DealCenterFieldOption[]
): Record<string, any> {
  const base: Record<string, any> = { ...(dealCenterData || {}) };
  delete base.__fieldOptions;
  if (!jobState || !config) return base;

  const flat = extractQuantitiesByFieldId(jobState);
  const keyMap = buildFieldCalcKeyMap(config);
  const perKey: Record<string, number> = {};
  Object.entries(keyMap).forEach(([qid, keys]) => {
    const val = flat[qid];
    if (val === undefined) return;
    keys.forEach((k) => {
      perKey[k] = (perKey[k] || 0) + val;
    });
  });
  Object.entries(perKey).forEach(([k, v]) => {
    base[k] = v;
    collectDealCenterKeysForFieldId(k, fieldOptions).forEach((alias) => {
      if (alias !== k) base[alias] = v;
    });
  });
  const allocMap = buildAllocationQtyMap(jobState, config, dealCenterData);
  Object.entries(allocMap).forEach(([ref, qty]) => {
    if (!qty) return;
    base[ref] = qty;
    collectDealCenterKeysForFieldId(ref, fieldOptions).forEach((alias) => {
      if (alias !== ref) base[alias] = qty;
    });
  });
  return base;
}

export function clampToCostFloor(price: number, cost: number): { price: number; clamped: boolean } {
  const floor = Number(cost) || 0;
  const value = Number(price) || 0;
  if (floor > 0 && value < floor) return { price: floor, clamped: true };
  return { price: value, clamped: false };
}

export function computeEditedTiers({
  calculatorData,
  dealCenterData,
  config,
  originalJobState,
  editedJobState,
  schemas = [],
  paymentMethod = 'check',
  originalContractPrice,
  isLowesLead = false,
  pricingConfig = null,
}: {
  calculatorData: any;
  dealCenterData?: any;
  config?: any;
  originalJobState?: any;
  editedJobState?: any;
  schemas?: any[];
  paymentMethod?: string;
  isLowesLead?: boolean;
  originalContractPrice?: any;
  pricingConfig?: any;
}): EditedTiersResult {
  const opts: TierOpts = { schemas, paymentMethod, isLowesLead, pricingConfig };
  const clamp = (v: number) => Math.max(0, Math.round(v));
  const rawStored = computeStoredTiers(calculatorData, opts);
  const storedHasValue = !!(rawStored.cost || rawStored.par || rawStored.retail);
  const contractRetail = parsePrice(originalContractPrice);
  const withContractFallback = (t: Tiers): Tiers =>
    t.cost || t.par || t.retail
      ? t
      : contractRetail
        ? { cost: 0, par: 0, retail: contractRetail }
        : t;

  const hasSchema = Array.isArray(schemas) && schemas.length > 0;
  if (hasSchema && config && (editedJobState || originalJobState)) {
    const fieldOptions = extractDealCenterFieldOptions(schemas);
    const stripped = (d: any) => ({ ...d, totals: undefined, entries: undefined });
    const prevDetails = buildCalculatorDetails(dealCenterData, originalJobState, config, fieldOptions);
    const nextDetails = buildCalculatorDetails(dealCenterData, editedJobState, config, fieldOptions);
    const schemaPrev = tiersFromDetails(stripped(prevDetails), opts);
    const schemaNext = tiersFromDetails(stripped(nextDetails), opts);
    const delta: Tiers = {
      cost: schemaNext.cost - schemaPrev.cost,
      par: schemaNext.par - schemaPrev.par,
      retail: schemaNext.retail - schemaPrev.retail,
    };
    let debugLine: string | undefined;
    if (DEAL_PRICING_DEBUG) {
      const breakdown = schemaRetailBreakdown(stripped(prevDetails), schemas, opts.pricingConfig);
      // eslint-disable-next-line no-console
      console.warn('[dealEditPricing]', JSON.stringify({ stored: rawStored, schemaPrev, schemaNext, delta, topRetailFields: breakdown }));
      const bridge = describeBridge(dealCenterData, originalJobState, editedJobState, config, schemas);
      debugLine = bridge.summary;
      // eslint-disable-next-line no-console
      console.warn('[dealEditPricing:bridge]', JSON.stringify(bridge));
    }
    const previous = withContractFallback(storedHasValue ? rawStored : schemaPrev);
    return {
      debug: debugLine,
      previous,
      next: {
        cost: clamp(previous.cost + delta.cost),
        par: clamp(previous.par + delta.par),
        retail: clamp(previous.retail + delta.retail),
      },
      delta,
      changed: delta.cost !== 0 || delta.par !== 0 || delta.retail !== 0,
    };
  }

  const rebuilt = rebuildCalculatorEntries(calculatorData, editedJobState, originalJobState, config, dealCenterData);
  if (rebuilt) {
    const calcNoTotals = { ...calculatorData, totals: undefined };
    const entriesPrev = tiersFromDetails(
      { ...calcNoTotals, entries: calculatorData.entries },
      opts
    );
    const entriesNext = tiersFromDetails({ ...calcNoTotals, entries: rebuilt.entries }, opts);
    const delta: Tiers = {
      cost: entriesNext.cost - entriesPrev.cost,
      par: entriesNext.par - entriesPrev.par,
      retail: entriesNext.retail - entriesPrev.retail,
    };
    const previous = withContractFallback(storedHasValue ? rawStored : entriesPrev);
    return {
      previous,
      next: {
        cost: clamp(previous.cost + delta.cost),
        par: clamp(previous.par + delta.par),
        retail: clamp(previous.retail + delta.retail),
      },
      delta,
      changed: rebuilt.changed,
    };
  }

  const prevDc = tiersFromDetails(
    buildCalculatorDetails(dealCenterData, originalJobState, config, []),
    opts
  );
  const nextDc = tiersFromDetails(
    buildCalculatorDetails(dealCenterData, editedJobState, config, []),
    opts
  );
  const delta: Tiers = {
    cost: nextDc.cost - prevDc.cost,
    par: nextDc.par - prevDc.par,
    retail: nextDc.retail - prevDc.retail,
  };
  const previous = withContractFallback(storedHasValue ? rawStored : prevDc);
  return {
    previous,
    next: {
      cost: clamp(previous.cost + delta.cost),
      par: clamp(previous.par + delta.par),
      retail: clamp(previous.retail + delta.retail),
    },
    delta,
    changed: delta.cost !== 0 || delta.par !== 0 || delta.retail !== 0,
  };
}

export function getMarkupInfo(
  price: any,
  tiers: Tiers | undefined | null,
  tierLabels?: Record<string, string> | null
): { text: string; markupPct: number | null; baseKey: keyof Tiers | null } {
  const p = Number(price) || 0;
  if (p === 0 || !tiers?.retail) return { text: '—', markupPct: null, baseKey: null };
  const ordered: [keyof Tiers, number][] = (
    [
      ['cost', tiers.cost],
      ['par', tiers.par],
      ['retail', tiers.retail],
    ] as [keyof Tiers, number][]
  )
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => a[1] - b[1]);
  if (!ordered.length) return { text: '—', markupPct: null, baseKey: null };
  let [baseKey, baseVal] = ordered[0];
  ordered.forEach(([key, val]) => {
    if (p >= val) {
      baseKey = key;
      baseVal = val;
    }
  });
  const pct = baseVal > 0 ? Math.round(((p - baseVal) / baseVal) * 100) : 0;
  const upperKey = String(baseKey).toUpperCase();
  const text = tierLabels ? (tierLabels[baseKey] || upperKey).toUpperCase() : upperKey;
  return { text, markupPct: pct, baseKey };
}
