const RESULTED_STATUSES: ReadonlySet<string> = new Set([
  'sale',
  'demo',
  'demonosale',
  'nodemo',
  'nothit',
  'nothome',
  'reset',
  'rescheduled',
  'cancelled',
  'canceled',
]);

const STATUS_KEYS = ['status', 'result', 'resultStatus', 'leadStatus'];

export function normalizeResultStatus(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z]/g, '') : '';
}

export function isLeadResulted(lead: Record<string, any> | null | undefined): boolean {
  if (!lead || typeof lead !== 'object') return false;
  return STATUS_KEYS.some((key) => RESULTED_STATUSES.has(normalizeResultStatus(lead[key])));
}
