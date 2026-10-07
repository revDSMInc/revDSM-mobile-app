export const PRE_ORDER_DISCOUNT_KEY = 'pre_order';

export interface DiscountOption {
  value: number | string;
  label?: string;
  isDefault?: boolean;
}
export interface Discount {
  key: string;
  title?: string;
  type: 'fixed' | 'options' | string;
  value?: number | string;
  includeInMsrp?: boolean;
  allowRepDefault?: boolean;
  options?: DiscountOption[];
}
export interface Program {
  key: string;
  title?: string;
  headerLabel?: string;
  isHighlighted?: boolean;
  linkedDiscountKeys?: string[];
}
export interface DiscountConfig {
  discounts?: Discount[];
  programs?: Program[];
  isActive?: boolean;
}
export interface ProgramLine {
  key: string;
  title?: string;
  percent: number;
  amount: number;
}

export function getDiscountConfig(config?: DiscountConfig | null): DiscountConfig | null {
  return config?.discounts?.length ? config : null;
}

export function getSelectableOptionsDiscount(discounts: Discount[] = []): Discount | null {
  const list = discounts || [];
  return (
    list.find((d) => d.key === PRE_ORDER_DISCOUNT_KEY && d.type === 'options') ||
    list.find((d) => d.type === 'options' && d.allowRepDefault) ||
    list.find((d) => d.type === 'options') ||
    null
  );
}

export function getSelectableDiscountKey(discounts: Discount[] = []): string {
  return getSelectableOptionsDiscount(discounts)?.key || PRE_ORDER_DISCOUNT_KEY;
}

export function getDefaultOptionValue(discount?: Discount | null): number {
  if (!discount?.options?.length) return 0;
  const def = discount.options.find((o) => o.isDefault) || discount.options[0];
  return Number(def?.value) || 0;
}

export function getDefaultSelectableDiscountValue(discounts: Discount[] = []): number {
  const selectable = getSelectableOptionsDiscount(discounts);
  return getDefaultOptionValue(selectable) || 0;
}

export function getDiscountPercent(
  discount?: Discount | null,
  selectedValuesByKey: Record<string, number | string> = {},
): number {
  if (!discount) return 0;
  if (discount.type === 'fixed') return Number(discount.value) || 0;
  if (discount.type === 'options') {
    const selected = selectedValuesByKey[discount.key];
    if (selected !== undefined && selected !== null && selected !== '') {
      return Number(selected) || 0;
    }
    return getDefaultOptionValue(discount);
  }
  return 0;
}

export function getMsrpDiscountTotal(
  discounts: Discount[] = [],
  selectedValuesByKey: Record<string, number | string> = {},
): number {
  return (discounts || [])
    .filter((d) => d.includeInMsrp)
    .reduce((sum, discount) => sum + getDiscountPercent(discount, selectedValuesByKey), 0);
}

export function computeMsrpFromEndPrice(
  endPrice: number,
  discounts: Discount[] = [],
  selectedValuesByKey: Record<string, number | string> = {},
): number {
  const numericEndPrice = Number(endPrice) || 0;
  if (!numericEndPrice) return 0;

  const totalPct = getMsrpDiscountTotal(discounts, selectedValuesByKey);
  if (totalPct >= 100) return numericEndPrice;

  return numericEndPrice / (1 - totalPct / 100);
}

export function computeProgramDiscountLines(
  msrp: number,
  program?: Program | null,
  discounts: Discount[] = [],
  selectedValuesByKey: Record<string, number | string> = {},
): ProgramLine[] {
  const numericMsrp = Number(msrp) || 0;
  if (!numericMsrp || !program) return [];

  return (program.linkedDiscountKeys || [])
    .map((key) => {
      const discount = (discounts || []).find((d) => d.key === key);
      if (!discount) return null;
      const percent = getDiscountPercent(discount, selectedValuesByKey);
      return { key, title: discount.title, percent, amount: numericMsrp * (percent / 100) };
    })
    .filter(Boolean) as ProgramLine[];
}

export function computeProgramGrandTotal(
  msrp: number,
  program?: Program | null,
  discounts: Discount[] = [],
  selectedValuesByKey: Record<string, number | string> = {},
): number {
  const numericMsrp = Number(msrp) || 0;
  if (!numericMsrp || !program) return 0;

  const discountTotal = computeProgramDiscountLines(numericMsrp, program, discounts, selectedValuesByKey).reduce(
    (sum, line) => sum + line.amount,
    0,
  );
  return numericMsrp - discountTotal;
}

export function formatProgramTitle(title = ''): string[] {
  return String(title).split('\n').filter(Boolean);
}
