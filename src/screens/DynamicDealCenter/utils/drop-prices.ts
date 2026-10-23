/**
 * DROP STATUSES: 'accepted' | 'declined' | 'pending'.
 *
 * `pending` is a drop the rep TYPED and committed (Done on the keypad) but has not yet taken an
 * outcome on. It exists because the drop used to live only in component state until Secure or
 * Decline was pressed, so a rep who typed a price and navigated away lost it - reported from the
 * field as "these drops always have to save, I hit done on the keypad".
 *
 * ⚠️ A PENDING DROP MUST NEVER PRICE THE JOB. It is a number the rep floated, not one the
 * customer agreed to. Every helper here that chooses a price, a down payment or an auto-secure
 * target treats pending as "not an outcome" - see `isResolvedDrop` / `hasUnresolvedDrop`. Getting
 * this wrong is worse than the bug it fixes: it would sell a job at a price nobody accepted and
 * log a `drop price secured` event that never happened.
 */
export const DROP_PENDING = 'pending';
export const DROP_ACCEPTED = 'accepted';
export const DROP_DECLINED = 'declined';

export const isPendingDrop = (d: any): boolean => d?.status === DROP_PENDING;

/** A drop the rep has taken an outcome on. Only these may affect pricing. */
export const isResolvedDrop = (d: any): boolean =>
  d?.status === DROP_ACCEPTED || d?.status === DROP_DECLINED;

/**
 * Is a drop still waiting for Secure / Decline?
 *
 * Result Lead is blocked on this: a deal must not be resulted while a price the rep put in front
 * of the customer has no recorded outcome.
 */
export const hasUnresolvedDrop = (drops: any[] | null | undefined): boolean =>
  (Array.isArray(drops) ? drops : []).some(isPendingDrop);

/**
 * Add a new drop, enforcing the client's rule: **ONLY THE MOST RECENT DROP MAY BE PENDING.**
 *
 * Lance, on the screenshot that showed 3rd / 4th / 5th all PENDING at once:
 *   *"The pending was to just handle the edge case of a sales rep not hitting a secure or a
 *   decline. We do not want to add a 'pending' button to the drop price screen. This means on a
 *   per job level only the most recent price drop could ONLY have pending status if the rep
 *   didn't hit a secure / decline."*
 *
 * So pending is a CATCH, not a workflow. Typing a new drop while an older one is still pending
 * means the rep moved on from it without securing it - which is a decline.
 *
 * ⚠️ The superseded drop becomes DECLINED, never silently dropped: the rep showed that price to
 * the customer and the Forever Record has to keep it. The caller logs that transition.
 */
/**
 * A device-minted id for a drop row, so it can be addressed WITHOUT relying on its index.
 *
 * ⚠️ INDEX-BASED ADDRESSING IS WHAT DUPLICATED DROPS. `resolveDropTargetIndex` matched on a
 * `pendingDropIndex` held in component STATE; after a crash, a remount or a re-render that reset
 * it, the lookup missed and `secureDrop` APPENDED instead of updating - producing the reported
 * `$500 SECURED` + `$500 PENDING` pair. An id travels with the row, through MMKV and through a
 * process restart, so it cannot go stale.
 *
 * Not the server `_id`: the row exists on the device before the server has ever seen it.
 */
