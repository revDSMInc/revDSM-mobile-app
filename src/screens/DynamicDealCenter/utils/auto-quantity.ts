export interface AutoQuantityTier {
  min: number;
  max: number | null;
  quantity: number;
}

export interface AutoQuantityConfig {
  sources: string[];
  aggregate: 'sum' | 'max' | 'min';
  tiers: AutoQuantityTier[];
  notify: boolean;
  addedMessage?: string;
  removedMessage?: string;
  updatedMessage?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeAutoQuantity(conditional: any): AutoQuantityConfig | null {
  if (!conditional || typeof conditional !== 'object') return null;
  if (conditional.valueMode !== 'range') return null;
  const refs = Array.isArray(conditional.dependsOn)
    ? conditional.dependsOn
    : conditional.dependsOn
      ? [conditional.dependsOn]
      : [];
  const sources: string[] = refs.map((s: unknown) => String(s ?? '').trim()).filter(Boolean);
  const tiers: AutoQuantityTier[] = (Array.isArray(conditional.ranges) ? conditional.ranges : [])
    .map((t: any) => ({
      min: num(t?.min),
      max: t?.max === null || t?.max === undefined || t?.max === '' ? null : num(t.max),
      quantity: Math.max(0, Math.round(num(t?.value ?? t?.quantity))),
    }))
    .sort((a: AutoQuantityTier, b: AutoQuantityTier) => a.min - b.min);
  if (!sources.length || !tiers.length) return null;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const aggregate = conditional.aggregate === 'max' || conditional.aggregate === 'min' ? conditional.aggregate : 'sum';
  return {
    sources,
    aggregate,
    tiers,
    notify: conditional.notifyRep === true,
    addedMessage: text(conditional.addedMessage),
    removedMessage: text(conditional.removedMessage),
    updatedMessage: text(conditional.updatedMessage),
  };
}

export function sumSources(
  config: AutoQuantityConfig,
  formState: Record<string, number>,
  fields: { id: string; name?: string }[] = []
): number {
  const values = config.sources.map((ref) => {
    const f = fields.find((x) => x.id === ref || x.name === ref);
    return num(formState[f?.id ?? ref] ?? formState[f?.name ?? ref] ?? formState[ref] ?? 0);
  });
  if (!values.length) return 0;
  if (config.aggregate === 'max') return Math.max(...values);
  if (config.aggregate === 'min') return Math.min(...values);
  return values.reduce((a, b) => a + b, 0);
}

export function quantityForTotal(config: AutoQuantityConfig, total: number): number {
  const hit = config.tiers.find((t) => total >= t.min && (t.max === null || total <= t.max));
  if (hit) return hit.quantity;
  const started = config.tiers.filter((t) => total >= t.min);
  return started.length ? started[started.length - 1].quantity : 0;
}

export type AutoQuantityChange = 'added' | 'removed' | 'updated' | null;

export function changeKind(before: number, after: number): AutoQuantityChange {
  if (before === after) return null;
  if (before <= 0 && after > 0) return 'added';
  if (after <= 0 && before > 0) return 'removed';
  return 'updated';
}

export function formatMessage(
  template: string,
  vars: { value: number; total: number; previous: number; field: string }
): string {
  return template.replace(/\{(field|value|total|previous)\}/g, (_, k: keyof typeof vars) => String(vars[k]));
}
