/**
 * funding.ts — the pure rules behind the **Funding** step of the Result Lead sheet
 * (`ResultJobModal` → `FundingView`), sitting on top of `FundingService`.
 *
 * A sale is no longer "one down-payment method + one balance method". The rep can
 * split the contract across several instruments and each one has its own life
 * cycle that has to be driven to the end:
 *
 *   check → Collected → Deposited
 *   card  → Link Sent → Card on File → Charged
 *   bank  → Link Sent → Approved → Activated → Funded
 *
 * ⚠️ **The server owns every step.** Nothing here advances a payment; these
 * functions only READ the record the API returned and decide how to draw it, what
 * is still blocking, and how a lender decision folds back onto the pricing rows.
 * No React and no react-native imports, so it stays testable — every component
 * under `components/funding/` is a renderer over this file.
 */

import type { DealPlan } from '../hooks/useDealPricing';
import {
  newPaymentId,
  toWholeDollars,
  type FundingApplicationClosed,
  type ApprovalRecord,
  type FundingApprovalReminder,
  type FundingArchivedPlan,
  type FundingChannel,
  type FundingRefund,
  type FundingRefundMethod,
  type FundingRefundReason,
  type FundingRefundState,
  type FundingDecision,
  type FundingKind,
  type FundingMethodType,
  type FundingPaymentRow,
  type FundingRecord,
  type FundingUpsertRow,
  type PaymentAllocation,
} from '../../../services/api/FundingService';
// Display-only, and the ONLY react-native-free util this file needs: a stored
// destination is E.164 (`+14438784937`) and has to read back as the rep typed it.
// `toE164USPhone` joins it for `normalizeDestination`, which has to compare a
// stored E.164 against whatever the rep just typed.
import { formatLocalUSPhone, toE164USPhone } from '../../../utils/phone-util';

/**
 * Splitting a half of the contract across SEVERAL payment lines — **on**.
 *
 * It gates the "Add payment method" buttons **and** the per-row ✕. The two travel
 * together deliberately: with Add disabled, removing a row would be unrecoverable
 * inside the session, so the rep would be one tap away from a dead end.
 *
 * ⚠️ One exception, and it is intentional: the recovery row `applyDecisionsToRows`
 * opens after a DECLINE is not gated. That is not the rep adding a line — it is
 * the system replacing a dead one, and it is the only way a declined deal can be
 * re-assigned at all. The rep still cannot remove it.
 *
 * ⚠️ Turning this on is what makes several rows of the SAME amount and method
 * possible, which is why `describePayment` exists — two identical `$500 Check`
 * lines otherwise produce two identical blocker sentences and two identical cards,
 * and the rep cannot tell which one the screen is talking about.
 */
export const MULTI_METHOD_ENABLED = true;

/**
 * How the contract is being paid.
 *
 * `split`   — money now (Down Payment) + the rest financed/collected later (Balance).
 * `upfront` — the whole contract paid in one go at the table; no balance exists.
 */
export type PayMode = 'split' | 'upfront';

/**
 * A pricing row's group.
 *
 * ⚠️ `'up'` is **client-side only** — the wire enum is `'down' | 'bal'` and the
 * server would reject a third value. An upfront row travels as `'down'`, which is
 * not a fudge: `down` means *collected now* to every server rule that reads it
 * (only a `down` card can be charged, only a `down` check can be marked collected),
 * and that is exactly what upfront is. `wireKind` is the one place it converts.
 */
export type PaymentKind = FundingKind | 'up';
export type MethodType = FundingMethodType;
export type Decision = FundingDecision;
/** A payment as the SERVER holds it — the funding screen renders this, nothing else. */
export type FundingPayment = FundingPaymentRow;

export { newPaymentId, toWholeDollars };

/** Client kind → the enum the API accepts. See `PaymentKind`. */
export function wireKind(kind: PaymentKind): FundingKind {
  return kind === 'up' ? 'down' : kind;
}

/** The group that absorbs an unassigned gap in each mode. */
export function remainderKind(mode: PayMode): PaymentKind {
  return mode === 'upfront' ? 'up' : 'bal';
}