export const newDropUid = (): string =>
  `drop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const dropUidOf = (d: any): string => String(d?.uid ?? '');

/**
 * Find a drop by its device id, falling back to an exact price+pending match for rows written
 * before uids existed (and for anything that arrived from the server without one).
 */
export const findDropIndex = (
  drops: any[] | null | undefined,
  uid: string,
  fallbackPrice?: number
): number => {
  const list = Array.isArray(drops) ? drops : [];
  const id = String(uid || '');
  if (id) {
    const byUid = list.findIndex((d) => dropUidOf(d) === id);
    if (byUid >= 0) return byUid;
  }
  if (typeof fallbackPrice === 'number' && Number.isFinite(fallbackPrice)) {
    const target = Math.round(fallbackPrice);
    // Prefer a PENDING row at that price - that is the one an outcome is being taken on.
    const pendingAt = list.findIndex(
      (d) => isPendingDrop(d) && Math.round(dropPriceOf(d)) === target
    );
    if (pendingAt >= 0) return pendingAt;
  }
  return -1;
};

/**
 * Collapse rows that are the SAME drop recorded twice.
 *
 * ⚠️ A REPAIR, not a rule. Duplicates should not exist once drops are addressed by uid, but
 * rows already written to a device (or to the server) by the buggy build still carry them, and a
 * rep should not have to delete them by hand. Two rows collapse only when they share a uid, or
 * when one is PENDING and an adjacent row has the identical price - the exact shape the bug
 * produced. A resolved row always wins over a pending one, because an outcome outranks a draft.
 *
 * ⚠️ Deliberately NOT "same price = duplicate". A rep may legitimately drop to the same number
 * twice in separate rounds; only an unresolved twin of a resolved row is a duplicate.
 */
export const dedupeDrops = <T extends Record<string, any>>(
  drops: T[] | null | undefined
): T[] => {
  const list = Array.isArray(drops) ? drops : [];
  if (list.length < 2) return list;

  const out: T[] = [];
  const seenUids = new Set<string>();
  let changed = false;

  for (const row of list) {
    const uid = dropUidOf(row);
    if (uid && seenUids.has(uid)) {
      changed = true;
      const at = out.findIndex((d) => dropUidOf(d) === uid);
      if (at >= 0 && isPendingDrop(out[at]) && !isPendingDrop(row)) out[at] = row;
      continue;
    }

    const price = Math.round(dropPriceOf(row));
    const twin = out.findIndex(
      (d) =>
        Math.round(dropPriceOf(d)) === price &&
        (isPendingDrop(d) || isPendingDrop(row)) &&
        !(isPendingDrop(d) && isPendingDrop(row) && dropUidOf(d) !== dropUidOf(row) && !!dropUidOf(d))
    );
    if (twin >= 0) {
      changed = true;
      // Keep whichever row carries the real outcome.
      if (isPendingDrop(out[twin]) && !isPendingDrop(row)) out[twin] = row;
      continue;
    }

    if (uid) seenUids.add(uid);
    out.push(row);
  }

  return changed ? out : list;
};

export const appendDrop = <T extends Record<string, any>>(
  drops: T[] | null | undefined,
  next: T
): T[] => [
  ...(Array.isArray(drops) ? drops : []).map((d) =>
    isPendingDrop(d) ? ({ ...d, status: DROP_DECLINED } as T) : d
  ),
  next,
];

/**
 * The drops superseded by a new entry - i.e. the ones `appendDrop` is about to decline.
 * The caller needs them to write one `drop price declined` log per row.
 */
export const supersededPendingDrops = <T extends Record<string, any>>(
  drops: T[] | null | undefined
): Array<{ index: number; drop: T }> =>
  (Array.isArray(drops) ? drops : [])
    .map((drop, index) => ({ index, drop }))
    .filter(({ drop }) => isPendingDrop(drop));

export const pendingDropIndex = (drops: any[] | null | undefined): number =>
  (Array.isArray(drops) ? drops : []).findIndex(isPendingDrop);

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
      // ⚠️ The `|| 'declined'` fallback is for a row with NO status (legacy rows). A deliberate
      // 'pending' must pass through untouched - coercing it here would file an unresolved drop as
      // declined on the server and lose the very state this saves.
      status: d?.status || DROP_DECLINED,
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
  /**
   * ⚠️ NEVER auto-secure a PENDING drop. This runs when the rep taps Result Lead, and it used to
   * take `list.length - 1` blindly - so a drop the rep merely typed would have become the SOLD
   * price, with a `drop price secured` log for an outcome that never happened. Pending rows are
   * skipped; `hasUnresolvedDrop` blocks the flow before this anyway, and this is the second line of
   * defence so a future caller cannot reintroduce it.
   */
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!isPendingDrop(list[i])) return i;
  }
  return -1;
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
  // ⚠️ A pending drop's down payment must not seed the Investment Center - same rule as pricing.
  const acceptedIdx = list.findIndex((d) => d?.status === DROP_ACCEPTED);
  const idx = acceptedIdx >= 0 ? acceptedIdx : resolveAutoSecureIndex(list);
  const raw = idx >= 0 ? list[idx]?.downPayment : fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
