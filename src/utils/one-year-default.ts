/**
 * REVUIUX-444 - the 1 Year Program's default monthly plan is REP-scoped: one plan per rep
 * (`user.defaultOneYearPaymentMethod`, a plan key), used by every deal of every lead. Pure on purpose
 * (no React Native) so it can be unit tested; `isFinancing` is injected for the same reason.
 */

type PlanLike = { type?: string; apr?: number } | undefined;
type PlanMap = Record<string, PlanLike>;

const isFin = (plans: PlanMap, key?: string | null): boolean => !!key && plans[key]?.type === 'financing';

/** The rep's own 1 Year default, or null. An unknown, unpublished or cash/basic key counts as NO default. */
export function resolveRepOneYearKey(plans: PlanMap, user: any): string | null {
  const key = user?.defaultOneYearPaymentMethod;
  return key && isFin(plans, key) ? String(key) : null;
}

/** The plan the card's `Default` mode uses: rep 1 Year default > In-Home default > 9.99% > any APR > first financing > method. */
export function resolveOneYearDefaultKey(plans: PlanMap, user: any, fallbackMethod: string): string {
  const rep = resolveRepOneYearKey(plans, user);
  if (rep) return rep;
  const financingKeys = Object.keys(plans).filter((k) => isFin(plans, k));
  if (user?.defaultPaymentMethod && isFin(plans, user.defaultPaymentMethod)) return user.defaultPaymentMethod;
  return (
    financingKeys.find((k) => Math.round((plans[k]?.apr || 0) * 100) / 100 === 9.99) ||
    financingKeys.find((k) => (plans[k]?.apr || 0) > 0) ||
    financingKeys[0] ||
    fallbackMethod
  );
}

export interface OneYearStored {
  mode?: string;
  planKey?: string | null;
  monthlyPayment?: number;
  grandTotal?: number;
  isDefault?: boolean;
}

/**
 * True when a `Default`-mode calculator must be re-stamped: the backend stamps a new one with the rep's key but
 * `monthlyPayment`/`grandTotal` 0 (it prices nothing), and a later change of the rep default must reach every
 * deal still on `Default`. Nothing stored counts only when the rep HAS a default (otherwise the card sits on Match).
 */
export function oneYearNeedsResync(
  stored: OneYearStored | null | undefined,
  defaultKey: string,
  monthly: number,
  base: number,
  hasRepDefault: boolean
): boolean {
  if (!stored) return hasRepDefault;
  if (stored.mode !== 'default') return false;
  return (
    stored.planKey !== defaultKey ||
    Math.round(Number(stored.monthlyPayment) || 0) !== Math.round(monthly || 0) ||
    Math.round(Number(stored.grandTotal) || 0) !== Math.round(base || 0) ||
    stored.isDefault === true
  );
}
