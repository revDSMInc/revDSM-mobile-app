/**
 * funding.ts — the pure state machine behind the **Funding** step of the Result
 * Lead sheet (`ResultJobModal` → `FundingView`).
 *
 * A sale is no longer "one down payment method + one balance method". The rep can
 * split the contract across SEVERAL instruments (two cards, a check plus a lender
 * plan, …) and each one has its own life cycle the rep has to drive to the end:
 *
 *   check → Collected → Deposited
 *   card  → Link Sent → Card on File → Charged
 *   bank  → Link Sent → Approved → Activated → Funded
 *
 * This module owns the rules — which steps exist, whose step each one is, what is
 * still blocking submission, and how a lender decision folds back onto the pricing
 * rows. It has **no React and no react-native imports** so it stays testable; every
 * component under `components/funding/` is a renderer over these functions.
 *
 * ⚠️ There is NO funding/lender backend yet. Outcomes are staged through the
 * **Scenario Simulator** (`FundingPayment.queued`) and delivered by `syncPayments`,
 * which is the seam a real `GET …/funding/status` drops into — see its docblock.
 */

import type { DealPlan } from '../hooks/useDealPricing';

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
 * Everything downstream already handles many lines (`buildPayments`, the funding
 * cards, the blockers, `applyDecisionsToRows`), so nothing else is gated on it.
 *
 * ⚠️ One exception, and it is intentional: the recovery row `applyDecisionsToRows`
 * opens after a DECLINE is not gated. That is not the rep adding a line — it is
 * the system replacing a dead one, and it is the only way a declined deal can be
 * re-assigned at all. The rep still cannot remove it.
 */
export const MULTI_METHOD_ENABLED = false;

/** Which half of the contract a payment belongs to. */
export type PaymentKind = 'down' | 'bal';

/** The three life cycles a payment can have. Derived from the plan `type`. */
export type MethodType = 'check' | 'cc' | 'bank';

/** What a lender came back with. Only `bank` payments ever carry one. */
export type Decision = 'full' | 'short' | 'declined';

/** Step labels per method type (mockup `FLOW`). Index order IS the step order. */
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
  id: string;
  kind: PaymentKind;
  /** Kept as TEXT so the input can hold `''` mid-typing instead of snapping to 0. */
  amount: string;
  /** Plan key into `DealPricing.plans` (`''` until the rep picks one). */
  method: string;
  /**
   * The derived remainder row. Its amount is computed from the contract price, so
   * it is not typeable and it is the row that absorbs whatever is left over.
   */
  auto?: boolean;
  /** Set once a lender has answered — the row then reads as a locked fact. */
  decision?: Decision | null;
}

/** A row once it has entered the funding step, carrying its life-cycle state. */
export interface FundingPayment {
  /** Same id as the `PaymentRow` it came from, so decisions map back onto it. */
  id: string;
  kind: PaymentKind;
  amount: number;
  /** Plan key. */
  method: string;
  /** Resolved catalog label — carried so the funding screen never needs the map. */
  methodLabel: string;
  type: MethodType;
  /** Index into `FLOW[type]` the rep has driven this payment to. */
  step: number;
  linkSent: boolean;
  sentTo?: string;
  decision: Decision | null;
  /** What was asked of the lender (kept when a partial approval lowers `amount`). */
  requested: number | null;
  approvedAmt: number | null;
  activated: boolean;
  /** Display stamp from the last status check. */
  syncedAt: string | null;
  /**
   * **Scenario Simulator only** — the outcome the next Sync will deliver.
   *
   * Standing in for the lender API means the outcome has to be staged somewhere
   * before it is "received", so the two halves of the round trip stay distinct:
   * the simulator queues, `syncPayments` delivers. Delete this field along with
   * the simulator when the real endpoint lands.
   */
  queued: Decision | null;
}

/** A lender attempt worth keeping on the job even after the money is reassigned. */
export interface AttemptLogEntry {
  method: string;
  amt: number;
  approved: number;
  at: string;
  outcome: 'Partial' | 'Declined';
}

