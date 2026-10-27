/**
 * Reconciling a queued funding save with what the server has since collected.
 *
 * Reported from the field: an offline deal synced and the rep was told
 * "Cannot remove $100 Check - it has already been collected", with the whole deal stuck.
 *
 * `savePayments` is a FULL-LIST save: whatever is absent from `payments` reads as a removal,
 * and the server refuses to remove a row that has money on it. A queued payload is a snapshot
 * of what the rep saw offline, so any payment collected since - by the office, the portal, or
 * an earlier partial drain of this same deal - is missing from it, and the save is refused.
 *
 * The ONLINE path never hits this: `ResultJobModal` re-sends settled rows via `withSettledRows`.
 * This is the same rule for the queue, applied at DRAIN time rather than at queue time, because
 * the collection can happen while the phone is offline and long after the snapshot was taken.
 *
 * Pure (no RN imports) so it can be tested - see CLAUDE.md section 6.
 */

export interface SettledLike {
  pid?: string | null;
  kind?: unknown;
  method?: unknown;
  type?: unknown;
  amount?: unknown;
  charged?: boolean;
  collected?: boolean;
}

/** Money has moved on this row; only a refund reverses it. */
export const isSettledPaymentRow = (p: SettledLike | null | undefined): boolean =>
  Boolean(p?.charged || p?.collected);

/**
 * The payment list to SEND: every settled row the server holds that our snapshot does not
 * mention, followed by the queued rows.
 *
 * WARNING: carried rows are copied verbatim, never edited or re-priced - they are a record of
 * money that already moved. A queued row with the same `pid` WINS, because that is the rep
 * editing a row they could see; this only re-adds rows they never had.
 */
export const mergeSettledPayments = <T extends SettledLike>(
  queued: readonly T[] | null | undefined,
  serverPayments: readonly SettledLike[] | null | undefined
): T[] => {
  const mine = Array.isArray(queued) ? [...queued] : [];
  const known = new Set(
    mine.map((r) => String(r?.pid || '')).filter((id) => id.length > 0)
  );

  const carried = (Array.isArray(serverPayments) ? serverPayments : [])
    .filter((p) => isSettledPaymentRow(p))
    .filter((p) => {
      const pid = String(p?.pid || '');
      return pid.length > 0 && !known.has(pid);
    })
    .map((p) => ({
      pid: p.pid,
      kind: p.kind,
      method: p.method,
      type: p.type,
      amount: p.amount,
    })) as unknown as T[];

  return carried.length ? [...carried, ...mine] : mine;
};
