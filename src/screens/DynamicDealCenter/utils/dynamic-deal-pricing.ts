// Pricing helpers for the DYNAMIC deal-edit flow (mobile).
//
// FAITHFUL port of web `src/sections/deal/components/dynamic-deal-pricing.js`.

import { paymentPlans } from '../../../utils/calculator/payment-plans';
import { resolveAllocationMetrics } from '../../../utils/dynamic-job-builder/engine/allocation-value-resolver';
import { collectAllocationFields } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import { extractDealCenterFieldOptions, type DealCenterFieldOption } from './build-deal-center-data';
import { resolveFieldTierPrice, applyFeesToTier, type PricingConfig } from './pricing-config-util';

// TEMP diagnostic — flip to true to trace the [dealEditPricing] delta computation
// (mirrors web's `MYDEALFLOW_DEBUG`; logs schemaPrev/schemaNext/delta + changed qty).
// ⚠️ TEMPORARILY ON to diagnose "price doesn't change when the build changes".
// Set back to `false` before release — it logs on every keystroke in the wizard.
// ⚠️ Keep FALSE in anything that ships. When true, every recompute on the Job Price
// step runs `schemaRetailBreakdown` + `describeBridge` (which rebuilds the calculator
// details twice and walks every allocation) and emits two `console.warn`s carrying
// large JSON — on every keystroke. Flip to `true` only while diagnosing a pricing
// bridge issue; `describeBridge().summary` is the line to read (lead with `allocMoved`).
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
  /** Diagnostic line for the on-screen strip. Only set while `DEAL_PRICING_DEBUG`. */
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

/** Map a UI balance-payment-method (key or label) to the tier engine's payment key. */
export function resolveTierPaymentMethod(balanceMethod: any): 'amex' | 'mcVisaDscvr' | 'check' {
  const m = String(balanceMethod || '').toLowerCase();
  if (m.includes('amex')) return 'amex';
  if (m.includes('visa') || m.includes('mc') || m.includes('dscvr')) return 'mcVisaDscvr';
  return 'check';
}

const STRUCTURAL_STATE_KEYS = new Set(['_storageVersion', 'scheduleTime', 'agreements', 'orderSheets']);

// Section-qualified keys so same-id fields in different sections aren't cross-summed.
const SCOPE_SEP = '::';
const qualify = (scopeId: string, fieldId: string) => `${scopeId}${SCOPE_SEP}${fieldId}`;

const markupToTierKey = (markupKey: string): keyof Tiers =>
  markupKey === '50' ? 'cost' : markupKey === '65' ? 'par' : 'retail';

const normName = (s: any): string =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * One tier's price for a `details` object, mirroring web `calculateResultUtil`'s
 * schema-based branch: read `details.totals` when present (the stored calculator),
 * else sum `details.entries[].computed`, else price the schema fields by looking up
 * each field's quantity in `details` (`field.name`/`field.id`) × `field.price[tier]`.
 * Then gross up by the balance method's bank fee and apply the $200 job minimum —
 * exactly the web tier engine, for both the stored (`previous`) and the
 * schema-priced (`next` delta) computations.
 */
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
    // Price each schema field's quantity via `resolveFieldTierPrice` (web
    // `calculateResultUtil`), NOT a bare `field.price[tierKey]` read: a schema that
    // prices a field at ONE tier (usually retail) and leaves cost/par blank relies
    // on the company config's derivation rule to fill the others. The old direct
    // read returned 0 for those derived tiers, so COST/PAR stayed $0.
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

  // Company-authored static fees (web `applyFeesToTier`), gated on line items so a
  // fee alone never floors an empty job to $200.
  checkRetail = applyFeesToTier(checkRetail, tierKey, pricingConfig, { hasLineItems: checkRetail > 0 });

  let price = fee >= 1 ? checkRetail : checkRetail / (1 - fee);
  if (price < 200 && checkRetail > 0) price = 200;
  return Math.round(Number(price) || 0);
}

/**
 * DIAGNOSTIC: the per-field RETAIL contributions for a `details` map, biggest first.
 * Mirrors the exact lookup `tierFor` uses (`details[field.name] ?? details[field.id]`
 * × retail price) so the log shows precisely which field(s) sum to the retail tier —
 * used to trace a garbage tier back to the stray quantity that produced it.
 */
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

