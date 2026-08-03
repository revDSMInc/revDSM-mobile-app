/**
 * Money formatting.
 *
 * Deliberately does NOT use `Number.prototype.toLocaleString`: that depends on the
 * Intl data compiled into the JS engine, so a build without it silently returns
 * `22411` where every other screen shows `$22,411`. Grouping by regex is a few lines
 * and behaves the same on every device.
 */

/** `"22411"` → `"22,411"`. Operates on the integer part only. */
const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface FormatCurrencyOptions {
  /**
   * Fixed decimal places. Omit to keep whatever the value already has — callers that
   * want whole dollars round before calling, which keeps this from guessing.
   */
  decimals?: number;
  /** Returned for null / undefined / empty / unparseable input. */
  fallback?: string;
}

/**
 * `22411` → `"$22,411"`, `2000.5` → `"$2,000.5"`, `undefined` → the fallback.
 *
 * Accepts numeric strings too (`"22411"`, `"$22,411"`), since contract amounts come
 * off the API as strings as often as numbers.
 */
export function formatCurrency(value: unknown, options: FormatCurrencyOptions = {}): string {
  const { decimals, fallback = 'N/A' } = options;

  if (value === null || value === undefined || value === '') return fallback;

  const num =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''));

  if (!Number.isFinite(num)) return fallback;

  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const body = decimals === undefined ? String(abs) : abs.toFixed(decimals);
  const [whole, fraction] = body.split('.');

  return `${sign}$${group(whole)}${fraction ? `.${fraction}` : ''}`;
}
