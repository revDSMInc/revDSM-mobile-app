/**
 * drop-prices.ts — the rollout drop-price list: what it means, and how it is wired.
 *
 * ⚠️ **NOTHING HERE MAY REMOVE A ROW ON THE READ OR WRITE PATH.** The backend merges
 * `dropPrice` by `_id` and APPENDS id-less rows, so a row omitted from a save is not
 * deleted — it survives on the server, invisible to the rep, and the next id-less write
 * files a second copy beside it. That is the whole duplicate bug: mobile used to collapse
 * the list to one row per price, so its payload was a SUBSET of the server's while web's
 * was the server's array verbatim plus the new round. Two helpers lived here for exactly
 * that — `collapseDropsByPrice` (one row per price) and `dedupeDrops` (byte-identical
 * rows) — and BOTH have been deleted. The double-tap they doubled as a guard against is
 * now handled where it belongs: `DropOutcomeModal` accepts one Decline/Secure per
 * opening. Do not reintroduce either to a save or a hydrate.
 *
 * The single-accepted invariant below is the one rule that still runs on both paths, and
 * it is safe precisely because it rewrites a STATUS rather than dropping a row.
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


/**
 * ROOT CAUSE of "adding or declining a drop saves a duplicate".
 *
 * The backend treats `dropPrice` as a subdocument array: a row that arrives WITH an
 * `_id` updates that row, a row WITHOUT one is FILED AS NEW. Web's payload therefore
 * carries the `_id` of every already-saved round:
 *
 *   {"dropPrice":[{"_id":"6a86b180…","dropedPrice":10000,"status":"declined", …},
 *                 {"dropedPrice":9000,"status":"declined", …}]}   ← only the new one is id-less
 *
 * Mobile never adopted the ids the server assigned — `flushSave` discarded the PUT
 * response — so EVERY save re-sent the same round id-less and the server filed another
 * copy. One drop, entered then secured, is two saves and therefore two rows; the
 * debounced engine can make it more. `dedupeDrops`/`collapseDropsByPrice` above were
 * written to hide exactly this, on both sides of the wire. They stay as the repair path
 * for records already corrupted, but they are a poultice — the fix is to send the `_id`.
 */

const dropIdOf = (d: any): string => String(d?._id ?? '');
const dropPriceOf = (d: any): number => Math.round(Number(d?.price ?? d?.dropedPrice ?? 0));

/**
 * The `dropPrice` rows in a `PUT /lfcalculators/{id}` response, whatever it is wrapped in.
 *
 * Walks a FIXED list of roots rather than guessing a path: an unrecognised response
 * yields `[]` and the caller simply doesn't adopt this time (the next save retries),
 * which is the right failure mode for something that only ever ADDS an id.
 */
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

/**
 * Copy the server's `_id` onto each local drop that hasn't got one, so the NEXT save
 * updates that row instead of filing a second copy of it.
 *
 * Matched by (price, status) among server rows not already claimed, rather than by
 * index: when a record is already corrupted the server array is LONGER than the one we
 * sent, so index alignment is exactly the assumption that cannot be trusted here. Each
 * server row is claimed at most once, so two genuine rounds at the same price take two
 * different ids. A row we can't match is left alone — an id-less row costs one more
 * duplicate, a WRONG id would overwrite somebody else's round.
 *
 * Returns the SAME reference when nothing is adopted, so this is safe to call after
 * every save without churning identity or re-renders.
 */
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

/**
 * A drop list in the shape the backend (and web) expect.
 *
 * Web sends exactly `_id?` / `dropedPrice` / `status` / `paymentMethod` / `pricemarkup` /
 * `downPayment` / `balance`. Mobile additionally mirrored the amount into a `price` key,
 * which is redundant with `dropedPrice` and is not part of the stored shape — every local
 * reader already falls back `price ?? dropedPrice`, so dropping it from the WIRE changes
 * nothing on screen and makes a mobile row byte-comparable with a web one.
 *
 * ⚠️ `paymentMethods` (the financing shortlist a drop was negotiated with) is a MOBILE-ONLY
 * extra and is deliberately kept: `DropOutcomeModal` re-opens a declined drop with those
 * plans still added, so stripping it to reach exact web parity would lose that state on
 * reload. It is omitted when empty rather than sent as `[]`.
 */
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

/**
 * A stable key for the drops that have NOT been filed yet (price + status of each).
 *
 * Used to spend at most one fallback read per distinct set of id-less rows, so a PUT
 * response that never echoes `dropPrice` cannot make every debounced save issue a GET.
 */
export function idlessDropSignature(drops: any[] | null | undefined): string {
  if (!Array.isArray(drops)) return '';
  return drops
    .filter((d) => !dropIdOf(d))
    .map((d) => `${dropPriceOf(d)}:${d?.status ?? ''}`)
    .join('|');
}
