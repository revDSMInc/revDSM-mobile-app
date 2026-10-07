export function normalizeSingleAcceptedDrop<T extends { status?: string }>(drops: T[] | null | undefined): T[] {
  if (!Array.isArray(drops)) return [];

  let lastAcceptedIndex = -1;
  let acceptedCount = 0;
  drops.forEach((d, i) => {
    if (d?.status === 'accepted') {
      acceptedCount += 1;
      lastAcceptedIndex = i;
    }
  });

  if (acceptedCount <= 1) return drops;

  return drops.map((d, i) =>
    i !== lastAcceptedIndex && d?.status === 'accepted' ? { ...d, status: 'declined' } : d
  );
}


const dropIdOf = (d: any): string => String(d?._id ?? '');
export const dropPriceOf = (d: any): number =>
  Math.round(Number(d?.price ?? d?.dropedPrice ?? 0)) || 0;

export function readServerDrops(response: any): any[] {
  const roots = [
    response,
    response?.data,
    response?.data?.data,
    response?.calculator,
    response?.data?.calculator,
    response?.data?.data?.calculator,
  ];
  for (const root of roots) {
    if (Array.isArray(root?.dropPrice)) return root.dropPrice;
  }
  return [];
}

export function adoptServerDropIds<T extends Record<string, any>>(
  local: T[] | null | undefined,
  serverRows: any[] | null | undefined,
): T[] {
  if (!Array.isArray(local) || !local.length) return Array.isArray(local) ? local : [];
  if (!Array.isArray(serverRows) || !serverRows.length) return local;

  const claimed = new Set<string>();
  local.forEach((d) => {
    const id = dropIdOf(d);
    if (id) claimed.add(id);
  });

  let changed = false;
  const out = local.map((d) => {
    if (dropIdOf(d)) return d;
    const price = dropPriceOf(d);
    const status = d?.status ?? '';
    const free = (s: any) => !!dropIdOf(s) && !claimed.has(dropIdOf(s));
    const match =
      serverRows.find((s) => free(s) && dropPriceOf(s) === price && (s?.status ?? '') === status) ||
      serverRows.find((s) => free(s) && dropPriceOf(s) === price);
    if (!match) return d;
    claimed.add(dropIdOf(match));
    changed = true;
    return { ...d, _id: dropIdOf(match) } as T;
  });
  return changed ? out : local;
}

export function toDropPricePayload(drops: any[] | null | undefined): any[] {
  return (Array.isArray(drops) ? drops : []).map((d) => {
    const methods = Array.isArray(d?.paymentMethods) ? d.paymentMethods.filter(Boolean) : [];
    return {
      ...(d?._id ? { _id: String(d._id) } : null),
      dropedPrice: Number(d?.dropedPrice ?? d?.price) || 0,
      status: d?.status || 'declined',
      paymentMethod: d?.paymentMethod || '',
      pricemarkup: d?.pricemarkup || '',
      downPayment: Number(d?.downPayment) || 0,
      balance: Number(d?.balance) || 0,
      ...(methods.length ? { paymentMethods: methods } : null),
    };
  });
}

export function idlessDropSignature(drops: any[] | null | undefined): string {
  if (!Array.isArray(drops)) return '';
  return drops
    .filter((d) => !dropIdOf(d))
    .map((d) => `${dropPriceOf(d)}:${d?.status ?? ''}`)
    .join('|');
}

export function hasAcceptedDrop(drops: any[] | null | undefined): boolean {
  return (Array.isArray(drops) ? drops : []).some((d) => d?.status === 'accepted');
}

export function resolveAutoSecureIndex(drops: any[] | null | undefined): number {
  const list = Array.isArray(drops) ? drops : [];
  if (!list.length) return -1;
  if (hasAcceptedDrop(list)) return -1;
  return list.length - 1;
}

export function autoSecureLastDrop<T extends Record<string, any>>(
  drops: T[] | null | undefined
): T[] {
  const list = Array.isArray(drops) ? drops : [];
  const idx = resolveAutoSecureIndex(list);
  if (idx < 0) return list;
  return list.map((d, i) => (i === idx ? { ...d, status: 'accepted' } : d));
}

export function resolveActiveDownPayment(
  drops: any[] | null | undefined,
  fallback?: number | string | null
): number {
  const list = Array.isArray(drops) ? drops : [];
  const acceptedIdx = list.findIndex((d) => d?.status === 'accepted');
  const idx = acceptedIdx >= 0 ? acceptedIdx : resolveAutoSecureIndex(list);
  const raw = idx >= 0 ? list[idx]?.downPayment : fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
