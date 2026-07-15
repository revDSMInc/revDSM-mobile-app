/**
 * pricing-config-util.ts — company-authored pricing config (dynamic tier labels,
 * static fees, %-of-tier derivation) for the Dynamic Deal Center. Port of the web
 * `src/sections/deal-center/components/utils/pricing-config-util.js` +
 * `src/api/pricing-config.js` normalizer.
 *
 * WHY THIS EXISTS: portal schemas frequently price a field at ONE tier (usually
 * retail) and leave cost/par blank, expecting the company config's derivation rule
 * (e.g. "par = 65% of retail", "cost = 50% of retail") to fill them. Web bakes that
 * derivation into the schema at load; mobile previously read only the explicit
 * `price.par`/`price.cost`, so blank tiers came through as 0 and the rollout PAR/COST
 * tiles floored to $200 (and RETAIL could be off when it too was derived). These
 * helpers reproduce web's derivation so the tiles match.
 */

export interface PricingTier {
  key: string;
  label?: string;
  order?: number;
}
export interface DerivationRule {
  tierKey: string;
  ofTierKey: string;
  percentOf: number;
}
export interface PricingFee {
  amount: number;
  appliesToTierKeys?: string[];
}
export interface PricingConfig {
  tiers: PricingTier[];
  fees: PricingFee[];
  derivationRules: DerivationRule[];
  isActive?: boolean;
}

export const DEFAULT_TIERS: PricingTier[] = [
  { key: 'cost', label: 'Cost', order: 0 },
  { key: 'par', label: 'Par', order: 1 },
  { key: 'retail', label: 'Retail', order: 2 },
];

/** Legacy markup token → stable tier key. */
export const MARKUP_TO_TIER: Record<string, string> = { '50': 'cost', '65': 'par', '100': 'retail' };

const TIER_LABEL_FALLBACK: Record<string, string> = { cost: 'Cost', par: 'Par', retail: 'Retail' };

export function tierKeyForMarkup(markupKey: string | number): string {
  return MARKUP_TO_TIER[String(markupKey)] || String(markupKey);
}

export function resolveTiers(config?: PricingConfig | null): PricingTier[] {
  const tiers = config?.tiers?.length ? config.tiers : DEFAULT_TIERS;
  return [...tiers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function resolveTierLabels(config?: PricingConfig | null): Record<string, string> {
  const labels = { ...TIER_LABEL_FALLBACK };
  resolveTiers(config).forEach((t) => {
    if (t?.key) labels[t.key] = t.label || labels[t.key] || t.key;
  });
  return labels;
}

/**
 * Resolve a schema field's price for one tier: an explicit per-field value wins;
 * otherwise derive it as `percentOf% of` another tier via the config's derivation
 * rules (cycle-safe). Web `resolveFieldTierPrice`.
 */
export function resolveFieldTierPrice(
  field: { price?: Record<string, any> } | undefined,
  tierKey: string,
  config?: PricingConfig | null,
  seen: Set<string> = new Set(),
): number {
  const explicit = field?.price?.[tierKey];
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const n = Number(explicit);
    return Number.isFinite(n) ? n : 0;
  }
  if (seen.has(tierKey)) return 0;
  const rule = (config?.derivationRules || []).find((r) => r.tierKey === tierKey);
  if (rule?.ofTierKey) {
    const pct = Number(rule.percentOf) || 0;
    const next = new Set(seen);
    next.add(tierKey);
    return (pct / 100) * resolveFieldTierPrice(field, rule.ofTierKey, config, next);
  }
  return 0;
}

export function sumFeesForTier(tierKey: string, config?: PricingConfig | null): number {
  return (config?.fees || []).reduce((sum, fee) => {
    const applies = Array.isArray(fee?.appliesToTierKeys) && fee.appliesToTierKeys.includes(tierKey);
    return applies ? sum + (Number(fee.amount) || 0) : sum;
  }, 0);
}

/** Add the static fees for a tier once per job (only when the job has line items). */
export function applyFeesToTier(
  tierSum: number,
  tierKey: string,
  config?: PricingConfig | null,
  { hasLineItems = tierSum > 0 }: { hasLineItems?: boolean } = {},
): number {
  if (!hasLineItems) return tierSum;
  return tierSum + sumFeesForTier(tierKey, config);
}

/**
 * Preserve the authored blank-vs-value distinction (web `rawPriceMap`): a blank
 * tier stays '' so the derivation rule can fill it; a present value becomes a number
 * (thousands separators stripped).
 */
function toPriceNumber(value: any): number {
  const num = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(num) ? num : 0;
}
export function rawPriceMap(price: any): Record<string, number | ''> {
  const out: Record<string, number | ''> = {};
  if (price && typeof price === 'object') {
    Object.entries(price).forEach(([key, raw]) => {
      out[key] = raw === undefined || raw === null || String(raw).trim() === '' ? '' : toPriceNumber(raw);
    });
  }
  return out;
}

/**
 * Resolve every tier of a field's price to a concrete number ONCE, at load — web
 * `normalizePrice`. An explicit per-field value wins; otherwise it's derived via
 * the company config. Baking it here keeps entries/totals/tiles reading plain numbers.
 */
export function bakeFieldPrice(price: any, config?: PricingConfig | null): { retail: number; cost: number; par: number; [k: string]: number } {
  const raw = rawPriceMap(price);
  const fieldLike = { price: raw };
  const tierKeys = new Set<string>(['cost', 'par', 'retail']);
  resolveTiers(config).forEach((t) => t?.key && tierKeys.add(t.key));
  Object.keys(raw).forEach((k) => tierKeys.add(k));

  const out: Record<string, number> = {};
  tierKeys.forEach((k) => {
    out[k] = resolveFieldTierPrice(fieldLike, k, config);
  });
  return { retail: out.retail || 0, cost: out.cost || 0, par: out.par || 0, ...out };
}

/**
 * Normalize the raw `/company/v1/pricing-config/sales` payload. Returns null when
 * absent/unpublished (isActive === false) or with no tiers — the calc then falls
 * back to the default 3 tiers, no fees, no derivation (web `normalizeSalesPricingConfig`).
 */
export function normalizeSalesPricingConfig(raw: any): PricingConfig | null {
  if (!raw || raw.isActive === false) return null;
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  if (!tiers.length) return null;
  return {
    tiers,
    fees: Array.isArray(raw.fees) ? raw.fees : [],
    derivationRules: Array.isArray(raw.derivationRules) ? raw.derivationRules : [],
    isActive: raw.isActive !== false,
  };
}
