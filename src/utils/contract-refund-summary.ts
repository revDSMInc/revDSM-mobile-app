import type { FundingRefund } from '../services/api/FundingService';
import type { FundingPayment } from '../screens/DynamicDealCenter/utils/funding';

/**
 * The three figures the Lead Center's contract card shows once a refund has been
 * accepted: what the job was worth, what went back, and what it is worth now.
 *
 * Pure and RN-free, for the reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` are: every rule here is wrong *silently* — a card that
 * renders nothing, or one that labels the same number as both "before" and "after" —
 * and the components that read it cannot be loaded under jest.
 *
 * ⚠️ **`before − after` is NOT the refund**, and the card must never compute one from
 * the other. The contract price can move for reasons that have nothing to do with money
 * going back (a second addendum, a scope change), so the three figures are reported
 * independently and the refund is always read from the refund records themselves.
 */

/** Money, from a number or a formatted string (`"$24,900.00"`). `null` when unusable. */
function toMoney(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Has the CUSTOMER accepted this refund?
 *
 * ⚠️ **Signed, not merely approved.** `pendingCustomer` means an approver said yes and
 * the customer has not — the deal is not yet changed, and printing a reduced contract
 * value on the strength of it would misstate the job to whoever reads the card next.
 * `failed` is out for the opposite reason: it was agreed and the money did not move, so
 * the card must not claim it did.
 */
export function isAcceptedRefund(refund?: FundingRefund | null): boolean {
  const accepted = new Set(['customerSigned', 'issuing', 'refunded']);
  return accepted.has(String(refund?.state || ''));
}

/** Raised, answered, and returning nothing — these never appear on the card. */
function isDeadRefund(refund?: FundingRefund | null): boolean {
  const dead = new Set(['declined', 'cancelled', 'canceled']);
  return dead.has(String(refund?.state || ''));
}

function allRefunds(payments?: FundingPayment[] | null): FundingRefund[] {
  const out: FundingRefund[] = [];
  for (const p of payments || []) for (const r of p?.refunds || []) if (r) out.push(r);
  return out;
}

/** Everything the customer has actually been granted back, across every row. */
export function acceptedRefundTotal(payments?: FundingPayment[] | null): number {
  return Math.round(
    allRefunds(payments)
      .filter(isAcceptedRefund)
      .reduce((n, r) => n + (Number(r.amount) || 0), 0)
  );
}

/**
 * The OLDEST accepted refund — the one that first changed what this job is worth.
 *
 * ⚠️ An undated refund can never be "first". Sorting it to the front on a missing `at`
 * would let a record with no timestamp displace the one that actually happened earliest.
 */
export function firstAcceptedRefund(payments?: FundingPayment[] | null): FundingRefund | null {
  const dated = allRefunds(payments)
    .filter(isAcceptedRefund)
    .map((r) => ({ r, t: Date.parse(String(r.at || '')) }));
  const withDate = dated.filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (withDate.length) return withDate[0].r;
  return dated.length ? dated[0].r : null;
}

/**
 * The payment rows out of a funding response.
 *
 * ⚠️ **They live at `data.funding.payments`.** The shallow `data.payments` path reads as
 * plausible and resolves to NOTHING on the real envelope, which makes the whole card
 * silently invisible — there is no error, just an empty lead. Every depth the
 * deployments use is unwrapped here so no call site has to guess.
 */
export function paymentsFromFunding(body: any): FundingPayment[] {
  const record = body?.data?.funding ?? body?.funding ?? body?.data ?? body;
  const rows = record?.payments;
  return Array.isArray(rows) ? rows : [];
}

/** The contract price the FUNDING record holds, when it has one. */
export function fundingContractPrice(body: any): number | null {
  const record = body?.data?.funding ?? body?.funding ?? body?.data ?? body;
  return toMoney(record?.contractPrice);
}

/**
 * The two sides of the addendum that carried the refund — `GET …/job-builder-draft/:id/public`.
 *
 * ⚠️ **Both sides or nothing.** A half-populated draft would otherwise print one price
 * with no counterpart, which reads as a change that did not happen.
 */
export function contractPricesFromDraft(draft: any): { before: number; after: number } | null {
  const before = toMoney(draft?.current?.pricing?.originalContractPrice);
  const after = toMoney(draft?.proposed?.pricing?.originalContractPrice);
  if (before === null || after === null) return null;
  return { before, after };
}

/**
 * What the sale was worth, recovered from its own parts.
 *
 * The last resort: on a deal whose `originalContractPrice` has already been rewritten to
 * the new figure and whose draft has caught up, `downPayment + balance` is the only
 * surviving record of what the customer agreed to. `null` when neither part is recorded.
 */
export function contractFromSaleParts(down: any, balance: any): number | null {
  const d = toMoney(down);
  const b = toMoney(balance);
  if (d === null && b === null) return null;
  return (d || 0) + (b || 0);
}

/**
 * Which candidate may be shown as the price BEFORE the refund.
 *
 * ⚠️ **It must be strictly GREATER than the price now**, and this guard is the whole
 * function. Once the customer signs, the `/public` summary's `current.pricing` equals
 * `proposed` — both are the NEW price — so an ungated read labels one number as both
 * "before" and "after", which is exactly what was reported. A partially-collected deal
 * hits the same guard from the other side: its parts sum to less than the contract, so
 * they are discarded rather than printed as an original price the customer never agreed
 * to. The LARGEST viable candidate wins; when none is, the row is omitted.
 */
export function resolveBeforePrice(candidates: (number | null | undefined)[], after: number): number | null {
  const viable = (candidates || [])
    .map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : null))
    .filter((c): c is number => c !== null && c > after);
  return viable.length ? Math.max(...viable) : null;
}

