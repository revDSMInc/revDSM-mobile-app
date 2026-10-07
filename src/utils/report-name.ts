export const reportDisplayName = (
  report: { displayName?: unknown; reportName?: unknown } | null | undefined,
  fallback: string
): string => {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return pick(report?.displayName) || pick(report?.reportName) || fallback;
};

export const newestReport = <T extends { createdAt?: string }>(reports: T[]): T | undefined =>
  reports.reduce<T | undefined>((best, r) => {
    if (!best) return r;
    const a = Date.parse(r.createdAt || '');
    const b = Date.parse(best.createdAt || '');
    return (Number.isNaN(a) ? 0 : a) > (Number.isNaN(b) ? 0 : b) ? r : best;
  }, undefined);
