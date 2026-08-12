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
  type FundingDecision,
  type FundingKind,
  type FundingMethodType,
  type FundingPaymentRow,
  type FundingRecord,
  type FundingUpsertRow,
} from '../../../services/api/FundingService';

/**
 * Splitting a half of the contract across SEVERAL payment lines is built and
 * tested, but switched **off** for now — the deal is currently one down-payment
 * method and one balance method, as it was before this module.
 *
 * Flipping this to `true` is the only change needed to turn it on: it enables the
 * "Add payment method" buttons **and** the per-row ✕. The two travel together
 * deliberately — with Add disabled, removing a row would be unrecoverable inside
 * the session, so the rep would be one tap away from a dead end.
 *
 * ⚠️ One exception, and it is intentional: the recovery row `applyDecisionsToRows`
 * opens after a DECLINE is not gated. That is not the rep adding a line — it is
 * the system replacing a dead one, and it is the only way a declined deal can be
 * re-assigned at all. The rep still cannot remove it.
 */
export const MULTI_METHOD_ENABLED = false;

/** What the mock provider's "Approve partial" grants: 60%, to the nearest $100. */
export const MOCK_PARTIAL_RATE = 0.6;

export type PaymentKind = FundingKind;
export type MethodType = FundingMethodType;
export type Decision = FundingDecision;
/** A payment as the SERVER holds it — the funding screen renders this, nothing else. */
export type FundingPayment = FundingPaymentRow;

export { newPaymentId, toWholeDollars };

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

// ── record → screen ────────────────────────────────────────────────────────

/**
 * Seed the pricing rows from a saved record.
 *
 * ⚠️ This is what keeps `pid` stable across visits, which is the whole merge
 * contract: reopening the sheet must reuse the saved ids, or the next `PUT`
 * creates a second set of rows for the same deal.
 *
 * The last undecided balance row is re-flagged `auto` so the remainder keeps
 * behaving as it did before the save — the server does not persist that flag
 * (it is a screen affordance, not funding state).
 */
export function hydrateRowsFromRecord(
  record: FundingRecord | null | undefined,
  plans: Record<string, DealPlan>
): PaymentRow[] {
  const saved = record?.payments || [];
  if (!saved.length) return [];
  const rows: PaymentRow[] = saved.map((p) => ({
    pid: p.pid,
    kind: p.kind,
    // A decided row shows what the lender GRANTED (spec §3.2) — that is the money
    // this line actually brings in, and it is what the totals must add up from.
    amount: String(p.decision ? (p.approvedAmt ?? p.amount) : p.amount),
    method: planKeyForLabel(plans, p.method),
    methodLabel: p.method,
    decision: p.decision,
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
        pid: row.pid,
        kind: row.kind,
        method,
        ...(methodTypeOf(plans, row.method) ? { type: methodTypeOf(plans, row.method)! } : {}),
        amount,
      } as FundingUpsertRow;
    })
    .filter((r): r is FundingUpsertRow => r !== null);
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

  if (p.type === 'cc') {
    const onFile = p.step >= 2 || p.charged;
    st[0] = p.linkSent ? 'done' : 'now';
    st[1] = onFile ? 'done' : p.linkSent ? 'now' : 'next';
    // A balance card is charged by the processor after install; `charge` refuses it.
    st[2] = p.kind === 'bal' ? 'locked' : p.charged ? 'done' : 'next';
    return st;
  }

  st[0] = p.linkSent ? 'done' : 'now';
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
export function fundingBlockers(payments: FundingPayment[], price: number): string[] {
  const covered = coverageOK(payments, price);
  const out: string[] = [];
  payments.forEach((p) => {
    const who = `$${p.amount.toLocaleString()} ${shortMethod(p.method)}`;
    // First match wins — a payment contributes at most ONE blocker, the next thing
    // the rep has to do. Listing every unmet condition would bury the actual step.
    const reason =
      p.decision === 'declined' ? 'was declined — reassign it'
      : openShort(p, covered) ? 'came back short — cover the difference'
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
  if (total < price) out.push(`$${(price - total).toLocaleString()} of the contract is still unassigned`);
  return out;
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
  price: number
): { rows: PaymentRow[]; banners: DecisionBanner[] } {
  const covered = coverageOK(payments, price);
  const banners: DecisionBanner[] = [];

  let next = rows.map((row) => {
    const p = payments.find((x) => x.pid === row.pid);
    if (!p || !p.decision) return row;

    if (p.decision === 'declined') {
      banners.push({
        id: p.pid,
        tone: 'bad',
        text: `${shortMethod(p.method)} was declined. The full $${p.amount.toLocaleString()} needs a different payment method.`,
      });
      // `auto` is cleared too: a declined row is a fixed $0, not the remainder
      // absorber — leaving it auto would have it silently re-inflate to the gap.
      return { ...row, amount: '0', auto: false, decision: 'declined' as Decision };
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
    return { ...row, amount: String(approved), auto: false, decision: p.decision };
  });

  // Somewhere has to be able to absorb the gap. If every balance row is now a
  // locked decision there is nothing left to type into, so open a fresh one.
  if (banners.length && !covered) {
    const hasOpenBalance = next.some((r) => r.kind === 'bal' && !r.decision);
    if (!hasOpenBalance) {
      next = [...next, { pid: newPaymentId(), kind: 'bal', amount: '', method: '', auto: true }];
    }
  }

  return { rows: next, banners };
}

/** The first row the rep should fill to close a gap — highlighted amber. */
export function needsAttentionRowId(rows: PaymentRow[], banners: DecisionBanner[]): string | null {
  if (!banners.length) return null;
  return rows.find((r) => r.kind === 'bal' && !r.decision)?.pid ?? null;
}