export interface ContractRefundSummary {
  /** The price before the refund, or `null` when no candidate can be trusted. */
  before: number | null;
  /** ⚠️ Always the LIVE lead's price — a later addendum may have moved it again. */
  after: number;
  /** What is going back. Never derived from `before − after`. */
  refunded: number;
  /** The customer has signed for at least one refund on this job. */
  accepted: boolean;
  /** More than one accepted refund, so the total is a sum rather than a single row. */
  multiple: boolean;
  /** Every accepted refund has actually been paid back, not merely agreed. */
  settled: boolean;
  /** The representative refund — the oldest accepted one, else the request in flight. */
  refund: FundingRefund;
}

/**
 * The card's whole model, or `null` when this lead has nothing to say.
 *
 * ⚠️ Returns `null` for a lead with no refunds, junk input, or refunds that were all
 * declined or cancelled — so it costs an ordinary lead nothing, and the caller renders
 * it unconditionally.
 *
 * ⚠️ A refund still IN FLIGHT is reported (`accepted: false`) rather than hidden, but
 * with **no before/after price**: nothing has been agreed yet, and showing a reduced
 * contract value on a request that may still be declined would misstate the deal.
 */
export function buildContractRefundSummary(opts: {
  payments?: FundingPayment[] | null;
  /** The lead's price NOW. */
  currentContractPrice: number;
  /** The addendum that carried the refund, when one was fetched. */
  draftSummary?: any;
  /** The funding record's own contract price, when it has one. */
  fundingContractPrice?: number | null;
  /** `downPayment + balance`, the last-resort record of the original sale. */
  saleTotal?: number | null;
}): ContractRefundSummary | null {
  const refunds = allRefunds(opts.payments).filter((r) => !isDeadRefund(r));
  if (!refunds.length) return null;

  const after = Number(opts.currentContractPrice) || 0;
  const accepted = refunds.filter(isAcceptedRefund);
  const isAccepted = accepted.length > 0;

  // The representative row: the oldest ACCEPTED refund outranks any older request still
  // in flight, because what has been agreed is what changed the job.
  const representative = isAccepted ? firstAcceptedRefund(opts.payments)! : refunds[0];

  const refunded = isAccepted
    ? acceptedRefundTotal(opts.payments)
    : Math.round(refunds.reduce((n, r) => n + (Number(r.amount) || 0), 0));

  // ⚠️ Only an ACCEPTED refund earns a "before" price — see the in-flight note above.
  const before = isAccepted
    ? resolveBeforePrice(
        [contractPricesFromDraft(opts.draftSummary)?.before, opts.fundingContractPrice, opts.saleTotal],
        after
      )
    : null;

  return {
    before,
    after,
    refunded,
    accepted: isAccepted,
    multiple: accepted.length > 1,
    // Agreed and moving is not the same as landed, and the card says which.
    settled: isAccepted && accepted.every((r) => String(r.state) === 'refunded'),
    refund: representative,
  };
}
