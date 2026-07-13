// Pricing helpers for the DYNAMIC deal-edit flow (mobile).
//
// FAITHFUL port of web `src/sections/deal/components/dynamic-deal-pricing.js`.
// The dynamic job builder itself computes NO dollar price — money lives on the
// deal-center calculator (schema `field.price` × quantities). For the guided
// "Job Price" (rollout reconfirm) step we therefore:
//   1. `previous` = the deal's CURRENT stored cost/PAR/retail tiers (what the
//      customer is paying), from the saved calculator (`totals`/`entries`), grossed
//      up by the balance payment method's bank fee — exactly as web's tier engine.
//   2. `next` = `previous + delta`, where `delta` is the difference between the
//      edited and original dynamic build, PRICED THROUGH THE CALCULATOR SCHEMA
//      (each build quantity — direct `dcField` fields AND allocation-derived
//      gutter/downspout footage — mapped onto the schema fields and summed at
//      `field.price[tier]`). Unedited fields cancel; edited fields drive the delta.
//      `changed` is true only when the delta is non-zero.
//
// Unlike web this does NOT touch the shared `calculation-results-util.ts` (used by
// RolloutView/Summary): the schema-sum pricing is implemented self-contained here,
// which is exactly the branch web's `computeEditedTiers` exercises (it strips
// `totals`/`entries` so only the schema path runs). When the backend supplies no
// schemas (should not happen in the configured dynamic flow — Phase B requires
// them) the delta safely degrades to 0 and the rep sets the price manually.

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
function tierFor(details: any, markupKey: string, { schemas, paymentMethod }: TierOpts): number {
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

      // Tab-level direct fields / legacy tab-level combinations.
      const { sectionFields, comboGroups, combinations, ...rest } = tab;
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
        } catch (err) {
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
}): EditedTiersResult {
  const opts: TierOpts = { schemas, paymentMethod };
  const clamp = (v: number) => Math.max(0, Math.round(v));
  const stored = storedTiersWithFallback(calculatorData, opts, originalContractPrice);

  const hasSchema = Array.isArray(schemas) && schemas.length > 0;
  if (hasSchema && config && (editedJobState || originalJobState)) {
    const fieldOptions = extractDealCenterFieldOptions(schemas);
    // Strip totals/entries so the schema-sum path prices the overlaid build
    // quantities (never the stale stored totals) — exactly web's `stripped(d)`.
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

  // No schemas configured — safe degradation: no delta, rep sets the price.
  return {
    previous: stored,
    next: { ...stored },
    delta: { cost: 0, par: 0, retail: 0 },
    changed: false,
  };
}

/** COST/PAR/RETAIL markup label + % vs the closest tier, for the price input badge. */
export function getMarkupInfo(
  price: any,
  tiers: Tiers | undefined | null
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
  return { text: base, markupPct: pct };
}