/** A message shown above the Balance group after a decision comes back. */
export interface DecisionBanner {
  id: string;
  tone: 'warn' | 'bad';
  text: string;
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
 *
 * Deliberately subtracts EVERY non-auto row — down and balance alike — rather than
 * the mockup's `recalcAfterLock`, which skips unlocked balance rows and therefore
 * double-counts them into the remainder.
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

// ── method classification ──────────────────────────────────────────────────

/**
 * Map a plan key onto its funding life cycle.
 *
 * Driven by the catalog's `type` rather than the mockup's label matching
 * (`m.startsWith('Check')`), which would misfile any company whose plans are named
 * differently — and every company authors its own plan labels.
 */
export function methodTypeOf(plans: Record<string, DealPlan>, key?: string): MethodType | null {
  const plan = plans[key || ''];
  if (!plan) return null;
  if (plan.type === 'financing') return 'bank';
  if (plan.type === 'card') return 'cc';
  return 'check';
}

/** Catalog label for a plan key, falling back to the raw key. */
export function methodLabelOf(plans: Record<string, DealPlan>, key?: string): string {
  return plans[key || '']?.label || key || '';
}

/**
 * The label without its parenthetical, for prose: `1509 (10.99% APR…)` → `1509`.
 * Banners and blockers read as sentences, and the full label is a paragraph.
 */
export function shortMethod(label: string): string {
  return String(label).split(' (')[0].trim() || label;
}

// ── row → payment ──────────────────────────────────────────────────────────

/**
 * Project the pricing rows into funding payments, carrying forward everything the
 * rep already did.
 *
 * Progress survives an edit as long as the row's METHOD is unchanged (mockup
 * `goFunding`): re-pricing a card that is already on file must not un-send its
 * link, but swapping that card for a lender plan is a different instrument
 * entirely and starts over.
 */
export function buildPayments(
  rows: PaymentRow[],
  price: number,
  plans: Record<string, DealPlan>,
  previous: FundingPayment[] = []
): FundingPayment[] {
  return rows
    .map((row) => {
      const amount = effectiveRowAmount(row, rows, price);
      const type = methodTypeOf(plans, row.method);
      if (!type || amount <= 0) return null;
      const prev = previous.find((p) => p.id === row.id);
      if (prev && prev.method === row.method) {
        return { ...prev, kind: row.kind, amount };
      }
      return {
        id: row.id,
        kind: row.kind,
        amount,
        method: row.method,
        methodLabel: methodLabelOf(plans, row.method),
        type,
        step: 0,
        linkSent: false,
        decision: null,
        requested: null,
        approvedAmt: null,
        activated: false,
        syncedAt: null,
        queued: null,
      } as FundingPayment;
    })
    .filter((p): p is FundingPayment => p !== null);
}

// ── coverage ───────────────────────────────────────────────────────────────

/** What a payment actually brings in — a lender's approval, not what was asked. */
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
 * Render state for every step of a payment (mockup `stateOf`).
 *
 * The recurring rule: a BALANCE payment's final step always belongs to somebody
 * else, because the balance settles after install — the rep is never the one who
 * charges the card or releases the loan at the kitchen table.
 */
export function stateOf(p: FundingPayment, covered: boolean): Record<number, StepState> {
  const st: Record<number, StepState> = {};

  if (p.type === 'check') {
    if (p.kind === 'bal') {
      st[0] = 'locked';
      st[1] = 'locked';
    } else {
      st[0] = p.step >= 1 ? 'done' : 'now';
      // The rep can't deposit at the table — the bank posts it.
      st[1] = 'locked';
    }
    return st;
  }

  if (p.type === 'cc') {
    st[0] = p.linkSent ? 'done' : 'now';
    st[1] = p.step >= 2 ? 'done' : p.linkSent ? 'now' : 'next';
    st[2] = p.kind === 'bal' ? 'locked' : p.step >= 3 ? 'done' : 'next';
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
  st[3] = p.kind === 'bal' ? 'locked' : p.step >= 4 ? 'done' : 'next';
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
    if (p.step >= 1) return 'Take the check to the branch to deposit it. Deposited checks off once the bank posts it.';
    return null;
  }
  if (p.type === 'cc') {
    if (p.kind === 'bal') return p.step >= 2 ? 'Card is on file. It gets charged after install is verified.' : null;
    return p.step >= 3 ? 'Charged. Funds confirmed.' : null;
  }
  if (p.decision === 'declined' || openShort(p, covered)) return null;
  if (!p.activated) return null;
  return p.kind === 'bal'
    ? 'Loan activated. Funds release after install is verified.'
    : "Loan activated. Draw settles on the lender's next funding cycle.";
}

// ── submission gate ────────────────────────────────────────────────────────

/**
 * Everything still standing between the rep and Submit, phrased as the next
 * action rather than as an error — the footer lists these verbatim.
 */
export function fundingBlockers(payments: FundingPayment[], price: number): string[] {
  const covered = coverageOK(payments, price);
  const out: string[] = [];
  payments.forEach((p) => {
    const who = `$${p.amount.toLocaleString()} ${shortMethod(p.methodLabel)}`;
    // First match wins — a payment contributes at most ONE blocker, the next thing
    // the rep has to do. Listing every unmet condition would bury the actual step.
    const reason =
      p.decision === 'declined' ? 'was declined — reassign it'
      : openShort(p, covered) ? 'came back short — cover the difference'
      : (p.type === 'cc' || p.type === 'bank') && !p.linkSent ? '— link not sent yet'
      : p.type === 'bank' && !p.decision ? '— waiting on lender decision'
      : p.type === 'bank' && !p.activated ? '— loan not activated yet'
      : p.type === 'cc' && p.step < 2 ? '— card not on file yet'
      : p.type === 'cc' && p.kind === 'down' && p.step < 3 ? '— card on file but not charged'
      : p.type === 'check' && p.kind === 'down' && p.step < 1 ? '— check not marked collected'
      : null;
    if (reason) out.push(`${who} ${reason}`);
  });
  const total = payments.reduce((n, p) => n + fundedAmount(p), 0);
  if (total < price) out.push(`$${(price - total).toLocaleString()} of the contract is still unassigned`);
  return out;
}

// ── recording a lender decision ────────────────────────────────────────────

/** Short `h:mm AM` stamp. Hand-rolled so it never depends on Intl being compiled in. */
export function stampTime(d: Date = new Date()): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Fold a lender's answer into a payment, and emit the attempt-log row it earns.
 *
 * A partial or a decline is kept on the job whether or not the money is later
 * reassigned — the record of what the lender said is the point, and reassigning
 * the amount would otherwise erase it (mockup `pull`).
 */
export function applyDecision(
  p: FundingPayment,
  decision: Decision,
  approvedAmt: number,
  at: string = stampTime()
): { payment: FundingPayment; log: AttemptLogEntry | null } {
  const requested = p.requested ?? p.amount;
  if (decision === 'full') {
    return {
      payment: { ...p, decision: 'full', requested, approvedAmt: requested, syncedAt: at },
      log: null,
    };
  }
  if (decision === 'short') {
    const approved = Math.max(0, Math.min(approvedAmt, requested));
    return {
      payment: { ...p, decision: 'short', requested, approvedAmt: approved, syncedAt: at },
      log: { method: p.methodLabel, amt: requested, approved, at, outcome: 'Partial' },
    };
  }
  return {
    payment: { ...p, decision: 'declined', requested, approvedAmt: 0, activated: false, syncedAt: at },
    log: { method: p.methodLabel, amt: requested, approved: 0, at, outcome: 'Declined' },
  };
}

/** What a simulated "Approve partial" comes back with — 60%, to the nearest $100. */
export const SIMULATED_PARTIAL_RATE = 0.6;

/** Stage an outcome on a payment (Scenario Simulator). Tapping the same chip clears it. */
export function toggleQueued(p: FundingPayment, decision: Decision): FundingPayment {
  return { ...p, queued: p.queued === decision ? null : decision };
}

/**
 * Status-check seam — "receive" whatever the lender/processor has for us.
 *
 * Two things arrive here, both mirroring the mockup's `pull()`:
 *  - a **card** whose link has been sent moves to *Card on File*, which is the
 *    processor telling us the homeowner saved their card;
 *  - a **loan** delivers the outcome the Scenario Simulator staged on `queued`.
 *
 * ⚠️ A decision is only ever delivered for a payment whose link has actually been
 * SENT. Nothing here can conjure one out of nothing — an outcome no lender was
 * even asked for would unlock Submit on money that is not coming.
 *
 * When the real endpoint lands, replace the body with the response mapping
 * (`applyDecision` already does the folding) and keep the signature: the screen
 * only awaits `{ payments, log }`.
 */
export function syncPayments(
  payments: FundingPayment[],
  at: string = stampTime()
): { payments: FundingPayment[]; log: AttemptLogEntry[] } {
  const log: AttemptLogEntry[] = [];
  const next = payments.map((p) => {
    let updated = p;

    if (p.type === 'cc' && p.linkSent && p.step < 2) {
      updated = { ...updated, step: 2 };
    }

    if (p.type === 'bank' && p.linkSent && p.queued) {
      const approved =
        p.queued === 'short' ? Math.round((p.amount * SIMULATED_PARTIAL_RATE) / 100) * 100 : p.amount;
      const res = applyDecision(updated, p.queued, approved, at);
      updated = { ...res.payment, queued: null };
      if (res.log) log.push(res.log);
    }

    return { ...updated, syncedAt: at };
  });
  return { payments: next, log };
}

// ── decisions → pricing rows ───────────────────────────────────────────────

/**
 * Carry lender decisions back onto the pricing rows (mockup `applyApprovals`).
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
    const p = payments.find((x) => x.id === row.id);
    if (!p || !p.decision) return row;

    if (p.decision === 'declined') {
      banners.push({
        id: p.id,
        tone: 'bad',
        text: `${shortMethod(p.methodLabel)} was declined. The full $${p.amount.toLocaleString()} needs a different payment method.`,
      });
      // `auto` is cleared too: a declined row is a fixed $0, not the remainder
      // absorber — leaving it auto would have it silently re-inflate to the gap.
      return { ...row, amount: '0', auto: false, decision: 'declined' as Decision };
    }

    const approved = p.approvedAmt ?? p.amount;
    const requested = p.requested ?? p.amount;
    if (p.decision === 'short' && requested > approved) {
      banners.push({
        id: p.id,
        tone: 'warn',
        text: `${shortMethod(p.methodLabel)} approved $${approved.toLocaleString()} of the $${requested.toLocaleString()} requested. Assign the remaining $${(requested - approved).toLocaleString()} to another payment method below.`,
      });
    }
    return { ...row, amount: String(approved), auto: false, decision: p.decision };
  });

  // Somewhere has to be able to absorb the gap. If every balance row is now a
  // locked decision there is nothing left to type into, so open a fresh one.
  if (banners.length && !covered) {
    const hasOpenBalance = next.some((r) => r.kind === 'bal' && !r.decision);
    if (!hasOpenBalance) {
      next = [...next, { id: newRowId(), kind: 'bal', amount: '', method: '', auto: true }];
    }
  }

  return { rows: next, banners };
}

/** The first row the rep should fill to close a gap — highlighted amber. */
export function needsAttentionRowId(rows: PaymentRow[], banners: DecisionBanner[]): string | null {
  if (!banners.length) return null;
  return rows.find((r) => r.kind === 'bal' && !r.decision)?.id ?? null;
}

/** Has any lender actually declined? The only thing that unlocks the Result field. */
export function hasDecline(payments: FundingPayment[], log: AttemptLogEntry[]): boolean {
  return payments.some((p) => p.decision === 'declined') || log.some((l) => l.outcome === 'Declined');
}

// ── ids ────────────────────────────────────────────────────────────────────

let rowSeq = 0;
/** Stable per-session row id. Rows are matched to payments by it, so it must not
 *  be derived from the index — reordering or removing a row would re-key the lot. */
export function newRowId(): string {
  rowSeq += 1;
  return `pr_${rowSeq}`;
}

// ── the homeowner's link ───────────────────────────────────────────────────

/**
 * The URL the homeowner opens to save a card or fill in a loan application.
 *
 * ⚠️ **PLACEHOLDER.** A real application link is minted by the lender/processor
 * per attempt and has to arrive with the funding API — this builds a deterministic
 * stand-in from the ids we already hold so the rep flow is walkable end to end.
 * Replace the body (not the signature) when the endpoint lands; every caller only
 * needs a string.
 */
export function buildApplicationLink(apiUrl: string, leadId: string, payment: FundingPayment): string {
  // `api.<env>.revdsm.com` is the API host; `app.<env>.revdsm.com` is the web app
  // the homeowner would actually land on (see `config/env.ts`).
  const base = apiUrl
    .replace('//dev-api.', '//app.np.')
    .replace('//api.', '//app.')
    .replace(/\/+$/, '');
  const path = payment.type === 'bank' ? 'apply' : 'pay';
  return `${base}/${path}/${leadId || 'lead'}/${payment.id}`;
}

// ── outbound payload ───────────────────────────────────────────────────────

/** Serializable funding record handed to `onConfirm` (and on to the outcome save). */
export interface FundingPaymentPayload {
  kind: PaymentKind;
  amount: number;
  method: string;
  methodLabel: string;
  type: MethodType;
  step: number;
  stepLabel: string;
  linkSent: boolean;
  sentTo?: string;
  decision: Decision | null;
  requested: number | null;
  approvedAmt: number | null;
  activated: boolean;
}

export function toPaymentPayload(payments: FundingPayment[]): FundingPaymentPayload[] {
  return payments.map((p) => ({
    kind: p.kind,
    amount: p.amount,
    method: p.method,
    methodLabel: p.methodLabel,
    type: p.type,
    step: p.step,
    stepLabel: FLOW[p.type][Math.min(p.step, FLOW[p.type].length - 1)] || '',
    linkSent: p.linkSent,
    ...(p.sentTo ? { sentTo: p.sentTo } : {}),
    decision: p.decision,
    requested: p.requested,
    approvedAmt: p.approvedAmt,
    activated: p.activated,
  }));
}