/** Whole dollars with separators — every money string on these screens. */
function money(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Step labels per method type. Index order IS the step order. */
export const FLOW: Record<MethodType, string[]> = {
  check: ['Collected', 'Deposited'],
  cc: ['Link Sent', 'Card on File', 'Charged'],
  bank: ['Link Sent', 'Approved', 'Activated', 'Funded'],
};

/**
 * How a step renders. `next` is "not reached yet"; `locked` is "never a rep step" —
 * somebody else (the bank, the processor, the install crew) posts it after the rep
 * has left, so it must not read as work the rep forgot to do.
 */
export type StepState = 'done' | 'now' | 'next' | 'warn' | 'bad' | 'locked';

/** One editable line on the pricing screen: an amount against a payment method. */
export interface PaymentRow {
  /** Server merge key. ⚠️ Stable across saves and across visits — see `newPaymentId`. */
  pid: string;
  kind: PaymentKind;
  /** Kept as TEXT so the input can hold `''` mid-typing instead of snapping to 0. */
  amount: string;
  /** Plan KEY into `DealPricing.plans` (`''` until the rep picks one). */
  method: string;
  /**
   * The label the server holds, when it maps to no plan in this company's catalogue
   * (a renamed or retired plan). Display falls back to it so a saved row never
   * renders blank just because its plan is gone.
   */
  methodLabel?: string;
  /**
   * The derived remainder row. Its amount is computed from the contract price, so
   * it is not typeable and it is the row that absorbs whatever is left over.
   */
  auto?: boolean;
  /** Mirrors the server row — a decided row is a locked fact, not an input. */
  decision?: Decision | null;

  /**
   * ── mirrored lender state, for the method CHIP ────────────────────────────
   * A decision alone cannot say what the chip has to say: "Approved" and
   * "Approved & activated" are different facts to a rep, and a row whose link has
   * gone out but has no answer yet is "Pending lender decision" rather than "Not
   * yet submitted". All three come off the server row, so they are mirrored here
   * rather than read through a second lookup — that way the chip and the amount
   * beside it can never describe two different moments.
   */
  linkSent?: boolean;
  activated?: boolean;
  /**
   * The money has actually MOVED — a card charged, or a check taken.
   *
   * ⚠️ Mirrored for the same reason `decision` is: without them the pricing screen
   * cannot tell a charged down payment from an untouched one, and offers to remove or
   * swap money that is already with the processor.
   */
  charged?: boolean;
  collected?: boolean;

  /**
   * Plans this row has been swapped away from, newest first — the archived block
   * under the chip, and what `restore` addresses by `archivedId`.
   */
  archived?: FundingArchivedPlan[];

  /**
   * ── drift ─────────────────────────────────────────────────────────────────
   * The lender is committed to `baseline`; the job now needs `liveUsage`.
   *
   * ⚠️ Re-priced by an addendum is exactly how a row drifts, so this is the deal-edit
   * wizard's normal case rather than an edge one. Shown under the amount as
   * `Prior $X` + the delta, so the rep can see that the number on screen is not yet
   * the number the lender agreed to.
   */
  baseline?: number | null;
  liveUsage?: number | null;
  drifted?: boolean;
}

/**
 * What the method chip says about a row, and in which colour.
 *
 * Pure and in one place because the chip is the only thing on the pricing screen
 * that reports a THIRD PARTY's position. Getting it wrong does not look like a
 * rendering bug — it looks like the lender said something they did not.
 *
 * ⚠️ Order matters: `declined` outranks everything (a declined row is not "pending"
 * merely because a link also went out), and `activated` only qualifies an approval.
 */
export type LenderTone = 'neutral' | 'pending' | 'approved' | 'declined';

export function lenderState(
  row: PaymentRow,
  /**
   * Is this line carried by a LENDER (a financing plan) rather than paid in cash or
   * by card?
   *
   * ⚠️ It only changes the un-submitted case, and it changes it for a real reason: a
   * financing balance with no application out yet is genuinely OUTSTANDING — somebody
   * has to send it — where a check the install crew collects needs nothing from
   * anyone. Painting both amber would make "needs attention" mean nothing; painting
   * both grey would hide the one line that does.
   */
  financing?: boolean
): { tone: LenderTone; sub: string } {
  if (row.decision === 'declined') return { tone: 'declined', sub: 'Declined by lender' };
  if (row.decision === 'full' || row.decision === 'short') {
    return {
      tone: 'approved',
      sub: row.activated
        ? 'Approved & activated'
        : row.decision === 'short'
          ? 'Approved in part'
          : 'Approved',
    };
  }
  // ⚠️ Settlement reads GREEN and names itself. Without this a charged card falls
  // through to the amber "Pending lender decision" below — which is wrong twice over:
  // the money is already in, and no lender is involved in a card at all. It also
  // leaves a row whose Remove and Swap have both vanished with nothing explaining why.
  if (row.charged) return { tone: 'approved', sub: 'Charged' };
  if (row.collected) return { tone: 'approved', sub: 'Collected' };
  if (row.linkSent) return { tone: 'pending', sub: 'Pending lender decision' };
  return { tone: financing ? 'pending' : 'neutral', sub: 'Not yet submitted' };
}

/**
 * ── swapping a plan, and getting it back ────────────────────────────────────
 *
 * The mockup's `swapMethod` / `restoreMethod` are a LOCAL, symmetric stack: picking a
 * new plan pushes the outgoing one onto the shelf, and restoring pushes the current one
 * back in exchange, so nothing is ever lost and a restore can itself be undone.
 *
 * ⚠️ It has to be local because it happens BEFORE any save. The server keeps its own
 * `archived[]` and its own `POST …/restore`, but a plan the rep swapped away from two
 * seconds ago has no `archivedId` yet — there is nothing for that endpoint to address.
 * So the shelf renders BOTH: entries the server archived (restored through the API) and
 * entries this session archived (restored in state). `isLocalArchive` tells them apart,
 * which is what stops a local entry being sent to an endpoint that would 404 on it.
 */
const LOCAL_ARCHIVE_PREFIX = 'local-';

export function isLocalArchive(entry: { archivedId?: string } | null | undefined): boolean {
  return String(entry?.archivedId || '').startsWith(LOCAL_ARCHIVE_PREFIX);
}

/** A snapshot of the plan a row is carrying right now, for the shelf. */
function snapshotPlan(row: PaymentRow, plans: Record<string, DealPlan>): FundingArchivedPlan {
  return {
    archivedId: `${LOCAL_ARCHIVE_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
    method: methodLabelOf(plans, row.method) || row.methodLabel || row.method || '',
    // The KEY is what puts the plan back on the row; the label above is only what the
    // shelf reads. Kept beside it so a restore never has to re-resolve a display string.
    planKey: row.method,
    ...(row.decision ? { decision: row.decision } : {}),
  };
}

/**
 * Change a row's plan, archiving the one it was carrying.
 *
 * ⚠️ Archiving happens ONLY on a chip row — i.e. only when the change came from **Swap**.
 * The ordinary dropdown on an untouched line is a rep picking a method for the first
 * time, not replacing a plan; shelving those would fill the block with every mis-tap.
 * `showsChip` is exactly that test, because Swap is the only method control a chip row
 * has.
 *
 * ⚠️ The incoming plan starts UNPROVEN — `linkSent` / `decision` / `activated` are
 * cleared. That is the mockup's rule ("the freshly-picked plan never inherits green") and
 * it is also what the SERVER does: changing `method` resets that row's steps, link and
 * decision. Carrying them over would show a green "Approved" chip for a lender who has
 * never seen this plan.
 */
export function swapRowMethod(
  rows: PaymentRow[],
  pid: string,
  nextKey: string,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  return rows.map((r) => {
    if (r.pid !== pid) return r;
    // Nothing to archive when the plan is unchanged, when the row never had one, or
    // when the change came from the plain dropdown rather than Swap.
    if (!nextKey || nextKey === r.method || !r.method || !showsChip(r)) {
      return { ...r, method: nextKey };
    }
    return {
      ...r,
      method: nextKey,
      methodLabel: undefined,
      linkSent: false,
      activated: false,
      decision: null,
      archived: [snapshotPlan(r, plans), ...(r.archived || [])],
    };
  });
}

/**
 * Put an archived plan back on the row — the LOCAL half of restore.
 *
 * ⚠️ **Symmetric**, matching both the mockup and the server: the plan the row is
 * carrying goes onto the shelf in exchange, so the shelf is never emptied by a restore
 * and the restore can be undone the same way.
 *
 * ⚠️ Deliberate divergence from the mockup's `restoreMethod`, whose comment says it
 * "brings back exactly the status that plan had when it was archived". We reset the
 * lender state instead. Locally we cannot honestly claim a lender still stands behind a
 * plan the row has not carried for the last few minutes, and the server resets those
 * steps on a method change anyway — so restoring them would put a green chip on a plan
 * the next save is about to un-approve.
 */
export function restoreRowPlan(
  rows: PaymentRow[],
  pid: string,
  archivedId: string,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  return rows.map((r) => {
    if (r.pid !== pid) return r;
    const shelf = r.archived || [];
    const entry = shelf.find((a) => a.archivedId === archivedId);
    if (!entry) return r;
    const key = (entry as any).planKey || planKeyForLabel(plans, entry.method) || entry.method || '';
    return {
      ...r,
      method: key,
      // A plan that has left the catalogue resolves to no key; its stored label is then
      // the only handle the row still has on what the money was committed to.
      methodLabel: key && plans[key] ? undefined : entry.method,
      linkSent: false,
      activated: false,
      decision: null,
      archived: [
        ...(r.method || r.methodLabel ? [snapshotPlan(r, plans)] : []),
        ...shelf.filter((a) => a.archivedId !== archivedId),
      ],
    };
  });
}

/**
 * Is this line SETTLED — has its money actually moved, or has a third party answered
 * for it?
 *
 * ⚠️ This is what `!!row.decision` used to stand in for, and the gap mattered:
 * `decision` only ever exists on a FINANCING row, so a down payment card that had been
 * **charged** — or a check already **collected** — counted as untouched. The pricing
 * screen then offered **Remove** and **Swap** on money that is with the processor, and
 * a swap resets the row's steps, link and decision server-side.
 *
 * A settled row is a FACT, not an input: its amount is read-only, its method is fixed,
 * and it cannot be deleted.
 */
export function isSettledRow(row: PaymentRow): boolean {
  return Boolean(row.decision || row.charged || row.collected);
}

/**
 * May the rep delete this line?
 *
 * ⚠️ Mirrors the SERVER's own rule rather than inventing one: `PUT` sends the complete
 * list and omitting a row deletes it, but the API **refuses with 409 a row that has a
 * sent link or a decision** — and settlement is stricter still. Offering a control that
 * can only fail is worse than not offering it; the rep's route out is to reassign the
 * money on the funding screen, not to make the row disappear.
 */
/**
 * Why this line's payment method cannot be changed — shown when the rep taps a locked
 * one (the padlock alone says *that* it is shut, never *why*).
 *
 * ⚠️ **Each reason names what actually happened**, because the rep's next move differs:
 * a declined line needs another method for the balance, whereas a collected cheque
 * needs a refund if the money really has to move. A single generic "this is locked"
 * would send them looking for a control that does not exist.
 *
 * ⚠️ Precedence matches `lenderState`: a lender's VERDICT outranks the money having
 * moved, so `{ decision: 'declined', charged: true }` reads as declined. Returns `''`
 * for an unlocked row, so the caller can gate on it.
 */
export function lockedMethodNote(row: PaymentRow): string {
  if (!isSettledRow(row)) return '';
  if (row.decision === 'declined') {
    return 'The lender declined this line, so its payment method is locked. Add another payment method for the balance.';
  }
  if (row.decision) {
    return 'The lender has already answered this line, so its payment method is locked.';
  }
  if (row.charged) {
    return 'This card has already been charged. Changing the method would reset the payment, so it is locked — a refund is the only way money goes back.';
  }
  if (row.collected) {
    return 'This payment has already been collected. Changing the method would reset it, so it is locked — a refund is the only way money goes back.';
  }
  return 'This payment has already started, so its method is locked.';
}

export function isRemovableRow(row: PaymentRow): boolean {
  return !isSettledRow(row) && !row.linkSent;
}

/**
 * Does this row have a lender position worth reporting?
 *
 * Kept separate from `showsChip` below: a DECIDED row must show its verdict wherever
 * it sits, including on a line the rep added by hand.
 */
export function hasLenderState(row: PaymentRow): boolean {
  // `charged` / `collected` included so a settled line still draws the chip — that is
  // the only place it can say "Charged" instead of silently losing both its buttons.
  return Boolean(row.decision || row.linkSent || row.activated || row.charged || row.collected);
}

/**
 * Does this line render the **chip** (name + status + Swap) instead of the method
 * dropdown?
 *
 * ⚠️ This is the mockup's own split, and it is structural rather than stateful:
 * `autoRowHtml` draws the chip for the REMAINDER row, `simpleRowHtml` draws a
 * dropdown for every other line. So the Down Payment reads `$500 · MC/VISA ⌄ ·
 * Remove` while the Balance reads `$2,363 · GreenSky · Approved & activated · Swap`
 * — which is exactly what the two screenshots show side by side.
 *
 * ⚠️ It first shipped gated on `hasLenderState` alone, and that is what dropped
 * **Swap** from the Balance line entirely: a deal seeded from the sale has a method
 * but no lender activity yet, so the row fell through to a plain dropdown and the
 * archived shelf had no way to be reached. The auto row is the one the shelf belongs
 * to, so the auto row is the one that must carry the control.
 *
 * A decided row is included wherever it sits, because a verdict is not something to
 * hide behind a chevron.
 */
export function showsChip(row: PaymentRow): boolean {
  return Boolean(row.auto) || hasLenderState(row);
}

/**
 * The drift line under a drifted row's amount, or `null` when there is nothing to
 * say.
 *
 * ⚠️ Requires a REAL baseline: the server sets `drifted` from its own comparison, and
 * a row that has one without the other would otherwise render `Prior $0`, which
 * reads as the lender having committed to nothing.
 */
export function driftNote(row: PaymentRow): { prior: string; delta: string; up: boolean } | null {
  if (!row.drifted) return null;
  const prior = Number(row.baseline);
  const live = Number(row.liveUsage);
  if (!Number.isFinite(prior) || !Number.isFinite(live) || prior <= 0) return null;
  const diff = live - prior;
  if (diff === 0) return null;
  return {
    prior: `Prior $${money(prior)}`,
    delta: `${diff > 0 ? '+' : '−'}$${money(Math.abs(diff))}`,
    up: diff > 0,
  };
}

/** A message shown above the Balance group after a decision comes back. */
export interface DecisionBanner {
  id: string;
  tone: 'warn' | 'bad';
  text: string;
}

/** Read-only lender attempt, kept on the job whether or not the money moved. */
export interface AttemptLogEntry {
  method: string;
  amt: number;
  approved: number;
  at: string;
  outcome: 'Full' | 'Partial' | 'Declined';
}

// ── amounts ────────────────────────────────────────────────────────────────

/** Parse a row's text amount. Non-numeric / blank reads as 0, never NaN. */
export function rowAmount(row: Pick<PaymentRow, 'amount'>): number {
  const n = parseFloat(String(row.amount).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the auto (remainder) row should show: the contract price minus everything
 * the rep has explicitly assigned.
 */
export function autoAmount(rows: PaymentRow[], price: number): number {
  const used = rows.reduce((sum, r) => (r.auto ? sum : sum + rowAmount(r)), 0);
  return Math.max(price - used, 0);
}

/** The amount a row contributes, resolving the auto row against the price. */
export function effectiveRowAmount(row: PaymentRow, rows: PaymentRow[], price: number): number {
  return row.auto ? autoAmount(rows, price) : rowAmount(row);
}

/** Total assigned across every row (the auto row included). */
export function assignedTotal(rows: PaymentRow[], price: number): number {
  return rows.reduce((sum, r) => sum + effectiveRowAmount(r, rows, price), 0);
}

// ── payment structure ──────────────────────────────────────────────────────

/** Money is money — compare with a cent of slack rather than exactly. */
const EPS = 0.01;

/**
 * Which structure a saved record represents.
 *
 * Read from the shape rather than stored, because the API has no field for it:
 * a record with payments but **no balance row** is a contract being collected in
 * full now, which is upfront by definition. Split always leaves a balance row
 * (the remainder absorber), so the two can never be confused.
 *
 * ⚠️ A *split* deal whose down payment happens to cover the whole price also
 * saves with no balance row, and will reopen as Upfront. That is the honest
 * reading — nothing is being financed and nothing settles after install — and it
 * changes only the labelling, never a payment's own behaviour.
 */
export function inferPayMode(record: FundingRecord | null | undefined): PayMode {
  const saved = record?.payments || [];
  if (!saved.length) return 'split';
  return saved.some((p) => p.kind === 'bal') ? 'split' : 'upfront';
}

/**
 * Has money on this job actually started moving?
 *
 * Once it has, the structure is settled: an upfront row that has already been
 * charged cannot be re-cast as a down payment against a balance that does not
 * exist, and the rep would be re-describing a payment the processor has already
 * taken. The rep voids it on the funding screen first.
 *
 * ⚠️ Tested against the server's own BOOLEANS as well as `step`, because a lender
 * decision leaves `step` at 1 (spec §4) — reading `step` alone would call an
 * approved loan "not started".
 */
export function structureLocked(payments: FundingPayment[]): boolean {
  return payments.some(
    (p) => p.linkSent || p.step > 0 || p.decision != null || p.collected || p.charged || p.activated
  );
}

/** The caption under the structure selector. `nudge` = the rep just tried to switch. */
export function structureHint(mode: PayMode, locked: boolean, nudge?: boolean): string {
  if (locked) {
    return nudge
      ? 'A payment on this job has already started. Void it on the funding screen before switching structure.'
      : 'Structure is set — a payment on this job has already started.';
  }
  return mode === 'upfront'
    ? 'Upfront collects the whole contract now. No down payment or balance is created.'
    : '';
}

export type CoverageTone = 'ok' | 'short' | 'over';

/**
 * The upfront coverage bar: is the whole contract accounted for by typed amounts?
 *
 * Upfront has no remainder row to quietly absorb a gap — every dollar is typed —
 * so this is the only thing telling the rep the split still adds up.
 */
export function coverageState(assigned: number, price: number): { tone: CoverageTone; message: string; tally: string } {
  const gap = price - assigned;
  const tally = `$${money(assigned)} of $${money(price)}`;
  if (Math.abs(gap) <= EPS) return { tone: 'ok', message: 'Full contract covered', tally };
  if (gap > 0) return { tone: 'short', message: `$${money(gap)} still to assign`, tally };
  return { tone: 'over', message: `$${money(-gap)} over contract price`, tally };
}

/**
 * What still stops **Confirm** from opening the funding screen.
 *
 * Listed rather than thrown: the mockup puts these above a disabled button so the
 * rep works the list, instead of tapping a live button and being told no. Phrased
 * as the next action, same as `fundingBlockers`.
 */
export function confirmBlockers(
  rows: PaymentRow[],
  price: number,
  mode: PayMode = 'split',
  /**
   * Money that is over the contract price because it has ALREADY BEEN COLLECTED and
   * is going back as a refund (see `refundDueFor`).
   *
   * ⚠️ Without this the refund flow DEAD-ENDS, and it is not a subtle failure: a
   * $500 contract with $900 already charged reads "Payments add up to $900 — $400
   * more than the contract price" and disables Confirm. The rep cannot clear it —
   * the row is settled, so its amount is read-only and it cannot be removed — so
   * there is no way forward at all, including to the step where the refund is
   * actually raised.
   *
   * The overage IS the refund. It is only still a blocker for whatever exceeds it.
   */
  opts?: { refundDue?: number }
): string[] {
  if (!(price > 0)) return ['Enter the contract price'];

  const out: string[] = [];
  const funded = rows.filter((r) => effectiveRowAmount(r, rows, price) > 0);
  if (!funded.length) out.push('Assign the contract to at least one payment method');
  // A row carrying a stored label counts as named even when its plan has left the
  // catalogue — the money is committed to a real method, just one we can't re-pick.
  if (funded.some((r) => !r.method && !r.methodLabel)) {
    out.push(
      mode === 'upfront'
        ? 'Pick a payment method for every upfront amount'
        : 'Pick a payment method for every amount entered'
    );
  }

  /**
   * ⚠️ The mirror of the rule above, and it only became reachable when
   * `MULTI_METHOD_ENABLED` turned on: a row the rep ADDED and gave a method but no
   * amount. `toUpsertRows` drops it (the server rejects a zero amount with 422),
   * so without this the line the rep just filled in silently never reaches the
   * deal — the auto row quietly re-absorbs its money and nothing says why.
   *
   * The AUTO row is exempt: it is $0 exactly when everything else already covers
   * the contract, which is the correct end state, not a gap.
   *
   * ⚠️ …and so is an ENTIRELY UNFUNDED DOWN PAYMENT — "no money down", with the
   * balance carrying the whole contract. That is a complete answer and has to reach
   * the funding screen so the balance can go for approval.
   *
   * The exemption is scoped to `down`, and both halves of that matter:
   *
   * - **`down` only**, because it is the ONLY group whose row is named without the
   *   rep choosing anything: the mount seed fills it from the lead's own payment
   *   method (`seedDownMethod`). Every other non-auto row is either one the rep
   *   added or one hydrated from a save that carried money, so on those the "you
   *   picked a method, so you meant to fund it" signal this rule reads is real.
   *   (The upfront and re-entry seeds all use `method: ''`.)
   * - **entirely unfunded**, so $1,300 down beside a second down line left blank is
   *   still the forgotten amount it looks like, and still blocked.
   *
   * ⚠️ Nothing is lost by exempting it: a blank row contributes $0, so the auto
   * row's remainder is identical whether it is dropped or kept, and the coverage
   * rule below is unaffected. The rep can still delete the line outright with its ✕;
   * this stops the more obvious gesture — clearing the amount — from dead-ending on
   * a message about a line they never added.
   */
  const downIsFunded = rows.some((r) => r.kind === 'down' && effectiveRowAmount(r, rows, price) > 0);
  const emptyNamed = rows.filter(
    (r) =>
      !r.auto &&
      !r.decision &&
      (r.method || r.methodLabel) &&
      effectiveRowAmount(r, rows, price) <= 0 &&
      !(r.kind === 'down' && !downIsFunded)
  );
  if (emptyNamed.length) {
    // Deliberately NOT named: `PaymentRow.method` is a plan KEY, and this function
    // has no catalogue to resolve it against — a line reading "Enter an amount for
    // 2521" is worse than one that doesn't try.
    out.push(
      emptyNamed.length === 1
        ? 'Enter an amount for the payment method you added, or remove that line'
        : `Enter an amount for every payment method you added — ${emptyNamed.length} have none`
    );
  }

  const total = assignedTotal(rows, price);
  // ⚠️ An acknowledged refund EXPLAINS that much of the overage — it is money the
  // company is holding and giving back, not money the rep mis-assigned and can trim.
  const refunded = Math.max(0, Math.round(Number(opts?.refundDue) || 0));
  const over = total - price - refunded;
  if (over > EPS) {
    out.push(
      mode === 'upfront'
        ? `Upfront is $${money(over)} over the contract price`
        : `Payments add up to $${money(total)} — $${money(over)} more than the contract price`
    );
  } else if (total < price - EPS) {
    out.push(`$${money(price - total)} of the contract is still unassigned`);
  }
  return out;
}

// ── methods ────────────────────────────────────────────────────────────────

/**
 * Classify a plan key locally — used only to keep financing out of the Down
 * Payment picker before a save.
 *
 * ⚠️ The SERVER is authoritative (spec §3.1: it resolves `type` from the method
 * label against the company catalogue, and discards any `type` we send). Always
 * render `payment.type` from the response, never this.
 */
export function methodTypeOf(plans: Record<string, DealPlan>, key?: string): MethodType | null {
  const plan = plans[key || ''];
  if (!plan) return null;
  if (plan.type === 'financing') return 'bank';
  if (plan.type === 'card') return 'cc';
  return 'check';
}

/** Catalog label for a plan key — this is what `method` is sent AS (spec §3). */
export function methodLabelOf(plans: Record<string, DealPlan>, key?: string): string {
  return plans[key || '']?.label || key || '';
}

/**
 * Reverse of `methodLabelOf`: the plan key whose label the server stored.
 *
 * The API holds the LABEL, not the key, so a saved row has to be mapped back
 * before the picker can show it selected. Returns `''` when the catalogue no
 * longer has that plan — the row then displays its stored label via
 * `PaymentRow.methodLabel` rather than going blank.
 */
export function planKeyForLabel(plans: Record<string, DealPlan>, label?: string): string {
  if (!label) return '';
  const hit = Object.keys(plans).find((k) => plans[k]?.label === label);
  return hit || '';
}

/**
 * The label without its parenthetical, for prose: `1509 (10.99% APR…)` → `1509`.
 * Banners and blockers read as sentences, and the full label is a paragraph.
 */
export function shortMethod(label: string): string {
  return String(label).split(' (')[0].trim() || label;
}

// ── naming a payment among its duplicates ──────────────────────────────────

/**
 * How a payment is named in prose and on its card: `$500 Check`, or
 * `$500 Check (1 of 2)` when the job carries more than one line with the same
 * amount AND the same method.
 *
 * ⚠️ Not cosmetic. Once a half of the contract can be split across repeated lines,
 * two `$500 Check` rows produce two byte-identical blocker sentences and two
 * byte-identical cards, and the rep cannot tell which one the screen means. The
 * server emits `(1 of 2)` / `(2 of 2)` in its own blockers, and ⚠️ **this must
 * match it exactly** — the two lists sit in the same footer, the server's
 * replacing ours on a refused submit, and a divergence there is worse than having
 * no local list at all because the rep trusts the screen.
 *
 * Ordinals are positional in `payments` order, which is the order the server
 * returns and the order the cards render, so the Nth sentence names the Nth card.
 */
export function describePayment(payment: FundingPayment, payments: FundingPayment[]): string {
  const base = `$${payment.amount.toLocaleString()} ${shortMethod(payment.method)}`;
  const twins = payments.filter(
    (p) => p.amount === payment.amount && shortMethod(p.method) === shortMethod(payment.method)
  );
  if (twins.length < 2) return base;
  const ordinal = twins.findIndex((p) => p.pid === payment.pid) + 1;
  // A row that is not in the list it is being described against (defensive: a
  // caller passing a filtered group) gets no misleading ordinal.
  if (ordinal < 1) return base;
  return `${base} (${ordinal} of ${twins.length})`;
}

// ── abandoned applications ─────────────────────────────────────────────────

/**
 * Why the homeowner's hosted page ended, phrased for a rep at a kitchen table.
 *
 * ⚠️ The server RESETS the row to unsent when this lands, so without reading it
 * the screen says *"link not sent yet"* about a link the rep watched them open —
 * which reads as an app bug rather than as the homeowner having closed the page.
 */
export const APPLICATION_CLOSED_TEXT: Record<FundingApplicationClosed, string> = {
  abandoned: 'The homeowner left the page without finishing.',
  canceled: 'The homeowner cancelled on the payment page.',
  expired: 'The link expired before it was completed.',
  error: 'The provider hit an error and could not finish.',
};

/** Short form for a blocker line: `— the application was abandoned; send a new link`. */
const APPLICATION_CLOSED_SHORT: Record<FundingApplicationClosed, string> = {
  abandoned: 'was abandoned',
  canceled: 'was cancelled',
  expired: 'expired',
  error: 'hit a provider error',
};

/**
 * Did this row's hosted page close without completing, and is that still the live
 * story?
 *
 * ⚠️ Gated on `!linkSent` and `!decision` on purpose. The flag is history once the
 * rep sends a fresh link (`linkSent` back to true) or a lender answers anyway, and
 * a stale "they abandoned it" banner over a working application is worse than none.
 */
export function isApplicationClosed(p: FundingPayment): boolean {
  return !!p.applicationClosed && !p.linkSent && !p.decision;
}

/**
 * ── resend the link ────────────────────────────────────────────────────────
 *
 * Can this row be sent again? (REVDSM-1155 Item A.)
 *
 * The case this exists for: the rep mistypes the homeowner's number or email, the
 * send succeeds as far as the server is concerned, and the row ticks **Link Sent**.
 * The send button is gated on `!linkSent`, so it disappears — and the rep is left on
 * a card that says the link went out, with no way to correct it. Nothing else on the
 * screen recovers that.
 *
 * ⚠️ **`link` is idempotent, so a resend delivers the SAME url** — it reuses the open
 * Checkout session rather than minting a second one. That is exactly right for "the
 * message never arrived": the page was always fine, the delivery was not. It is NOT a
 * way to revoke a link that leaked; that would need a new endpoint.
 *
 * ⚠️ Gated at **Link Sent but not yet Card on File** (the spec's wording). Past that
 * point a resend has no legitimate use — it quietly replaces the stored session
 * reference — and the backend intends to refuse it, so no UI may depend on it. The
 * route for "they want to use a different card" is Item B: remove the row in the
 * pricing panel and add a new one with a fresh `pid`.
 *
 * ⚠️ A **closed** application is deliberately excluded even though it also sits at
 * "sent". `isApplicationClosed` resets `linkSent` to false and the card already offers
 * *"Send a new link"* with a banner explaining why — two competing send controls on
 * one card would be worse than either alone.
 *
 * ⚠️ A **check** row can never resend: there is no link to send (the endpoint answers
 * 422), and the row has no `type === cc | bank` rail at all.
 */
export function canResendLink(p: FundingPayment): boolean {
  if (!p) return false;
  if (p.type !== 'cc' && p.type !== 'bank') return false;
  if (!p.linkSent) return false;
  // Money has already moved, or somebody has already answered — see the warnings.
  if (p.charged || p.collected) return false;
  if (p.type === 'cc') return !(p.step >= 2);
  return !p.decision && !p.activated;
}

/**
 * Where the last send went, for the card — `"Texted to 443-878-4937 · 2:04 PM"`.
 *
 * ⚠️ This is the half that actually fixes the reported bug. A rep who mistyped a
 * digit cannot tell from `Link Sent` alone that anything is wrong; showing the
 * destination back to them is what makes the mistake visible. The resend button
 * without it would just be a second chance to send to the same wrong number.
 *
 * A `qr` send has no destination by design — nothing was transmitted.
 */
export function lastSendNote(p: FundingPayment): string | null {
  if (!p || !p.linkSent || !p.sentChannel) return null;
  const at = formatStamp(p.sentAt);
  const when = at ? ` · ${at}` : '';
  if (p.sentChannel === 'qr') return `Scanned at the table${when}`;
  const to = String(p.sentTo || '').trim();
  const pretty = p.sentChannel === 'text' && to ? formatLocalUSPhone(to) || to : to;
  const verb = p.sentChannel === 'text' ? 'Texted to' : 'Emailed to';
  // A destination-less text/email should not read as `Texted to  · 2:04 PM`.
  if (!pretty) return `${p.sentChannel === 'text' ? 'Texted' : 'Emailed'}${when}`;
  return `${verb} ${pretty}${when}`;
}

/**
 * What the send sheet should open on when it is a RESEND.
 *
 * Lands on the channel that was used last with the destination **prefilled**, so the
 * rep corrects the digit they got wrong instead of retyping the whole thing from a
 * blank field — retyping is how the same typo gets made twice. `Back` still reaches
 * the other channels and the QR, so nothing is taken away.
 *
 * ⚠️ A `qr` resend opens on `choose`, not on a stage: there is nothing to correct
 * about a QR code, and the reason to resend one is almost always to switch channel.
 */
export function resendSeed(p: FundingPayment): {
  stage: 'choose' | 'text' | 'email';
  phone: string;
  email: string;
} {
  const blank = { stage: 'choose' as const, phone: '', email: '' };
  if (!p || !canResendLink(p) || !p.sentChannel) return blank;
  const to = String(p.sentTo || '').trim();
  if (p.sentChannel === 'text') return { stage: 'text', phone: formatLocalUSPhone(to), email: '' };
  if (p.sentChannel === 'email') return { stage: 'email', phone: '', email: to };
  return blank;
}

/**
 * ── re-issue: the link went to the WRONG person ────────────────────────────
 *
 * Normalise a destination so two spellings of the same recipient compare equal.
 *
 * ⚠️ Comparing the raw strings is not good enough and would silently disable the
 * whole re-issue path: the row stores E.164 (`+14438784937`) while the sheet holds
 * a display string, and an email differing only in case or trailing space is the
 * same inbox. A false "different" cancels a link that was fine; a false "same"
 * leaves a working link with a stranger. Both are worse than the typo.
 */
export function normalizeDestination(channel: FundingChannel, value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (channel === 'text') return toE164USPhone(raw);
  if (channel === 'email') return raw.toLowerCase();
  return '';
}

/**
 * Is this send going somewhere DIFFERENT from the last one? (REVDSM-1155.)
 *
 * The distinction is not cosmetic — the backend behaves differently on each side
 * of it, and the payment link is a **bearer credential**: whoever opens that URL
 * can put a card on this job.
 *
 * | | what the server does |
 * |---|---|
 * | same destination | reuses the open Checkout session — the "the SMS never arrived" case, where the page was always fine and only the delivery failed |
 * | **different destination** | **expires the old session first**, then mints a genuinely new page |
 *
 * So a corrected number is a **re-issue, not a resend**: the link the wrong person
 * is holding stops working. That is the point — before this, correcting the number
 * handed the stranger the very same URL again, and it stayed alive until Stripe
 * expired it 24 hours later. A mistyped number often belongs to a real person, who
 * could vault THEIR card against this job and look completely normal doing it.
 *
 * ⚠️ There is **no new endpoint** — the behaviour keys off the `destination` already
 * sent on `link-sent`. This predicate only tells the APP when to warn the rep, fix
 * the customer record and stop trusting a cached url.
 *
 * ⚠️ A **QR** send never re-issues: it has no destination, the rep is showing their
 * own screen, and there is no wrong recipient to worry about.
 *
 * ⚠️ A **first** send is never a re-issue either — there is no earlier link to
 * cancel, so warning about one would be a lie.
 */
export function isReissue(
  p: FundingPayment,
  channel: FundingChannel,
  destination?: string | null
): boolean {
  if (!p || !p.linkSent || channel === 'qr') return false;
  // Only a text/email row can have a destination to differ FROM. A row whose last
  // send was a QR has none, so switching to text is a first delivery, not a re-issue.
  if (p.sentChannel !== 'text' && p.sentChannel !== 'email') return false;
  const next = normalizeDestination(channel, destination);
  const prev = normalizeDestination(p.sentChannel, p.sentTo);
  // An unreadable stored destination cannot be compared. Treat it as unchanged: a
  // warning naming a blank recipient tells the rep nothing, and the server makes
  // the real decision either way.
  if (!next || !prev) return false;
  return next !== prev;
}

/**
 * The confirmation copy for a re-issue, or `null` when there is nothing to cancel.
 *
 * ⚠️ Worth a prompt even though the API does not require one: the rep is about to
 * kill a link the homeowner may already have open, and — the reason this ticket
 * exists — it is a last moment to check the new number before a SECOND stranger
 * gets one.
 */
export function reissueWarning(
  p: FundingPayment,
  channel: FundingChannel,
  destination?: string | null
): string | null {
  if (!isReissue(p, channel, destination)) return null;
  const old = String(p.sentTo || '').trim();
  const pretty = p.sentChannel === 'text' ? formatLocalUSPhone(old) || old : old;
  return `This cancels the link already sent to ${pretty}. It will stop working, and a new one will be sent instead.`;
}
/** The sentence for the card banner, or `null` when there is nothing to say. */
export function applicationClosedNote(p: FundingPayment): string | null {
  if (!isApplicationClosed(p)) return null;
  const why = APPLICATION_CLOSED_TEXT[p.applicationClosed as FundingApplicationClosed];
  // An unrecognised reason still gets a banner: the fact that it closed is the
  // part the rep acts on, and swallowing it would restore the "never sent" lie.
  return `${why || 'The application closed without completing.'} Send them a new link to try again.`;
}

// ── record → screen ────────────────────────────────────────────────────────

/**
 * Seed the pricing rows from a saved record.
 *
 * ⚠️ This is what keeps `pid` stable across visits, which is the whole merge
 * contract: reopening the sheet must reuse the saved ids, or the next `PUT`
 * creates a second set of rows for the same deal.
 *
 * ⚠️ It is also what makes a SPLIT contract survive a reload — three down-payment
 * rows come back as three rows, not as one row of the summed total. The funding
 * record is the authoritative multi-row source; the `downPayments` /
 * `balancePayments` arrays `paymentAllocations` writes onto the lead and the
 * outcome are for the CONSUMERS of the deal (contract details, agreements,
 * drafts), never for rehydrating this screen. Do not seed the rows from them —
 * they carry no `pid`, so doing so would break the merge contract above.
 *
 * The last undecided balance row is re-flagged `auto` so the remainder keeps
 * behaving as it did before the save — the server does not persist that flag
 * (it is a screen affordance, not funding state). An UPFRONT record has no
 * remainder row at all: every amount there is typed.
 *
 * The structure is re-derived here through `inferPayMode` rather than taken as an
 * argument, so the rows and the mode a caller reads can never disagree.
 */
export function hydrateRowsFromRecord(
  record: FundingRecord | null | undefined,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  const saved = record?.payments || [];
  if (!saved.length) return [];
  const upfront = inferPayMode(record) === 'upfront';
  const rows: PaymentRow[] = saved.map((p) => ({
    pid: p.pid,
    kind: upfront ? 'up' : p.kind,
    // A decided row shows what the lender GRANTED (spec §3.2) — that is the money
    // this line actually brings in, and it is what the totals must add up from.
    amount: String(p.decision ? (p.approvedAmt ?? p.amount) : p.amount),
    method: planKeyForLabel(plans, p.method),
    methodLabel: p.method,
    decision: p.decision,
    // Mirrored so the chip, the drift note and the archived shelf all read from the
    // same row the amount came off — see `lenderState` / `driftNote`.
    linkSent: p.linkSent,
    activated: p.activated,
    charged: p.charged,
    collected: p.collected,
    archived: p.archived,
    baseline: p.baseline,
    liveUsage: p.liveUsage,
    drifted: p.drifted,
  }));
  const lastOpenBalance = [...rows].reverse().find((r) => r.kind === 'bal' && !r.decision);
  if (lastOpenBalance) lastOpenBalance.auto = true;
  return rows;
}

/**
 * Project the pricing rows into the `PUT /funding` body.
 *
 * `method` is sent as the catalogue LABEL, because that is the field the server
 * resolves `type` from (spec §3.1) — sending a bare key like `1509` would fall
 * through the name heuristic and be classified `bank`.
 *
 * `type` is sent too, but only for forward-compatibility: the server discards it.
 * A row with no method or no money is omitted — it is not a payment yet.
 */
export function toUpsertRows(
  rows: PaymentRow[],
  price: number,
  plans: Record<string, DealPlan>
): FundingUpsertRow[] {
  return rows
    .map((row) => {
      const amount = toWholeDollars(effectiveRowAmount(row, rows, price));
      const method = row.method ? methodLabelOf(plans, row.method) : row.methodLabel || '';
      if (!method || amount <= 0) return null;
      return {
        // ⚠️ `up` is a client-side grouping; the wire only knows down/bal.
        pid: row.pid,
        kind: wireKind(row.kind),
        method,
        ...(methodTypeOf(plans, row.method) ? { type: methodTypeOf(plans, row.method)! } : {}),
        amount,
      } as FundingUpsertRow;
    })
    .filter((r): r is FundingUpsertRow => r !== null);
}

/**
 * Project the pricing rows into the `downPayments` / `balancePayments` arrays that
 * are persisted BESIDE the four flat scalars on the lead and the outcome.
 *
 * ⚠️ **Additive, never a replacement.** `downPayment` / `paymentMethod` /
 * `balance` / `balancePaymentMethod` stay written as a derived mirror — section
 * totals plus the FIRST funded row's plan key — because ~20 consumers read those
 * four names and the customer-facing agreement and amendment renderers would
 * degrade *silently* rather than error. An un-upgraded reader then sees a LOSSY
 * view (one method named for a job that used three), not a wrong one.
 *
 * ⚠️ **`method` is the plan KEY**, matching the scalar it mirrors — not the
 * catalogue label `toUpsertRows` sends to the funding API, and never a joined
 * `"Check + AMEX"`, which resolves to nothing in every consumer at once.
 *
 * A row with no method or no money is omitted: it is not an allocation yet, and it
 * is the same shape the funding upsert drops.
 */
export function paymentAllocations(
  rows: PaymentRow[],
  price: number,
  plans: Record<string, DealPlan>
): { downPayments: PaymentAllocation[]; balancePayments: PaymentAllocation[] } {
  const downPayments: PaymentAllocation[] = [];
  const balancePayments: PaymentAllocation[] = [];

  rows.forEach((row) => {
    const amount = toWholeDollars(effectiveRowAmount(row, rows, price));
    // A plan that has left the catalogue keeps its stored label as the key: it is
    // the only handle the record still has on what the money was committed to.
    const method = row.method || row.methodLabel || '';
    if (!method || amount <= 0) return;

    const entry: PaymentAllocation = {
      method,
      amount,
      label: methodLabelOf(plans, row.method) || row.methodLabel || method,
      ...(methodTypeOf(plans, row.method) ? { type: methodTypeOf(plans, row.method)! } : {}),
    };
    // `up` is a client-side grouping — an upfront line is money collected NOW, so
    // it belongs with the down payments exactly as `wireKind` files it.
    if (wireKind(row.kind) === 'bal') balancePayments.push(entry);
    else downPayments.push(entry);
  });

  return { downPayments, balancePayments };
}

/** The attempt history as the screen lists it. Read-only, server-written. */
export function attemptLog(record: FundingRecord | null | undefined): AttemptLogEntry[] {
  return (record?.attemptHistory || []).map((a) => ({
    method: a.method,
    amt: a.requested,
    approved: a.approved,
    at: formatStamp(a.at),
    outcome: a.outcome,
  }));
}

/**
 * Short `h:mm AM` from an ISO timestamp. Hand-rolled rather than
 * `toLocaleTimeString`, so it cannot depend on Intl being compiled into the JS
 * engine. Returns `''` for anything unparseable rather than `Invalid Date`.
 */
export function formatStamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── coverage ───────────────────────────────────────────────────────────────

/**
 * What a payment actually brings in.
 *
 * ⚠️ A decided loan funds what the lender GRANTED (`approvedAmt`), not what was
 * asked (`amount`) — spec §3.2. Getting this backwards would let a short approval
 * look like full coverage and unlock Submit on money that is not coming.
 */
export function fundedAmount(p: FundingPayment): number {
  if (p.type === 'bank' && p.approvedAmt != null) return p.approvedAmt;
  return p.amount;
}

/** Is the whole contract accounted for by amounts that will really arrive? */
export function coverageOK(payments: FundingPayment[], price: number): boolean {
  return payments.reduce((n, p) => n + fundedAmount(p), 0) >= price;
}

/**
 * A partial approval only blocks while the gap is still unassigned. Once the rep
 * has covered the shortfall with another method the short payment is simply a
 * smaller approved payment, and holding it open would strand the job.
 */
export function openShort(p: FundingPayment, covered: boolean): boolean {
  return p.decision === 'short' && !covered;
}

// ── step states ────────────────────────────────────────────────────────────

/** Who posts the steps the rep cannot. Drives the `locked` step's caption. */
export function ownerOf(p: FundingPayment): string {
  if (p.type === 'check') return p.kind === 'bal' ? 'Install crew' : 'Bank';
  if (p.type === 'cc') return 'Processor';
  return 'Lender';
}

/**
 * Render state for every step of a payment.
 *
 * Driven by the server's explicit BOOLEANS (`collected`, `charged`, `activated`,
 * `decision`, `linkSent`) rather than by `step`, because ⚠️ **a bank row's
 * "Approved" is never `step === 2`** — a lender decision leaves `step` at 1, and
 * the state is signalled by `decision !== null` (spec §4). Reading `step` there
 * would leave every approved loan looking un-approved.
 *
 * The recurring rule: a BALANCE payment's final step always belongs to somebody
 * else, because the balance settles after install — the rep is never the one who
 * charges the card or releases the loan at the kitchen table.
 */
export function stateOf(p: FundingPayment, covered: boolean): Record<number, StepState> {
  const st: Record<number, StepState> = {};

  if (p.type === 'check') {
    if (p.kind === 'bal') {
      // Written at install; the crew owns both. No endpoint applies (spec §4).
      st[0] = 'locked';
      st[1] = 'locked';
    } else {
      st[0] = p.collected ? 'done' : 'now';
      // The rep can't deposit at the table — the bank posts it, and it never ticks.
      st[1] = 'locked';
    }
    return st;
  }

  // ⚠️ A closed application leaves `linkSent` false, so "Link Sent" would draw as
  // a plain un-started step — indistinguishable from a link the rep never sent.
  // Amber with a `!` says the opposite: this was sent, and it needs sending again.
  const linkStep: StepState = isApplicationClosed(p) ? 'warn' : p.linkSent ? 'done' : 'now';

  if (p.type === 'cc') {
    const onFile = p.step >= 2 || p.charged;
    st[0] = linkStep;
    st[1] = onFile ? 'done' : p.linkSent ? 'now' : 'next';
    // A balance card is charged by the processor after install; `charge` refuses it.
    st[2] = p.kind === 'bal' ? 'locked' : p.charged ? 'done' : 'next';
    return st;
  }

  st[0] = linkStep;
  if (p.decision === 'declined') st[1] = 'bad';
  else if (p.decision === 'short') st[1] = openShort(p, covered) ? 'warn' : 'done';
  else if (p.decision === 'full') st[1] = 'done';
  else st[1] = p.linkSent ? 'now' : 'next';
  st[2] = p.activated
    ? 'done'
    : p.decision === 'full' || (p.decision === 'short' && !openShort(p, covered))
      ? 'now'
      : 'next';
  // Funded is the lender's, always — financing is balance-only.
  st[3] = 'locked';
  return st;
}

export type ConnectorTone = 'green' | 'grey' | 'dashed';

/**
 * The two connector halves either side of a step's dot — decided by **that step's
 * own state**, never by its neighbour's (mockup `.step.done::before/::after`).
 *
 * That is what draws the hand-off: a *done* step paints its right half GREEN while
 * the *locked* step beside it paints its left half DASHED, so the rule visibly
 * changes character exactly where the work stops being the rep's. Deriving either
 * half from the neighbour flattens the segment to one tone and loses that.
 *
 * `now` greens only the rule leading IN — the rep has arrived here, not left.
 * Lives here rather than in `FundingStepper` because components in this repo are
 * not testable under jest, and this is a rule worth a test.
 */
export function connectorTones(state: StepState): { left: ConnectorTone; right: ConnectorTone } {
  if (state === 'locked') return { left: 'dashed', right: 'dashed' };
  if (state === 'done') return { left: 'green', right: 'green' };
  if (state === 'now') return { left: 'green', right: 'grey' };
  return { left: 'grey', right: 'grey' };
}

/**
 * The "all set for now" note, or `null` while the rep still has work here.
 *
 * A payment being *finished for the rep* is not the same as the money having
 * landed, so each message names who carries it from here.
 */
export function doneFor(p: FundingPayment, covered: boolean): string | null {
  if (p.type === 'check') {
    if (p.kind === 'bal') return 'Collected and deposited by the install crew after the job is done.';
    if (p.collected) return 'Take the check to the branch to deposit it. Deposited checks off once the bank posts it.';
    return null;
  }
  if (p.type === 'cc') {
    const onFile = p.step >= 2 || p.charged;
    if (p.kind === 'bal') return onFile ? 'Card is on file. It gets charged after install is verified.' : null;
    return p.charged ? 'Charged. Funds confirmed.' : null;
  }
  if (p.decision === 'declined' || openShort(p, covered)) return null;
  if (!p.activated) return null;
  return p.kind === 'bal'
    ? 'Loan activated. Funds release after install is verified.'
    : "Loan activated. Draw settles on the lender's next funding cycle.";
}

/** Can this row be asked for an update? Checks have no external system to poll. */
export function canSync(p: FundingPayment): boolean {
  return (p.type === 'cc' || p.type === 'bank') && p.linkSent;
}

// ── submission gate ────────────────────────────────────────────────────────

/**
 * Everything still standing between the rep and Submit, phrased as the next
 * action rather than as an error — the footer lists these.
 *
 * ⚠️ This mirrors the SERVER's rules (spec §5.12) so the rep sees the list before
 * tapping rather than only after a rejection; the server remains authoritative and
 * its own `blockers` replace this list on a 409. Steps owned by a bank, lender,
 * install crew or processor are excluded — they can never block a submit.
 */
export function fundingBlockers(
  payments: FundingPayment[],
  price: number,
  opts?: {
    /**
     * The company's payment gateway cannot accept payments — the `charges_enabled`
     * gate (`FundingErrorKind.setupRequired`). ⚠️ Passed as ONE line rather than
     * repeated per row: the condition is company-wide, so a job with three card
     * rows would otherwise meet the same sentence three times.
     */
    setupBlocked?: boolean;
  }
): string[] {
  const covered = coverageOK(payments, price);
  const out: string[] = [];
  payments.forEach((p) => {
    const who = describePayment(p, payments);
    // First match wins — a payment contributes at most ONE blocker, the next thing
    // the rep has to do. Listing every unmet condition would bury the actual step.
    const reason =
      p.decision === 'declined' ? 'was declined — reassign it'
      : openShort(p, covered) ? 'came back short — cover the difference'
      // ⚠️ Must OUTRANK the "link not sent yet" arm below it. The server resets
      // `linkSent` when the homeowner closes the page, so without this the rep is
      // told a link they watched being opened was never sent.
      : isApplicationClosed(p)
        ? `— the application ${APPLICATION_CLOSED_SHORT[p.applicationClosed as FundingApplicationClosed] || 'closed'}; send a new link`
      : (p.type === 'cc' || p.type === 'bank') && !p.linkSent ? '— link not sent yet'
      : p.type === 'bank' && !p.decision ? '— waiting on lender decision'
      : p.type === 'bank' && !p.activated ? '— loan not activated yet'
      : p.type === 'cc' && p.step < 2 && !p.charged ? '— card not on file yet'
      : p.type === 'cc' && p.kind === 'down' && !p.charged ? '— card on file but not charged'
      : p.type === 'check' && p.kind === 'down' && !p.collected ? '— check not marked collected'
      : null;
    if (reason) out.push(`${who} ${reason}`);
  });

  const total = payments.reduce((n, p) => n + fundedAmount(p), 0);
  if (total < price - EPS) {
    out.push(`$${money(price - total)} of the contract is still unassigned`);
  } else if (total > price + EPS) {
    // ⚠️ The mirror the client was missing. The server blocks an over-allocated
    // submit, so without this line the rep sees a satisfied gate and then a 409 —
    // and this list is exactly what it is replaced by, so the wording matches.
    out.push(`$${money(total - price)} more than the contract price is allocated`);
  }

  if (opts?.setupBlocked) {
    out.push('Payments are not set up for your company yet — contact your office');
  }
  return out;
}

/**
 * ── resuming an abandoned build ─────────────────────────────────────────────
 *
 * Can the rep be taken STRAIGHT to the Job Builder when they tap Sale, skipping the
 * Result Lead sheet entirely?
 *
 * The case this exists for: the rep priced the job, walked the funding to the end and
 * hit **Submit Funding** — which results the lead and opens the builder — and then
 * backed out without finishing the build. The lead has no `selectedCalculatorId` yet
 * (only the builder's own submit writes one), so nothing is locked and Result Lead is
 * live again. Tapping Sale then made them re-walk pricing → Confirm → funding →
 * Submit, three taps that change nothing, before landing where they left off.
 *
 * ⚠️ **Gated on `status === 'submitted'`, deliberately — NOT on "the rows look
 * filled in".** The Submit Funding gate is what enforces the per-row blockers (link
 * not sent, card not charged, check not collected). A record that merely HAS payments
 * has not passed it, and skipping there would let a job be built on money nobody has
 * collected, leaving the record `pending` forever with no path back to the gate.
 */
export function canResumeJobBuild(record: FundingRecord | null | undefined): boolean {
  return record?.status === 'submitted' && (record?.payments?.length || 0) > 0;
}

/**
 * Rebuild the outcome payload the Result Lead sheet WOULD have produced, from the
 * funding record it already produced once.
 *
 * Every money field is recoverable because the record is what the sheet saved:
 * `contractPrice`, and the rows it split it into. The four flat scalars are derived
 * the same way the sheet derives them — summed group totals plus the FIRST funded
 * row's plan key — with the full breakdown alongside.
 *
 * ⚠️ **Amounts come from `fundedAmount`, not `amount`**, so a short-approved loan
 * contributes what the lender GRANTED. That is the money that will really arrive, and
 * it is what `groupTotal` and `coverageOK` already count — a resumed build must not
 * report a larger figure than the funding screen showed.
 *
 * ⚠️ **`oneLeg` / `versatile` / `pineapple` are NOT in the record**, so they come
 * back as the values an untouched sheet would have sent (`'No'` / false / false).
 * That is the honest reconstruction rather than a guess: nothing on this path ever
 * asked the rep for them, and the alternative — omitting them — would clear whatever
 * `buildSubmitLeadData` defaults them to.
 *
 * ⚠️ **Plan KEYS, never the catalogue labels the record stores.** The outcome's
 * `paymentMethod` is resolved against the plan catalogue by ~20 consumers, and
 * `resolveTierPaymentMethod` substring-sniffs it to pick the bank fee — a label like
 * `"AMEX (Bank Fee: 5%)"` reaching that path would be read as AMEX by luck rather
 * than by resolution, and a renamed plan would resolve to nothing at all.
 */
export function resumeOutcomeFromRecord(
  record: FundingRecord | null | undefined,
  plans: Record<string, DealPlan>
): Record<string, any> | null {
  if (!canResumeJobBuild(record)) return null;
  const payments = record!.payments || [];
  const down = payments.filter((p) => p.kind === 'down');
  const bal = payments.filter((p) => p.kind === 'bal');

  const keyOf = (p: FundingPayment) => planKeyForLabel(plans, p.method) || p.method || '';
  // The first row of each half that carries BOTH a method and money — the same rule
  // the sheet's `primaryDownMethod` uses.
  const primary = (rows: FundingPayment[]) => {
    const hit = rows.find((p) => p.method && fundedAmount(p) > 0) || rows.find((p) => p.method);
    return hit ? keyOf(hit) : '';
  };
  const allocate = (rows: FundingPayment[]): PaymentAllocation[] =>
    rows
      .filter((p) => p.method && fundedAmount(p) > 0)
      .map((p) => ({
        method: keyOf(p),
        amount: toWholeDollars(fundedAmount(p)),
        label: p.method,
        ...(p.type ? { type: p.type } : {}),
      }));

  return {
    resultType: 'sale' as const,
    oneLeg: 'No',
    contractPrice: record!.contractPrice || undefined,
    downPayment: groupTotal(down) || undefined,
    balance: groupTotal(bal),
    downPaymentMethod: primary(down) || undefined,
    balancePaymentMethod: primary(bal) || undefined,
    downPayments: allocate(down),
    balancePayments: allocate(bal),
    versatile: false,
    pineapple: false,
    bankDecline: record!.result === 'bankDecline',
    payments,
    fundingAttempts: record!.attemptHistory || [],
  };
}

/** Running total for a group heading (`DOWN PAYMENT · $2,500`). */
export function groupTotal(payments: FundingPayment[]): number {
  return payments.reduce((n, p) => n + fundedAmount(p), 0);
}

/**
 * Has a lender actually declined on this job?
 *
 * ⚠️ Read from the ATTEMPT HISTORY as well as the live rows: the server refuses
 * `result: bankDecline` without a logged `Declined` attempt, and a declined amount
 * that has since been reassigned no longer has a live row to find it on.
 */
export function hasDecline(record: FundingRecord | null | undefined): boolean {
  if (!record) return false;
  return (
    (record.payments || []).some((p) => p.decision === 'declined') ||
    (record.attemptHistory || []).some((a) => a.outcome === 'Declined')
  );
}

// ── decisions → pricing rows ───────────────────────────────────────────────

/**
 * Carry lender decisions back onto the pricing rows.
 *
 * A decided row becomes a locked fact — its amount is what the lender said, not
 * what the rep asked for — and any gap that opens up is named in a banner above
 * the Balance group so the rep is told what to reassign rather than left to spot a
 * total that no longer adds up.
 */
export function applyDecisionsToRows(
  rows: PaymentRow[],
  payments: FundingPayment[],
  price: number,
  mode: PayMode = 'split'
): { rows: PaymentRow[]; banners: DecisionBanner[] } {
  const gapKind = remainderKind(mode);
  const covered = coverageOK(payments, price);
  const banners: DecisionBanner[] = [];

  let next = rows.map((row) => {
    const p = payments.find((x) => x.pid === row.pid);
    // A row that is not on the server yet (one the rep just added) has nothing to
    // mirror and no decision to fold.
    if (!p) return row;

    /**
     * ⚠️ **The settlement flags are mirrored onto EVERY row, decided or not — this is
     * what LOCKS a line whose money has already moved.**
     *
     * A collected cheque or a charged card carries `collected` / `charged` and **never
     * a `decision`** (only a lender issues one), so the old `if (!p || !p.decision)
     * return row;` handed back the row exactly as it sat in state — built at Confirm,
     * *before* the money was taken. `isSettledRow` then read `collected: false`, and
     * the pricing panel offered a live method dropdown and a ✕ on a cheque the rep had
     * already taken from the customer.
     *
     * Neither would have failed loudly: Remove 409s and `report` refetches and flashes
     * *"Funding updated"*, which reads as success; and a SWAP **resets that row's
     * steps, link and decision server-side**, silently throwing away a completed
     * collection.
     *
     * ⚠️ `archived` is deliberately NOT mirrored. `swapRowMethod` keeps a
     * SESSION-LOCAL shelf of plans swapped away before any save, and the server knows
     * nothing about those — copying its own `archived` over would wipe the rep's shelf
     * and with it the only way back to a plan they just replaced.
     */
    const settled = {
      linkSent: p.linkSent,
      activated: p.activated,
      charged: p.charged,
      collected: p.collected,
    };

    if (!p.decision) return { ...row, ...settled };

    if (p.decision === 'declined') {
      banners.push({
        id: p.pid,
        tone: 'bad',
        text: `${shortMethod(p.method)} was declined. The full $${p.amount.toLocaleString()} needs a different payment method.`,
      });
      // `auto` is cleared too: a declined row is a fixed $0, not the remainder
      // absorber — leaving it auto would have it silently re-inflate to the gap.
      return { ...row, ...settled, amount: '0', auto: false, decision: 'declined' as Decision };
    }

    const approved = p.approvedAmt ?? p.amount;
    const requested = p.requested ?? p.amount;
    if (p.decision === 'short' && requested > approved) {
      banners.push({
        id: p.pid,
        tone: 'warn',
        text: `${shortMethod(p.method)} approved $${approved.toLocaleString()} of the $${requested.toLocaleString()} requested. Assign the remaining $${(requested - approved).toLocaleString()} to another payment method below.`,
      });
    }
    return { ...row, ...settled, amount: String(approved), auto: false, decision: p.decision };
  });

  // Somewhere has to be able to absorb the gap. If every row in the group that
  // carries the remainder is now a locked decision there is nothing left to type
  // into, so open a fresh one.
  if (banners.length && !covered) {
    const hasOpenRow = next.some((r) => r.kind === gapKind && !r.decision);
    if (!hasOpenRow) {
      // Upfront has no auto row — its amounts are always typed — so the
      // replacement is a plain empty line the rep fills in.
      next = [
        ...next,
        { pid: newPaymentId(), kind: gapKind, amount: '', method: '', ...(mode === 'split' ? { auto: true } : {}) },
      ];
    }
  }

  return { rows: next, banners };
}

/** The first row the rep should fill to close a gap — highlighted amber. */
export function needsAttentionRowId(
  rows: PaymentRow[],
  banners: DecisionBanner[],
  mode: PayMode = 'split'
): string | null {
  if (!banners.length) return null;
  const gapKind = remainderKind(mode);
  return rows.find((r) => r.kind === gapKind && !r.decision)?.pid ?? null;
}

// ── refunds & internal approvals (REVDSM-1159 / 1160) ──────────────────────

/**
 * ⚠️ **The one rule that decides everything here.** Lance, 24 Aug:
 *
 * > *"Approvals are only for refunds. (My deals flow currently allows change orders
 * > of install date, job scope, pricing, materials, etc. and that all does NOT need
 * > approval.) The only thing that needs approval is refunds bc now the company has
 * > to give money back."*
 *
 * | the rep changes | approval? |
 * |---|---|
 * | install date, scope, materials | no |
 * | price **up** | no |
 * | price **down**, still ≥ collected | no — they re-work the balance themselves |
 * | price **down** below what is COLLECTED | **yes** — the overage has to go back |
 *
 * His worked example: on a $10,000 contract with $1,000 collected, dropping to $9,000
 * needs nothing; dropping to $800 refunds $200 and needs an approver.
 */

/** The eight server states, verbatim. ⚠️ Do not re-label or collapse them. */
export const REFUND_STATE_LABELS: Record<FundingRefundState, string> = {
  pendingApproval: 'Waiting on approval',
  pendingCustomer: 'Waiting on customer',
  customerSigned: 'Customer signed',
  issuing: 'Issuing',
  refunded: 'Refunded',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const REFUND_REASON_LABELS: Record<FundingRefundReason, string> = {
  priceDrop: 'Price reduced',
  jobCancelled: 'Job cancelled',
  bankDecline: 'Lender declined',
  customerDispute: 'Customer dispute',
  completionDispute: 'Completion dispute',
  other: 'Other',
};

/**
 * ⚠️ `refunded`, `declined` and `cancelled` are TERMINAL. Everything else is live.
 * A declined request is not re-openable — the rep raises a new refund.
 */
const TERMINAL_REFUND_STATES: FundingRefundState[] = ['refunded', 'declined', 'cancelled'];

export function isRefundLive(r?: FundingRefund | null): boolean {
  if (!r || !r.state) return false;
  return !TERMINAL_REFUND_STATES.includes(r.state);
}

/**
 * The chip colour for a refund state.
 *
 * ⚠️ **An approved request sitting at `pendingCustomer` is the NORMAL resting state.**
 * It is neither an error nor "done" — the approver has unlocked the signature and the
 * customer has not signed yet. Painting it red would make every healthy refund look
 * broken; painting it green would say the money went back.
 */
export function refundStateTone(state: FundingRefundState): 'ok' | 'warn' | 'bad' | 'muted' {
  if (state === 'refunded') return 'ok';
  if (state === 'declined' || state === 'failed') return 'bad';
  if (state === 'cancelled') return 'muted';
  return 'warn';
}

/**
 * What has actually been COLLECTED on a row — money the company is holding.
 *
 * ⚠️ Not `amount`, which is what was ASKED. A card that has been charged and a cheque
 * that has been taken are collected; a link that merely went out is not, and a loan
 * that was short-approved funded only what the lender GRANTED (`fundedAmount`).
 */
export function collectedOn(p: FundingPayment): number {
  if (!p) return 0;
  if (p.charged || p.collected) return fundedAmount(p);
  if (p.type === 'bank' && p.activated) return fundedAmount(p);
  return 0;
}

/** Everything collected across the DOWN PAYMENT rows — the figure Lance's rule reads. */
export function collectedDownPayment(payments: FundingPayment[]): number {
  return (payments || [])
    .filter((p) => p && p.kind !== 'bal')
    .reduce((n, p) => n + collectedOn(p), 0);
}

/** Everything collected on the job, whichever half it sits in. */
export function collectedTotal(payments: FundingPayment[]): number {
  return (payments || []).reduce((n, p) => n + collectedOn(p), 0);
}

/**
 * What is still refundable on ONE row.
 *
 * ⚠️ Refunds already raised are subtracted, but **only the live and completed ones** —
 * a declined or cancelled request returned nothing and must not eat the allowance, or
 * a rep who was refused once could never raise the refund again.
 */
export function refundableAmount(p: FundingPayment): number {
  const collected = collectedOn(p);
  if (collected <= 0) return 0;
  const spoken = (p.refunds || [])
    .filter((r) => r && r.state !== 'declined' && r.state !== 'cancelled')
    .reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return Math.max(0, collected - spoken);
}

/** Every live refund on the job — what the funding screen has to keep showing. */
export function liveRefunds(payments: FundingPayment[]): { payment: FundingPayment; refund: FundingRefund }[] {
  const out: { payment: FundingPayment; refund: FundingRefund }[] = [];
  for (const p of payments || []) {
    for (const r of p?.refunds || []) if (isRefundLive(r)) out.push({ payment: p, refund: r });
  }
  return out;
}

/**
 * How much has to go back if the contract is re-priced to `newContract`.
 *
 * ⚠️ Measured against what is COLLECTED, not against the old contract price. A deal
 * can be re-priced far down and owe nothing, so long as it still covers the money
 * already taken.
 */
export function refundDueFor(newContract: number, payments: FundingPayment[]): number {
  const collected = collectedTotal(payments);
  if (!(collected > 0)) return 0;
  const price = Number(newContract) || 0;
  /**
   * ⚠️ **Refunds already raised are netted off**, or reopening a deal that was
   * re-priced and refunded computes the SAME gap a second time and asks the rep for a
   * duplicate refund of money already on its way back.
   *
   * Derived from `refundableAmount` rather than summed directly, so the one rule about
   * which refunds count lives in one place: a `declined` or `cancelled` request
   * returned nothing and must NOT eat the allowance (a rep refused once must still be
   * able to raise it again), and each row is clamped at what it actually collected.
   */
  const stillRefundable = (payments || []).reduce((n, p) => n + refundableAmount(p), 0);
  const spokenFor = collected - stillRefundable;
  return Math.max(0, Math.round(collected - price - spokenFor));
}

/** Does this re-price need an approver? Exactly when money has to go back. */
export function requiresRefundApproval(newContract: number, payments: FundingPayment[]): boolean {
  return refundDueFor(newContract, payments) > 0;
}

/**
 * Is the down payment frozen at this contract price?
 *
 * ⚠️ Lance: *"Do not let them adjust the down payment (since that means funding has
 * already been charged/received) as long as the new contract amount is greater than
 * the down payment still."* So a COLLECTED down payment is untouchable while the new
 * price still covers it — the rep re-works the balance instead. Once the price drops
 * below it the row is in play, because that is precisely the refund case.
 */
export function isDownPaymentLocked(newContract: number, payments: FundingPayment[]): boolean {
  const down = collectedDownPayment(payments);
  if (!(down > 0)) return false;
  return (Number(newContract) || 0) >= down;
}

/**
 * The warning shown the moment the rep types a price below what has been collected.
 *
 * ⚠️ **Verbatim from Lance** — do not reword it. Only on **Yes** does the refund appear
 * on the funding screen and on the addendum.
 */
export const REFUND_APPROVAL_WARNING =
  'new contract price is less than collected down payment. This will require approvals. Do you wish to proceed?';

/**
 * Why a refund cannot be requested yet, or `null` when it can.
 *
 * Listed rather than thrown, and phrased as the next action — the same shape as
 * `confirmBlockers` and `fundingBlockers`, so the rep works a list instead of tapping
 * a button that says no.
 */
export function refundBlockers(opts: {
  payment: FundingPayment | null;
  amount: number;
  method: FundingRefundMethod | '';
  reason: FundingRefundReason | '';
  approverId?: string;
  approversConfigured: boolean;
}): string[] {
  const { payment, amount, method, reason, approverId, approversConfigured } = opts;
  const out: string[] = [];

  // ⚠️ First, and on its own terms: a company with nobody configured cannot refund at
  // all. Saying so up front beats letting the rep fill a form that will 409.
  if (!approversConfigured) {
    out.push('No refund approvers are configured — ask your admin to set them in the portal');
    return out;
  }
  if (!payment) return ['Pick the payment to refund'];

  const max = refundableAmount(payment);
  if (max <= 0) out.push('Nothing has been collected on this payment yet');
  // ⚠️ Whole dollars, everywhere in this system.
  else if (!(amount > 0) || !Number.isInteger(amount)) out.push('Enter a whole-dollar refund amount above zero');
  else if (amount > max) out.push(`Refund cannot be more than the $${money(max)} available on this payment`);

  if (!method) out.push('Choose how the money goes back');
  // ⚠️ A cheque can refund a card payment; a card cannot refund a non-card one.
  else if (method === 'card' && payment.type !== 'cc') out.push('Only a payment taken by card can be refunded to a card');

  if (!reason) out.push('Choose a reason for the refund');
  // ⚠️ Optional server-side, required here: an unassigned request appears in NOBODY’s
  // approvals queue and simply sits there.
  if (!approverId) out.push('Choose who approves this refund');
  return out;
}

/**
 * The approver list, filtered for the picker.
 *
 * ⚠️ `allowSelfApproval: false` is a COMPANY SETTING — excluding the signed-in user
 * here is what stops the decide call 403-ing later, after the rep has already sent it.
 */
export function pickableApprovers(
  feed: { approvers?: { id: string; name: string; roleName?: string }[]; allowSelfApproval?: boolean } | null | undefined,
  selfUserId?: string
): { id: string; name: string; roleName?: string }[] {
  const list = feed?.approvers || [];
  if (feed?.allowSelfApproval === false && selfUserId) {
    return list.filter((a) => String(a.id) !== String(selfUserId));
  }
  return list;
}

/**
 * ── the refund's own progress rail (REVDSM-1159) ──────────────────────────────
 *
 * The four milestones a refund passes through, in the order they happen. They are a
 * READING of the server's eight states (`REFUND_STATE_LABELS`), not a replacement
 * for them — `issuing` and `refunded` are two answers to the same question ("is the
 * money back?") and share the last dot, while `declined` / `cancelled` / `failed`
 * are drawn as a stop on the dot they died at.
 *
 * ⚠️ **Four steps, and the third one is the CUSTOMER's.** The most expensive thing
 * this rail can get wrong is implying that approving returns the money. It does not
 * — approval only unlocks the customer's signature and a manager releases the funds
 * afterwards, so "Approved" is the SECOND dot of four and never the last.
 */
export const REFUND_APPROVAL_STEPS = ['Refund Raised', 'Approved', 'Customer Signs', 'Refunded'];

/**
 * The four dot states for a refund, or for one that has not been raised yet.
 *
 * ⚠️ `null` is a real, common input — the rep is standing on the pricing step having
 * just agreed to a refund that does not exist on the server yet. It draws step 1 as
 * "you are here", which is what makes the rail usable as a preview of what submitting
 * will start rather than something that only appears after the fact.
 *
 * ⚠️ A dead request (`declined` / `cancelled`) draws its remaining dots **dashed**,
 * not grey. Grey reads as "not yet"; these will never happen, and a declined request
 * is terminal — the rep raises a NEW refund rather than re-opening this one.
 */
export function refundApprovalStates(refund?: FundingRefund | null): StepState[] {
  switch (refund?.state) {
    case 'pendingApproval':
      // Amber, not green: somebody else has to act and the rep is waiting on them.
      return ['done', 'warn', 'next', 'next'];
    case 'pendingCustomer':
      return ['done', 'done', 'warn', 'next'];
    case 'customerSigned':
    case 'issuing':
      return ['done', 'done', 'done', 'now'];
    case 'refunded':
      return ['done', 'done', 'done', 'done'];
    case 'failed':
      return ['done', 'done', 'done', 'bad'];
    case 'declined':
      return ['done', 'bad', 'locked', 'locked'];
    case 'cancelled':
      return ['done', 'locked', 'locked', 'locked'];
    default:
      // Not raised yet — the rail previews what Submit will start.
      return ['now', 'next', 'next', 'next'];
  }
}

/**
 * One sentence under the rail saying what happens next, and by whose hand.
 *
 * ⚠️ Every arm names WHO is holding the refund. A rail on its own tells the rep how
 * far the money has got but not who to chase, and "waiting" with no owner is the
 * complaint that brings them to support.
 */
export function refundApprovalNote(refund?: FundingRefund | null): string {
  switch (refund?.state) {
    case 'pendingApproval':
      return 'Out for approval. Approving does not return the money — it lets the customer sign.';
    case 'pendingCustomer':
      return 'Approved. Waiting on the customer to sign the addendum.';
    case 'customerSigned':
      return 'The customer has signed. A manager releases the money from Command Center.';
    case 'issuing':
      return 'On its way back to the customer.';
    case 'refunded':
      return 'The money has gone back to the customer.';
    case 'failed':
      return 'The refund failed on the way out and can be retried from Command Center.';
    case 'declined':
      return 'Declined. A declined request cannot be re-opened — raise a new refund.';
    case 'cancelled':
      return 'Cancelled. Nothing went back to the customer.';
    default:
      return 'Nothing is raised yet. Submitting the addendum sends this to the approver you choose.';
  }
}

/**
 * Every refund on the job, **newest first**, each paired with the row it comes out of.
 *
 * ⚠️ Unlike `liveRefunds` this keeps the TERMINAL ones. A refund that has actually
 * been paid back, or one that was declined, is exactly what the rep needs to see when
 * they reopen the deal — dropping it would make a completed refund vanish and read as
 * though it never happened.
 */
export function refundsOnJob(payments: FundingPayment[]): { payment: FundingPayment; refund: FundingRefund }[] {
  const out: { payment: FundingPayment; refund: FundingRefund }[] = [];
  for (const p of payments || []) {
    for (const r of p?.refunds || []) if (r) out.push({ payment: p, refund: r });
  }
  return out.sort((a, b) => new Date(b.refund.at || 0).getTime() - new Date(a.refund.at || 0).getTime());
}

/**
 * The approver feed, read out of whatever the API wrapped it in.
 *
 * ⚠️ **A non-empty list IS configured, whatever the flag says.** This started life as
 * `isConfigured: body.isConfigured === true` alone, and that turned a perfectly good
 * list into "No approvers configured" on a response that simply does not carry the
 * field — the picker sat empty and told the rep to go and ask their admin for
 * something the admin had already done. The flag is still honoured when the list is
 * EMPTY, because that is the case it exists to describe: a company with nobody set up
 * cannot refund at all, and the request would 409.
 *
 * ⚠️ `allowSelfApproval` keeps the strict default. Excluding the rep from their own
 * approval beats letting the `decide` call 403 after the request has already gone out.
 *
 * Pure, and separated from the hook for the reason the rest of this file is: the shape
 * an endpoint answers in is exactly the sort of thing that is wrong silently.
 */
export function normalizeApproverFeed(body: any): {
  approvers: { id: string; name: string; email?: string; roleId?: string; roleName?: string }[];
  roles: { id: string; name: string }[];
  isConfigured: boolean;
  allowSelfApproval: boolean;
} {
  // The envelope varies by deployment, so unwrap the way the repo already does
  // elsewhere rather than assuming one depth.
  const b = body?.data?.data ?? body?.data ?? body ?? {};
  const approvers = (Array.isArray(b.approvers) ? b.approvers : [])
    // A row with no id cannot be sent to anybody — `assignedToUserId` is the whole
    // point of picking one, and an unassigned request sits in nobody's queue.
    .filter((a: any) => a && (a.id || a._id))
    .map((a: any) => ({
      id: String(a.id || a._id),
      name: String(a.name || a.fullName || a.email || 'Unnamed'),
      email: a.email,
      roleId: a.roleId,
      roleName: a.roleName || a.role,
    }));
  return {
    approvers,
    roles: Array.isArray(b.roles) ? b.roles : [],
    isConfigured: b.isConfigured === true || approvers.length > 0,
    allowSelfApproval: b.allowSelfApproval === true,
  };
}

/**
 * ── WHO RELEASES THE ADDENDUM (REVDSM-1159) ───────────────────────────────────
 *
 * `send-now`           the addendum carries no refund — text/email the customer now.
 * `hold-for-approval`  raise the refund and send NOTHING; the APPROVER releases it.
 * `abort`              a refund is owed but cannot be raised — send nothing at all.
 */
export type AddendumRelease = 'send-now' | 'hold-for-approval' | 'abort';

/**
 * Whether this submit may reach the customer, and the single most important rule on
 * the deal-edit screen.
 *
 * ⚠️ **A refund addendum must not be released before the refund is approved.** The
 * refund machine is `pendingApproval → pendingCustomer → customerSigned → …`, and
 * `pendingApproval → customerSigned` is **not a legal move** — the server's guard is a
 * bare `return`, so a customer who signs while the refund still awaits approval has
 * their signature SILENTLY DROPPED for the refund. The approver then approves, the
 * refund advances to `pendingCustomer`, and it waits forever for a signature that
 * already happened and cannot be asked for again. The addendum reads `accepted`, the
 * money never moves, and nothing anywhere says why.
 *
 * ⚠️ **`abort` rather than "send it anyway".** Releasing an addendum whose refund
 * could not be raised puts the price CUT in front of the customer to sign while the
 * company quietly keeps the money that cut gives back — the one outcome on this screen
 * that must never be possible. Nothing has left the building at this point, so
 * stopping is free.
 *
 * ⚠️ It aborts on an unsatisfied GATE too, not only a missing `draftId`. The Submit
 * button is already disabled while `refundGate` is non-empty, so that arm should be
 * unreachable — but "unreachable" is not a guarantee to hang this particular
 * consequence on.
 */
export function addendumReleasePlan(o: {
  /** The rep saw the warning and answered YES — a refund is really owed. */
  refundAcknowledged: boolean;
  /** A collected row was resolved to refund FROM. */
  hasSourceRow: boolean;
  /** `refundBlockers` came back empty. */
  gateClear: boolean;
  /**
   * ⚠️ The ONLY join between the refund and the paperwork the customer signs. It can
   * only be set when the refund is created — there is no endpoint to attach a draft
   * afterwards — so a refund raised without one reaches `pendingCustomer` and waits
   * there forever.
   */
  draftId?: string | null;
}): AddendumRelease {
  if (!o.refundAcknowledged) return 'send-now';
  const draftId = o.draftId ? String(o.draftId).trim() : '';
  if (o.hasSourceRow && o.gateClear && draftId) return 'hold-for-approval';
  return 'abort';
}

// ── chasing a silent approver (REVDSM-1160) ────────────────────────────────────

/**
 * The approval rows for one lead — `GET /lead/v1/:leadId/approvals`.
 *
 * ⚠️ **TWO segments, always.** `LeadController` owns `GET /lead/v1/:id`, so a bare
 * `/lead/v1/approvals` is ambiguous with a lead whose id is that word and which wins
 * depends on controller registration order. Never add a single-segment route.
 */
export function normalizeApprovalRows(body: any): ApprovalRecord[] {
  // Same three-depth unwrap as `normalizeApproverFeed` — the envelope varies by
  // deployment and guessing one depth is how a populated list reads as empty.
  const b = body?.data?.data ?? body?.data ?? body ?? {};
  const rows = Array.isArray(b) ? b : Array.isArray(b.approvals) ? b.approvals : Array.isArray(b.rows) ? b.rows : [];
  return (rows as any[]).filter((r) => r && typeof r === 'object') as ApprovalRecord[];
}

/** An approval row's own id, under either spelling. */
export function approvalIdOf(approval?: ApprovalRecord | null): string {
  const id = approval?.id ?? approval?._id;
  return id ? String(id).trim() : '';
}

/**
 * The approval request that belongs to THIS refund.
 *
 * ⚠️ Matched on the refund's own `approvalId` first, then on `refund.rid` — a lead can
 * carry several approvals (a refund raised, declined, and raised again), so "the
 * lead's approval" is never a valid lookup. Ids compare as STRINGS for the reason the
 * resulted-calculator lock does: one side arrives off the funding record and the other
 * off the approvals list, and those are not guaranteed to be the same type.
 */
export function pickRefundApproval(
  rows: ApprovalRecord[] | null | undefined,
  refund?: FundingRefund | null
): ApprovalRecord | null {
  if (!refund) return null;
  const list = Array.isArray(rows) ? rows : [];
  const wantApproval = refund.approvalId ? String(refund.approvalId).trim() : '';
  if (wantApproval) {
    const byId = list.find((r) => approvalIdOf(r) === wantApproval);
    if (byId) return byId;
  }
  const wantRid = refund.rid ? String(refund.rid).trim() : '';
  if (wantRid) {
    const byRid = list.find((r) => r?.refund?.rid && String(r.refund.rid).trim() === wantRid);
    if (byRid) return byRid;
  }
  return null;
}

/**
 * The reminder window as the SERVER computed it.
 *
 * ⚠️ **Never derive any of this on the device.** The window is two backend constants
 * (48 h before a first reminder, then one a day) and it is served rather than
 * hardcoded precisely so a change needs no app release — a client that recomputed
 * would disagree with the endpoint that actually refuses.
 *
 * A row that carries no `reminder` block yields `null`, and the caller renders
 * nothing rather than guessing: a deployment that predates this feature must not show
 * a button whose endpoint 404s.
 */
export function reminderOf(approval?: ApprovalRecord | null): FundingApprovalReminder | null {
  const r = approval?.reminder;
  if (!r || typeof r !== 'object') return null;
  return { ...r, canRemind: r.canRemind === true };
}

/** Who is being waited on, for the "Waiting 3 days on Sam Patel" line. */
export function approverNameOf(approval?: ApprovalRecord | null): string {
  const a = approval?.assignedTo;
  if (a && typeof a === 'object' && a.name) return String(a.name).trim();
  return '';
}

/**
 * "Waiting 3 days on Sam Patel" — why a rep would chase, above the button that does.
 *
 * ⚠️ Under a day reads "Waiting today" rather than "Waiting 0 days", which would look
 * like a bug on a request raised this morning.
 */
export function waitingLabel(reminder?: FundingApprovalReminder | null, approverName?: string): string {
  if (!reminder) return '';
  const days = Number(reminder.waitingDays) || 0;
  const who = (approverName || '').trim();
  const span = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : 'today';
  return who ? `Waiting ${span} on ${who}` : `Waiting ${span}`;
}