/**
 * DIAGNOSTIC (gated on `DEAL_PRICING_DEBUG`): report which link of the
 * build→calculator bridge produced — or failed to produce — a quantity. Every
 * value here is derived from the same helpers the real path uses, so it cannot
 * disagree with them. See the call site for how to read it.
 */
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
  // ⚠️ NUMERIC keys only. This filter was `Number(next[k]) !== Number(prev[k])`,
  // which counts every TEXT field as changed — `Number('Micro Mesh')` and
  // `Number('Versa')` are both NaN and `NaN !== NaN` is true. That inflated the
  // reported diff (25 on a build where no quantity had moved at all) and made a
  // correctly-unchanged price look like a broken bridge.
  const isNumericValue = (v: any) =>
    v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const overlayDiff = Object.keys(next)
    .filter((k) => {
      if (!isNumericValue(next[k]) && !isNumericValue(prev[k])) return false;
      return Number(next[k] ?? 0) !== Number(prev[k] ?? 0);
    })
    .slice(0, 25)
    .map((k) => ({ key: k, from: prev[k] ?? null, to: next[k] ?? null }));
  // THE decisive signal for "why didn't the price move": which allocation totals
  // actually differ between the original and the edited build. If this is empty,
  // the rep changed nothing the config maps to a priced quantity — which is a
  // CONFIG fact, not a broken bridge.
  const allocMoved = Object.keys({ ...allocPrev, ...allocNext })
    .filter((ref) => Number(allocNext[ref] ?? 0) !== Number(allocPrev[ref] ?? 0))
    .map((ref) => ({ ref, from: allocPrev[ref] ?? 0, to: allocNext[ref] ?? 0 }));
  // Every quantity key the SCHEMA can actually price, so an overlay key that is not
  // in this set is a ref the schema will silently ignore.
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
  // Per-allocation detail (web's `>>mydealflow alloc`): for every allocation the
  // config declares, whether its tab state was found, what the metric engine
  // resolved as "used", and which calculator refs that total maps onto. An
  // allocation whose `optionBinding` doesn't match the rep's selection (e.g. a 5"
  // gutter allocation while the combo says 7") legitimately resolves 0 — that is
  // NOT a bug, and this is how to tell it apart from a broken binding.
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
    /**
     * One line for the on-screen strip. `allocMoved` is the one to read: empty
     * means no allocation total changed, so there is nothing for the schema to
     * re-price and an unchanged tier is CORRECT.
     */
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

/**
 * Previous/stored tiers from the deal's own calculator snapshot. Uses the
 * calculator's `totals`/`entries` exactly as the deal-center result screen does.
 */
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

/**
 * Flatten a runtime dynamic job state into `{ "<scopeId>::<fieldId>": quantity }`,
 * summing numeric leaves and location grids within a section. Scoping by section
 * prevents same-id fields in different sections from being cross-summed.
 */
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

      // Tab-level direct fields / legacy tab-level combinations — skip sectionFields/comboGroups
      // as they are handled above (sectionFields) and comboGroups.
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

/**
 * Map every config field id (section-qualified) → the set of calculator/schema
 * keys it feeds: its `dcField`/`dcFields`, plus its own key/name/id (and the part
 * before `__`). Scoped by section id to match `extractQuantitiesByFieldId`.
 */
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

/** Resolve all schema keys a field id should be stored under (id + legacy alias). */
function collectDealCenterKeysForFieldId(fieldId: string, fieldOptions: DealCenterFieldOption[]): string[] {
  const keys = new Set<string>();
  if (!fieldId) return [];
  keys.add(fieldId);
  const opt = (fieldOptions || []).find((o) => o.key === fieldId || o.fieldId === fieldId);
  if (opt) {
    keys.add(opt.key);
    if (opt.legacyKey) keys.add(opt.legacyKey);
  }
  return Array.from(keys);
}

/**
 * Every calculator field ref an allocation maps to: its own `dcField`/`dcFields`
 * plus the dc refs declared on its metrics' `valueSource`.
 */
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

/**
 * Compute allocation-derived calculator quantities from a job state: for every
 * allocation in the config, resolve its "used" total via the builder's OWN metric
 * engine (honoring optionBinding / contributor / dependency rules) and map that
 * total onto the allocation's calculator refs. This is how gutters/downspouts —
 * which have no direct `dcField` — reach the schema pricing path.
 */
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
        // The runtime vertical key may differ from the config id — locate the
        // tab's state by tab id under any vertical entry.
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

/**
 * Index the edited build's quantities under every key a calculator entry might
 * match on: by dcField (authoritative), by field id, by normalized name, and
 * by section label. Quantities feeding the same key across sections are summed.
 */
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

  // Overlay allocation-derived quantities. `buildAllocationQtyMap` ALREADY emits
  // both the raw ref and its normalized form as separate keys, so re-adding
  // `normName(ref)` here counted the normalized key up to three times over.
  const allocMap = buildAllocationQtyMap(jobState, config, dealCenterData);
  Object.entries(allocMap).forEach(([ref, qty]) => addSum(byDcField, ref, qty));

  return { byDcField, byId, byName, bySection };
}

/**
 * Rebuild calculator entries from the edited build: for each priced entry,
 * find its build quantity by the strongest available link (dcField, id,
 * name, section) and recompute tiers. Returns null when the calculator has
 * no entries array.
 */
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

/**
 * Reconstruct the calculator quantity map (keyed by schema field id/name) from the
 * deal-center baseline overlaid with the build's current field values. Editing a
 * formerly-locked deal-center field (which carries `dcField`) rewrites that
 * calculator quantity; allocation-derived quantities (gutters/downspouts) are
 * overlaid too — so the schema pricing path recomputes the tiers.
 */
