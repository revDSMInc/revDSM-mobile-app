import { logEvent } from '../../services/api/LoggerService';
import { FUNDING_MODULE } from '../../constants/activity-log.constants';

/**
 * Funding — activity logging (Forever Record).
 *
 * Every rep action across the two halves of the Result Lead sheet:
 *
 *   pricing panel   the structure choice, each payment row added / removed / given
 *                   a method, and the save that files them all
 *   funding screen  per payment — the link requested, sent, copied; a check marked
 *                   collected; a card confirmed on file and CHARGED; a lender
 *                   decision synced; a loan activated — then the result and submit
 *
 * Its own module (`funding`) for the reason in `activity-log.constants.ts`: this is
 * the only surface where money actually moves and where a third party decides the
 * outcome, so the filtered timeline should read as the money trail for the job.
 *
 * Conventions, all inherited from `investment-center-log.ts`:
 *  - fire-and-forget; a dropped analytics row must never affect the rep
 *  - one verb per event, reused from `LOG_ACTIONS`
 *  - `meta.action` is the specific event name the portal labels the row from
 *  - a `userId`-less call is a no-op rather than a bad row
 *
 * ⚠️ **The hosted-page URL is never logged, and no function here accepts one.** It
 * is a bearer credential scoped to one payment — anyone holding it can complete
 * that payment — so it must not reach a log line, a console, or the portal. The
 * channel and destination are logged instead; the server already stores those on
 * the payment as `sentChannel` / `sentTo`.
 *
 * ⚠️ There is no event for a simulated lender outcome, and there must not be: the
 * Scenario Simulator and its `mock-provider` endpoint were removed precisely
 * because they wrote invented approvals and declines onto a real funding record.
 * A decision reaches this module only through `funding_payment_synced` (what the
 * lender actually said) or `recordDecision` (a real verdict reported out of band).
 */

/** Every funding event carries the job it belongs to and the quote it came from. */
export interface FundingLogBase {
  userId?: string;
  leadId?: string;
  /** The calculator this sale was resulted from, so the money links back to the quote. */
  calculatorId?: string;
  calculatorTitle?: string;
}

/**
 * The payment a per-row event happened on.
 *
 * ⚠️ `method` here is the catalogue LABEL the funding record holds (`MC/Visa
 * (2.9%)`), not a plan key — that is what the server stores on the row and what the
 * rep sees on the card, so it is what the timeline should read. Row-level pricing
 * events on the pricing panel carry the KEY as well, under `paymentMethod`.
 */
export interface FundingLogPayment {
  pid?: string;
  method?: string;
  /** `check` | `cc` | `bank`, as resolved by the SERVER from the method. */
  type?: string;
  /** `down` | `bal`. */
  kind?: string;
  amount?: number;
}

const base = (o: FundingLogBase, extra: Record<string, unknown>) => ({
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  ...(o.calculatorTitle ? { calculatorTitle: o.calculatorTitle } : {}),
  ...(o.leadId ? { leadId: o.leadId } : {}),
  ...extra,
});

/** Payment identity, flattened into meta. Empty fields are omitted, never sent blank. */
const paymentMeta = (p?: FundingLogPayment) =>
  p
    ? {
        ...(p.pid ? { paymentId: p.pid } : {}),
        ...(p.method ? { paymentMethod: p.method } : {}),
        ...(p.type ? { methodType: p.type } : {}),
        ...(p.kind ? { paymentKind: p.kind } : {}),
        ...(p.amount !== undefined ? { amount: p.amount } : {}),
      }
    : {};

/** One `logEvent` call, shaped the same way for every event in this module. */
const fire = (verb: string, o: FundingLogBase, meta: Record<string, unknown>) => {
  if (!o.userId) return Promise.resolve();
  return logEvent(verb, {
    user_id: o.userId,
    created_by: o.userId,
    module_type: FUNDING_MODULE,
    meta: base(o, meta),
  });
};

// ── the pricing panel ──────────────────────────────────────────────────────

/**
 * How the contract is being paid changed — a down payment plus a balance, or the
 * whole thing collected upfront.
 *
 * Worth its own event because it is the one choice on this screen that cannot be
 * taken back once a payment starts moving, and it decides whether a balance exists
 * at all.
 */
export const logFundingStructureChanged = (o: FundingLogBase & { from: string; to: string }) =>
  fire('select', o, { action: 'funding_structure_changed', from: o.from, to: o.to });

/** The rep added a payment line to the Down Payment / Balance / Upfront group. */
export const logFundingRowAdded = (o: FundingLogBase & { kind: string; rowCount?: number }) =>
  fire('add', o, {
    action: 'funding_payment_row_added',
    paymentKind: o.kind,
    ...(o.rowCount !== undefined ? { rowCount: o.rowCount } : {}),
  });

