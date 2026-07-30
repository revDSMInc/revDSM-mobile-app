/**
 * drop-prices.ts — the single-accepted invariant for rollout drop prices.
 *
 * A calculator may have many dropped prices but AT MOST ONE may be `accepted`
 * ("SECURED"); every other entry is `declined`. Web enforces this in four places
 * inside `handleSecurePrice` (`ViewAllCalculators.js:1041/1067/1082` in-array
 * demotion + `:1116-1123` a first-accepted-wins normalizer in the payload
 * builder). Mobile had the in-array demotion only, so any path that bypassed it
 * — or any save that was dropped by the debounce engine — could leave two
 * `accepted` rows on the server, which then rendered as two SECURED badges on
 * every reopen with no way back except a manual Unselect.
 *
 * This centralizes the rule so it is enforced on BOTH sides of the wire:
 *   - write: `buildPayload` normalizes before every PUT (covers secure, decline,
 *     unselect and any future path, closing web's own gap where decline/unselect
 *     use a naive `dp.secured ? 'accepted' : 'declined'` map).
 *   - read: hydration normalizes so records ALREADY corrupted by the save race
 *     are repaired on open rather than displaying two SECURED rows forever.
 */

/**
 * Keep at most one `accepted` drop, demoting the others to `declined`.
 *
 * LAST accepted wins, not first. Web's normalizer keeps the first, but that
 * choice is never actually exercised there — its in-array pass has already
 * demoted all prior entries, so at most one `accepted` ever reaches it. Here the
 * normalizer's real job is repairing corrupted history, where "the most recent
 * secure is the one the rep meant" is the only defensible reading: drops are
 * appended in negotiation order, so the last accepted entry is the latest price
 * the customer agreed to. It also agrees with what the rest of the screen already
 * shows for such a record — the Result Lead button reads the most recent drop.
 *
 * Returns the SAME array reference when it is already valid, so this is safe to
 * call on every save and every hydrate without churning identity/re-renders.
 */
/**
 * Remove EXACT-duplicate drop rows, keeping the first occurrence.
 *
 * A drop is a distinct negotiation round — two rows that agree on price, status,
 * down payment, balance and payment plan(s) are the SAME round recorded twice,
 * never two meaningful rounds. Such duplicates crept in from a save/outcome race
 * (the calculator's `dropPrice` was persisted by both the debounced calculator
 * save AND the result-outcome payload, so a round could land twice) and surfaced
 * as "I added 2 drops but see 4" and a phantom extra row auto-appearing on reopen.
 *
 * This is intentionally NARROW: it collapses only byte-for-byte-equal rows, so two
 * genuinely different rounds (different price, status, plan, or down payment) are
 * both kept and still list as "1st / 2nd Dropped Price". Applied on WRITE so a
 * duplicate is never persisted, and on READ so already-corrupted records self-heal
 * on open. Returns the SAME reference when nothing is dropped (no render churn).
 */
export function dedupeDrops<T extends Record<string, any>>(drops: T[] | null | undefined): T[] {
  if (!Array.isArray(drops)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of drops) {
    const sig = [
      Math.round(Number(d?.price ?? d?.dropedPrice ?? 0)),
      d?.status ?? '',
      Math.round(Number(d?.downPayment ?? 0)),
      Math.round(Number(d?.balance ?? 0)),
      d?.paymentMethod ?? '',
      Array.isArray(d?.paymentMethods) ? d.paymentMethods.join('|') : '',
    ].join('::');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(d);
  }
  return out.length === drops.length ? drops : out;
}

/**
 * Collapse drops so at most ONE entry exists PER PRICE.
 *
 * `dedupeDrops` above is byte-for-byte, so the same negotiated price surviving with a
 * DIFFERENT shape is not merged — and that is exactly what accumulates: the `declined`
 * twin `openDrop` persists on entry sitting beside the `accepted` version after Secure,
 * or a re-saved copy the backend re-created without a matching `_id` (mobile drops carry
 * no `_id`, so a second save of the same price appends a new row). Either way the rep
 * sees the same price listed twice.
 *
 * A negotiated price is ONE outcome, so keep a single entry per price, preferring:
 *   accepted (SECURED) over declined  →  a copy that has a server `_id`  →  a more
 *   complete copy (has a payment method). An `_id` from ANY copy is carried onto the
 *   survivor so the next save updates that row in place instead of appending yet another.
 * Order is preserved by first-seen price. Returns the SAME reference when nothing
 * collapses (no render churn).
 */
export function collapseDropsByPrice<T extends Record<string, any>>(drops: T[] | null | undefined): T[] {
  if (!Array.isArray(drops)) return [];
  const priceOf = (d: any) => Math.round(Number(d?.price ?? d?.dropedPrice ?? 0));
  const rank = (d: any) =>
    (d?.status === 'accepted' ? 100 : 0) + (d?._id ? 10 : 0) + (d?.paymentMethod ? 1 : 0);
  const byPrice = new Map<number, T>();
  const order: number[] = [];
  for (const d of drops) {
    const price = priceOf(d);
    const cur = byPrice.get(price);
    if (cur === undefined) {
      byPrice.set(price, d);
      order.push(price);
      continue;
    }
    const winner = rank(d) > rank(cur) ? d : cur;
    const id = (winner as any)._id ?? (cur as any)._id ?? (d as any)._id;
    byPrice.set(price, id ? ({ ...winner, _id: id } as T) : winner);
  }
  const out = order.map((p) => byPrice.get(p) as T);
  return out.length === drops.length ? drops : out;
}

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
