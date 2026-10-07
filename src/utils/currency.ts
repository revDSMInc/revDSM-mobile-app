const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface FormatCurrencyOptions {
  decimals?: number;
  fallback?: string;
}

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