/**
 * The rep removed a payment line.
 *
 * The amount and method it was carrying are logged with it — after the fact the row
 * is gone, so the event is the only record that the money was ever assigned there.
 */
export const logFundingRowRemoved = (
  o: FundingLogBase & { kind: string; amount?: number; method?: string; methodLabel?: string },
) =>
  fire('delete', o, {
    action: 'funding_payment_row_removed',
    paymentKind: o.kind,
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
    ...(o.method ? { paymentMethod: o.method } : {}),
    ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
  });

/**
 * A payment method was picked for one line.
 *
 * ⚠️ Carries BOTH spellings on purpose: `paymentMethod` is the plan KEY (what the
 * lead's own `paymentMethod` scalar stores and what every consumer resolves
 * against the catalogue) and `methodLabel` is what the rep actually saw. A log
 * holding only the key reads as `2521` to a human; one holding only the label
 * cannot be matched back to the catalogue.
 */
export const logFundingMethodSelected = (
  o: FundingLogBase & { kind: string; method: string; methodLabel?: string; amount?: number },
) => {
  if (!o.method) return Promise.resolve();
  return fire('select', o, {
    action: 'funding_payment_method_selected',
    paymentKind: o.kind,
    paymentMethod: o.method,
    ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
    ...(o.amount !== undefined ? { amount: o.amount } : {}),
  });
};

/**
 * **Confirm** — the payment rows were filed (`PUT …/funding`).
 *
 * This is the event that records what the contract was actually split into, so it
 * carries the whole breakdown rather than a count: `payments` is the complete list
 * as sent, which is also what the server treats as authoritative (rows omitted are
 * deleted). A later reader can reconstruct the deal from this one row.
 */