export function buildCalculatorDetails(
  dealCenterData: any,
  jobState: any,
  config: any,
  fieldOptions: DealCenterFieldOption[]
): Record<string, any> {
  const base: Record<string, any> = { ...(dealCenterData || {}) };
  // Mobile dealCenterData carries no `__fieldOptions`, but strip defensively.
  delete base.__fieldOptions;
  if (!jobState || !config) return base;

  const flat = extractQuantitiesByFieldId(jobState);
  const keyMap = buildFieldCalcKeyMap(config);
  // Accumulate per calculator key so several sections feeding the SAME calc key
  // (shared `dcField`) sum instead of clobbering.
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
    // Propagate to every schema alias (legacy name) so the schema pricing path
    // finds the overlaid quantity regardless of which name the schema field uses.
    collectDealCenterKeysForFieldId(k, fieldOptions).forEach((alias) => {
      if (alias !== k) base[alias] = v;
    });
  });
  // Overlay allocation-derived quantities (gutter footage, downspouts, …).
  const allocMap = buildAllocationQtyMap(jobState, config, dealCenterData);
  Object.entries(allocMap).forEach(([ref, qty]) => {
    if (qty) base[ref] = qty;
  });
  return base;
}

/**
 * Full guided-pricing recompute (web `computeEditedTiers`). `previous` = the deal's
 * actual stored tiers; `next` = `previous + delta`, where the delta is the edited
 * build priced against the calculator SCHEMA minus the original build so priced.
 */
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
  // Use the deal's REAL stored tiers to decide `previous`; DON'T let the
  // contract-price fallback stand in, or it poisons the branch selection below.
  // Mobile never persists LFCalculator (see DynamicDealEditScreen note), so on a
  // dynamic deal `computeStoredTiers` is all-zero and we must price `previous`
  // from the schema instead — otherwise COST/PAR read $0 and only RETAIL (the
  // contract price) shows on the Previous card.
  const rawStored = computeStoredTiers(calculatorData, opts);
  const storedHasValue = !!(rawStored.cost || rawStored.par || rawStored.retail);
  const contractRetail = parsePrice(originalContractPrice);
  // Contract-price fallback (RETAIL only) — applied ONLY when nothing else priced
  // the build, so a legacy deal with neither totals nor schema-priceable build is
  // never left fully blank.
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
      // Per-field retail breakdown of the PREVIOUS build — the biggest contributors
      // to schemaPrev.retail. A garbage tier (e.g. $268k on a $500 job) shows up here
      // as one field with an absurd `qty` (a stray large value the schema priced) or
      // as far more line items than the rep actually entered.
      const breakdown = schemaRetailBreakdown(stripped(prevDetails), schemas, opts.pricingConfig);
      // eslint-disable-next-line no-console
      console.warn('[dealEditPricing]', JSON.stringify({ stored: rawStored, schemaPrev, schemaNext, delta, topRetailFields: breakdown }));
      // WHY the delta is what it is. `delta: 0` with a real build edit means the
      // bridge found nothing — this says at which link it broke:
      //   flatNext 0            → the edited job state never reached here
      //   keyMapHits 0          → config field ids don't line up with the state's
      //                           section-qualified keys (scope drift)
      //   allocRefs 0           → no allocation mapped a quantity to a calculator ref
      //   allocMoved []         → the build changed nothing that maps to a priced
      //                           quantity. NOT a bridge failure — read the config
      //                           before touching code (see the LeafFilter note in
      //                           CLAUDE.md: only grid column sums move that tab).
      //   priceable 0 w/ moves  → refs moved but aren't schema field ids/names
      const bridge = describeBridge(dealCenterData, originalJobState, editedJobState, config, schemas);
      debugLine = bridge.summary;
      // eslint-disable-next-line no-console
      console.warn('[dealEditPricing:bridge]', JSON.stringify(bridge));
    }
    // Real stored totals win; otherwise the schema-priced ORIGINAL build (which
    // carries COST/PAR/RETAIL), and only then the bare contract-price fallback.
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

  // Entry-based rebuild path: when calculator has entries but no schemas,
  // rebuild entries from the edited build and recompute tiers.
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

  // Schema-overlay bridge fallback: price build fields against schema.
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

/**
 * COST/PAR/RETAIL markup label + % for the price input badge. FAITHFUL port of web
 * `dynamic-deal-edit-modal.js:getMarkupInfo`. Express the price as a POSITIVE
 * premium over the nearest LOWER tier (order tiers low→high, pick the highest tier
 * the price is at or above), NOT the nearest tier by absolute distance. This is what
 * keeps the RETAIL % consistent between the Previous and New cards: Auto Adjust sets
 * `newContract = next.retail × (originalContract / previous.retail)`, so when the
 * original price sits at/above retail both cards read RETAIL and the SAME +X%
 * (X = (originalContract − previous.retail) / previous.retail). The old nearest-tier
 * logic could snap the New badge to a different tier and show a different %.
 */
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
