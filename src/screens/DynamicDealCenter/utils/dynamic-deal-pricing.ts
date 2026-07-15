// Pricing helpers for the DYNAMIC deal-edit flow (mobile).
//
// FAITHFUL port of web `src/sections/deal/components/dynamic-deal-pricing.js`.

import { paymentPlans } from '../../../utils/calculator/payment-plans';
import { resolveAllocationMetrics } from '../../../utils/dynamic-job-builder/engine/allocation-value-resolver';
import { collectAllocationFields } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import { extractDealCenterFieldOptions, type DealCenterFieldOption } from './build-deal-center-data';

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
}

interface TierOpts {
  schemas: any[];
  paymentMethod?: string;
  isLowesLead?: boolean;
  pricingConfig?: any;
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
function tierFor(details: any, markupKey: string, { schemas, paymentMethod, isLowesLead: _isLowesLead, pricingConfig: _pricingConfig }: TierOpts): number {
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
          if (qty > 0) checkRetail += qty * Number(field.price?.[tierKey] || 0);
        });
        (cat.sections || []).forEach((sec: any) => {
          (sec.fields || []).forEach((field: any) => {
            const qty = Number(details?.[field.name] ?? details?.[field.id] ?? 0);
            if (qty > 0) checkRetail += qty * Number(field.price?.[tierKey] || 0);
          });
        });
      });
    });
  }

  let price = fee >= 1 ? checkRetail : checkRetail / (1 - fee);
  if (price < 200 && checkRetail > 0) price = 200;
  return Math.round(Number(price) || 0);
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

  // Overlay allocation-derived quantities.
  const allocMap = buildAllocationQtyMap(jobState, config, dealCenterData);
  Object.entries(allocMap).forEach(([ref, qty]) => {
    addSum(byDcField, ref, qty);
    addSum(byDcField, normName(ref), qty);
  });

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
 * Stored cost/par/retail tiers, from `totals` (mobile RolloutView's source), with a
 * contract-price retail fallback so the "Previous" card is never blank on legacy
 * deals that predate stored totals.
 */
function storedTiersWithFallback(calculatorData: any, opts: TierOpts, originalContractPrice?: any): Tiers {
  const stored = computeStoredTiers(calculatorData, opts);
  if (stored.cost || stored.par || stored.retail) return stored;
  const contract = parsePrice(originalContractPrice);
  return contract ? { cost: 0, par: 0, retail: contract } : stored;
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
  const stored = storedTiersWithFallback(calculatorData, opts, originalContractPrice);

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
    const previous = stored.retail || stored.par || stored.cost ? stored : schemaPrev;
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
    const previous = stored.retail || stored.par || stored.cost ? stored : entriesPrev;
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
  const previous = stored.retail || stored.par || stored.cost ? stored : prevDc;
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

/** COST/PAR/RETAIL markup label + % vs the closest tier, for the price input badge. */
export function getMarkupInfo(
  price: any,
  tiers: Tiers | undefined | null,
  tierLabels?: Record<string, string> | null
): { text: string; markupPct: number | null } {
  const p = Number(price) || 0;
  if (p === 0 || !tiers?.retail) return { text: '—', markupPct: null };
  const diffs: Record<string, number> = {
    RETAIL: Math.abs(p - tiers.retail),
    PAR: Math.abs(p - tiers.par),
    COST: Math.abs(p - tiers.cost),
  };
  const base = Object.keys(diffs).reduce((a, b) => (diffs[a] <= diffs[b] ? a : b));
  const baseVal = { RETAIL: tiers.retail, PAR: tiers.par, COST: tiers.cost }[base] || 0;
  const pct = baseVal > 0 ? Math.round(((p - baseVal) / baseVal) * 100) : 0;
  const text = tierLabels ? (tierLabels[base.toLowerCase()] || base).toUpperCase() : base;
  return { text, markupPct: pct };
}