export const logFundingPaymentsSaved = (
  o: FundingLogBase & {
    contractPrice: number;
    payMode: string;
    payments: { kind: string; method: string; amount: number }[];
    ok: boolean;
    /** The server's message when it refused — a 422 names the offending row. */
    error?: string;
  },
) =>
  fire('save', o, {
    action: o.ok ? 'funding_payments_saved' : 'funding_payments_save_failed',
    contractPrice: o.contractPrice,
    payMode: o.payMode,
    paymentCount: o.payments.length,
    payments: o.payments,
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/** The Funding screen opened — the rep moved past pricing onto the money itself. */
export const logFundingOpened = (
  o: FundingLogBase & { contractPrice: number; paymentCount: number; payMode: string },
) =>
  fire('view', o, {
    action: 'funding_opened',
    contractPrice: o.contractPrice,
    paymentCount: o.paymentCount,
    payMode: o.payMode,
  });

/**
 * Back to the pricing panel — the header chevron or **Edit payments**.
 *
 * `reassigning` marks the case that matters: the rep is going back because a lender
 * decision left money to re-assign, not because they changed their mind.
 */
export const logFundingEditPayments = (o: FundingLogBase & { reassigning?: boolean }) =>
  fire('navigate', o, {
    action: 'funding_edit_payments',
    ...(o.reassigning ? { reassigning: true } : {}),
  });

// ── one payment's life cycle ───────────────────────────────────────────────

/**
 * The send sheet was opened and a hosted-page url requested (`POST …/link`).
 *
 * ⚠️ Marks NOTHING as sent — that is `funding_link_sent` — and ⚠️ the url itself is
 * never logged. Three outcomes are distinguished because they mean different things
 * to whoever reads the timeline: it worked; the company's Stripe account cannot
 * accept payments (nobody at the table can fix that); or it simply failed.
 */
export const logFundingLinkRequested = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; blocked?: boolean; error?: string },
) =>
  fire('open', o, {
    action: o.ok ? 'funding_link_requested' : o.blocked ? 'funding_link_blocked' : 'funding_link_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: o.blocked ? 'blocked' : 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/**
 * A send actually happened → Link Sent.
 *
 * ⚠️ Only fired when the SERVER confirms it. On a 502 nothing was written and the
 * step did not advance, so logging a send there would put a delivery in the record
 * that never happened — that case is logged as the failure it is.
 *
 * `qr` carries no destination by design (nothing was transmitted; the rep confirmed
 * the homeowner scanned it at the table).
 */
export const logFundingLinkSent = (
  o: FundingLogBase & {
    payment: FundingLogPayment;
    channel: string;
    /** The phone or email the server delivered to. Absent for `qr`. */
    destination?: string;
    ok: boolean;
    error?: string;
  },
) =>
  fire('send', o, {
    action: o.ok ? 'funding_link_sent' : 'funding_link_send_failed',
    ...paymentMeta(o.payment),
    channel: o.channel,
    ...(o.destination ? { destination: o.destination } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/**
 * The rep copied the link to the clipboard.
 *
 * Logged because it is a way the credential leaves the app that no other event
 * covers — the payment can then be completed from anywhere the rep pasted it.
 * ⚠️ The url is NOT part of the payload; only that a copy happened.
 */
export const logFundingLinkCopied = (o: FundingLogBase & { payment: FundingLogPayment }) =>
  fire('click', o, { action: 'funding_link_copied', ...paymentMeta(o.payment) });

/**
 * The processor or lender was asked what happened (`POST …/sync`).
 *
 * `result` is the SERVER's own 200 message — `No change yet`, `Card confirmed on
 * file`, `Lender approved in full` / `…part of the request` / `Lender declined`.
 * That string is the whole value of this event: the decision is the third party's,
 * so the timeline needs what they said, not what the app inferred.
 */
export const logFundingPaymentSynced = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; result?: string; error?: string },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_payment_synced' : 'funding_payment_sync_failed',
    ...paymentMeta(o.payment),
    ...(o.result ? { result: o.result } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/** **Sync all** — one event for the sweep, with the per-row results logged too. */
export const logFundingSyncAll = (o: FundingLogBase & { paymentCount: number }) =>
  fire('update', o, { action: 'funding_sync_all', paymentCount: o.paymentCount });

/**
 * A down-payment check was marked physically taken.
 *
 * ⚠️ The only step in the whole module with no third-party verification — it is the
 * rep's word — which is precisely why it is worth a row with a name against it.
 */
export const logFundingCheckCollected = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; error?: string },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_check_collected' : 'funding_check_collect_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/** The processor confirmed the homeowner's card was vaulted, out of band. */
export const logFundingCardOnFile = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; error?: string },
) =>
  fire('update', o, {
    action: o.ok ? 'funding_card_on_file' : 'funding_card_on_file_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/**
 * A card on file was charged. ⚠️ **This is the one action that moves real money.**
 *
 * Both outcomes are logged and they are NOT interchangeable: on a `402` the row is
 * left un-charged and nothing moved, so a retry is a genuine second attempt — and a
 * timeline that showed only successes would make a run of declines invisible.
 */
export const logFundingCardCharged = (
  o: FundingLogBase & { payment: FundingLogPayment; ok: boolean; declined?: boolean; error?: string },
) =>
  fire('submit', o, {
    action: o.ok ? 'funding_card_charged' : o.declined ? 'funding_card_declined' : 'funding_card_charge_failed',
    ...paymentMeta(o.payment),
    ...(o.ok ? {} : { outcome: o.declined ? 'declined' : 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/**
 * An approved loan was authorized and activated.
 *
 * `approvedAmt` is logged beside the row's `amount` because on a partial approval
 * they differ, and the activated figure is the one the job is actually funded for.
 */
export const logFundingLoanActivated = (
  o: FundingLogBase & { payment: FundingLogPayment; approvedAmt?: number; ok: boolean; error?: string },
) =>
  fire('submit', o, {
    action: o.ok ? 'funding_loan_activated' : 'funding_loan_activate_failed',
    ...paymentMeta(o.payment),
    ...(o.approvedAmt !== undefined ? { approvedAmt: o.approvedAmt } : {}),
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

// ── result and submit ──────────────────────────────────────────────────────

/**
 * The job outcome moved between Sale and Bank Decline.
 *
 * ⚠️ Bank Decline is a lender's verdict, not a rep's opinion — the server refuses it
 * without a logged `Declined` attempt — so this event is the record of a rep acting
 * on that verdict, and it cannot be undone after the funding is submitted.
 */
export const logFundingResultChanged = (
  o: FundingLogBase & { result: string; ok: boolean; error?: string },
) =>
  fire('select', o, {
    action: 'funding_result_changed',
    result: o.result,
    ...(o.ok ? {} : { outcome: 'failed', ...(o.error ? { error: o.error } : {}) }),
  });

/**
 * **Submit Funding.**
 *
 * A refusal is logged as loudly as a success and carries the server's `blockers`
 * verbatim: "the rep could not submit" is only useful with what stopped them, and
 * that list is already itemised and ordered by the server.
 */
export const logFundingSubmitted = (
  o: FundingLogBase & {
    contractPrice: number;
    paymentCount: number;
    bankDecline?: boolean;
    ok: boolean;
    blockers?: string[];
    error?: string;
  },
) =>
  fire('submit', o, {
    action: o.ok ? 'funding_submitted' : 'funding_submit_blocked',
    contractPrice: o.contractPrice,
    paymentCount: o.paymentCount,
    ...(o.bankDecline ? { bankDecline: true } : {}),
    ...(o.ok
      ? {}
      : {
          outcome: 'blocked',
          ...(o.blockers?.length ? { blockers: o.blockers } : {}),
          ...(o.error ? { error: o.error } : {}),
        }),
  });
