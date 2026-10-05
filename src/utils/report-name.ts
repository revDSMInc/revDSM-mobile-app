/**
 * Readable title / filename for a generated report (REVUIUX-466).
 *
 * `reportName` is the report's TYPE key (e.g. `risk_report`) and is what every screen matches on
 * to find "this lead's risk report" - never repurpose it. The backend stores a separate
 * `displayName` ("Lead | Address | Date | Time") on reports generated after its deploy; older
 * records have none, so this falls back to `reportName` and then to a generic label.
 *
 * Pure (no imports) so it can be tested under jest.
 */
export const reportDisplayName = (
  report: { displayName?: unknown; reportName?: unknown } | null | undefined,
  fallback: string
): string => {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return pick(report?.displayName) || pick(report?.reportName) || fallback;
};

/** The most recently created record, for when only a job (not a record) identifies the report. */
export const newestReport = <T extends { createdAt?: string }>(reports: T[]): T | undefined =>
  reports.reduce<T | undefined>((best, r) => {
    if (!best) return r;
    const a = Date.parse(r.createdAt || '');
    const b = Date.parse(best.createdAt || '');
    return (Number.isNaN(a) ? 0 : a) > (Number.isNaN(b) ? 0 : b) ? r : best;
  }, undefined);
