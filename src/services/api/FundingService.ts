import { AxiosResponse } from 'axios';
import api from './index';

/**
 * FundingService — the Funding module (REVDSM-1155, `FUNDING-MOBILE-API.md`).
 *
 * Tracks the money owed on a job as a list of payment rows, each with a `kind`
 * (down payment / balance), a `method` and a lifecycle of steps.
 *
 * Five rules from the spec that shape every method below:
 *
 *  1. **`pid` is the app's to generate and must be STABLE** — it is the merge key
 *     for `PUT`. Reuse it across saves or rows duplicate. See `newPaymentId`.
 *  2. **The app never sees card or bank details.** There is no card form; the
 *     homeowner completes a third-party hosted page reached through `getLink`.
 *  3. **Steps advance SERVER-SIDE only.** Never set `step` locally and never
 *     optimistically tick a box — render what the response returns.
 *  4. **Sync reports, it never charges.** Charging is `charge`, its own endpoint.
 *  5. **Amounts are whole dollars.** Integers only — see `toWholeDollars`.
 *
 * Every endpoint returns the WHOLE funding record, so the screen re-renders from
 * any response without a follow-up GET. The two exceptions are `getPayment`
 * (`data.payment`) and a blocked `submit` (`409` carrying `data.blockers`).
 *
 * ⚠️ `companyid` is required on every request. It is sent as a header, the same
 * convention `LeadService.getLeadDraft` / `getRehashLeads` already use. The spec
 * spells it lowercase and the repo elsewhere spells it `companyId`; HTTP header
 * names are case-insensitive and Node lowercases them on arrival, so both reach
 * the server identically — this file uses the spec's spelling.
 */

// ── shapes ─────────────────────────────────────────────────────────────────

/** Success or failure, every funding endpoint answers in this envelope. */
export interface FundingEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export type FundingKind = 'down' | 'bal';
/** ⚠️ Resolved by the SERVER from `method`. Any `type` sent is accepted and discarded. */
export type FundingMethodType = 'check' | 'cc' | 'bank';
export type FundingDecision = 'full' | 'short' | 'declined';
export type FundingChannel = 'qr' | 'text' | 'email';
export type FundingResult = 'sale' | 'bankDecline';
export type FundingRecordStatus = 'pending' | 'submitted';

/**
 * Why a hosted application/payment page stopped without completing.
 *
 * ⚠️ The server RESETS the row to unsent when one of these lands, so `linkSent`
 * goes back to `false`. Without reading this field the screen says "link not sent
 * yet" about a link the rep demonstrably sent, which reads as an app bug rather
 * than as the homeowner having closed the page.
 */
export type FundingApplicationClosed = 'abandoned' | 'canceled' | 'expired' | 'error';

/**
 * ── refunds (REVDSM-1160) ──────────────────────────────────────────────────
 *
 * A refund exists for exactly one reason on this app: the rep re-priced a deal
 * BELOW what has already been collected, so money has to go back. Everything else
 * an addendum can change — install date, scope, materials, a price that goes UP —
 * needs no approval and creates no refund.
 *
 * ⚠️ **The eight states are the server's and must not be re-labelled or collapsed.**
 * `RefundRules.ts` owns the machine:
 *
 * ```
 * pendingApproval → pendingCustomer | declined | cancelled
 * pendingCustomer → customerSigned  | cancelled
 * customerSigned  → issuing         | cancelled
 * issuing         → refunded        | failed
 * failed          → issuing         | cancelled      ← retryable
 * ```
 *
 * ⚠️ `refunded`, `declined` and `cancelled` are TERMINAL. A declined request is not
 * re-openable — the rep raises a new refund.
 */
export type FundingRefundState =
  | 'pendingApproval'
  | 'pendingCustomer'
  | 'customerSigned'
  | 'issuing'
  | 'refunded'
  | 'failed'
  | 'declined'
  | 'cancelled';

export type FundingRefundReason =
  | 'priceDrop'
  | 'jobCancelled'
  | 'bankDecline'
  | 'customerDispute'
  | 'completionDispute'
  | 'other';

export type FundingRefundMethod = 'card' | 'check';

/** A refund row, as it rides back on `payment.refunds[]`. */
export interface FundingRefund {
  rid: string;
  /**
   * ⚠️ **What the HOMEOWNER receives**, not what the company is out of pocket.
   * `feeBorne` records who absorbs the processor's fee and `netAmount` is the
   * server's arithmetic — never compute a net figure locally.
   */
  amount: number;
  netAmount?: number | null;
  feeBorne?: 'company' | 'customer' | null;
  method: FundingRefundMethod;
  reason: FundingRefundReason;
  note?: string | null;
  state: FundingRefundState;
  requestedBy?: string | null;
  approvalId?: string | null;
  /** ⚠️ The join to the addendum the customer signs. See `requestRefund`. */
  draftId?: string | null;
  /** The processor's own refund id, once the money actually moved. */
  providerRef?: string | null;
  receipt?: string | null;
  events?: FundingRowEvent[];
  at?: string | null;
}

export type ApprovalState = 'pending' | 'approved' | 'declined' | 'cancelled';

/**
 * Whether the rep may chase this approver yet, and why not (REVDSM-1160).
 *
 * ⚠️ **SERVER-COMPUTED — never derive any of this on the device.** The window is
 * two backend constants (48 h before a first reminder, then one a day) and Lance has
 * not confirmed the 48; serving it rather than hardcoding it is precisely so a change
 * needs no app release. A client that recomputed would disagree with the endpoint
 * that actually refuses.
 *
 * Rides on every approval row from `/approvals/list`, `/approvals/mine` and
 * `GET /lead/v1/:leadId/approvals`, and on BOTH the 200 and the 409 from `…/remind`.
 */
export interface FundingApprovalReminder {
  canRemind: boolean;
  /** How long the approver has been sitting on it — the reason a rep would chase. */
  waitingHours?: number;
  waitingDays?: number;
  remindersSent?: number;
  lastRemindedAt?: string | null;
  nextRemindAt?: string | null;
  /** Server-worded, and shown verbatim in place of the button. */
  blockedReason?: string | null;
}

/** One approval request. `approved` and `declined` are terminal. */
export interface ApprovalRecord {
  _id?: string;
  id?: string;
  leadId?: string;
  state: ApprovalState;
  type?: 'refund' | string;
  requestedBy?: { userId?: string; id?: string; name?: string; role?: string } | string | null;
  /**
   * ⚠️ **The assignee is an ID, and the live response carries NO `assignedTo` object.**
   * Reading only the object made the Lead Center card report an assigned request as
   * *"Not assigned to anybody yet"* — see `approverNameOf`, which needs a name lookup
   * against `/approvals/approvers` because names live nowhere on this row.
   */
  assignedToUserId?: string | null;
  /** ⚠️ Absent on the live shape — kept for a deployment that embeds it. */
  assignedTo?: { id?: string; name?: string } | null;
  /**
   * ⚠️ **Frozen at request time.** Editing the company config never invalidates a
   * request already out, so render THIS rather than the live approver config.
   */
  eligibleRoles?: { id: string; name: string }[];
  note?: string | null;
  decidedAt?: string | null;
  /**
   * ⚠️ **What the row actually carries — verified against a live response.** The refund
   * is REFERENCED, not embedded: there is no amount here, so anything that wants one
   * has to join `subject.refundId` against the funding record (`refundForApproval`).
   */
  subject?: { kind?: string; paymentId?: string; refundId?: string } | null;
  eligibleRoleIds?: string[];
  decision?: { outcome?: string; at?: string; by?: any; note?: string } | null;
  history?: { action?: string; at?: string; by?: any; toUserId?: string | null; note?: string | null }[];
  /** ⚠️ Not present on the live shape — kept for a deployment that embeds it. */
  refund?: { rid?: string; amount?: number; method?: string; reason?: string } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /**
   * ⚠️ The clock runs from `createdAt`, **not** `updatedAt` — a reassignment or an
   * edit touches the document without the approver having done anything, so resetting
   * on that would let a stalled request hide behind its own bookkeeping.
   */
  reminder?: FundingApprovalReminder | null;
}

/** `GET /lead/v1/approvals/approvers?type=refund`. */
export interface ApproverFeed {
  approvers: { id: string; name: string; email?: string; roleId?: string; roleName?: string }[];
  roles: { id: string; name: string }[];
  /**
   * ⚠️ `false` ⇒ the list is empty ⇒ **a refund request will 409**. A company with
   * no approvers configured cannot refund at all, by design — the alternative is
   * waving an unapproved refund through. Say so before the rep fills the form.
   */
  isConfigured: boolean;
  /**
   * ⚠️ When `false`, exclude the signed-in user from the picker rather than letting
   * the decide call 403 later.
   */
  allowSelfApproval: boolean;
}

/**
 * A payment row as the server holds it.
 *
 * ⚠️ Everything from `step` down is READ-ONLY to the app — an upsert sends only
 * `pid`, `kind`, `method`, `type`, `amount`; the rest is ignored on the way in.
 */
export interface FundingPaymentRow {
  /** The app's id, and the merge key. */
  pid: string;
  kind: FundingKind;
  /** The LABEL the rep picked (e.g. `MC/Visa (2.9%)`) — the server derives `type` from it. */
  method: string;
  type: FundingMethodType;
  /** Whole dollars. On a locked row this is what was ASKED, not what was granted. */
  amount: number;

  step: number;
  linkSent: boolean;
  sentChannel: FundingChannel | null;
  /** `null` for a QR-only send. */
  sentTo: string | null;
  sentAt?: string | null;

  /** Financing only. */
  decision: FundingDecision | null;
  /** The ask, preserved explicitly once a decision lands. */
  requested: number | null;
  /** What the lender GRANTED. ⚠️ Display and coverage maths both use this. */
  approvedAmt: number | null;
  activated: boolean;
  charged: boolean;
  collected: boolean;

  /**
   * The homeowner's hosted page ended without completing — `null` while it is
   * still live (or was never opened). ⚠️ Comes with `linkSent` reset to `false`,
   * so it is the ONLY thing distinguishing "never sent" from "sent, and they
   * closed it". See `FundingApplicationClosed`.
   */
  applicationClosed?: FundingApplicationClosed | null;
  applicationClosedAt?: string | null;

  syncedAt?: string | null;
  /** Set once a lender decision lands; the row's amount/method/kind then freeze. */
  lockedAt?: string | null;

  /**
   * ── drift ────────────────────────────────────────────────────────────────
   * `baseline` is the amount as of the last settlement (the original approval, or
   * the last reactivation); `liveUsage` is what the job needs NOW after the rep
   * re-priced it. `drifted` is the server's own comparison of the two.
   *
   * ⚠️ This is the whole reason `reactivate` exists, and it is the case the deal-edit
   * wizard creates constantly: an addendum that moves the contract price moves what
   * the loan has to carry, and until the row is re-settled the lender is still
   * committed to the OLD number. Reading `drifted` is what lets the screen say so
   * instead of quietly showing a figure the lender has not agreed to.
   */
  baseline?: number | null;
  liveUsage?: number | null;
  drifted?: boolean;

  /**
   * Refunds raised against this row. ⚠️ They stay here permanently once complete —
   * the audit trail is the point, so a refunded row still shows what was originally
   * collected beside what went back.
   */
  refunds?: FundingRefund[];

  /** The lender's ceiling — a short approval may still be raised up to this. */
  approvedCeiling?: number | null;
  /** How many times the card has been charged (every attempt, declines included). */
  chargeAttempts?: number;
  /** Who marked a check collected. Read-only. */
  collectedBy?: { userId?: string; name?: string; role?: string } | null;
  /** The most recent card decline, with the processor's advice. Read-only. */
  lastDecline?: FundingDecline | null;

  /**
   * Plans this row has been swapped away from, **newest first** — full snapshots,
   * so nothing is lost when the rep replaces a lender.
   *
   * ⚠️ `restore` is SYMMETRIC: whatever is current goes onto the shelf in exchange,
   * so a restore can itself be undone. That is why this is a list of snapshots
   * rather than a single "previous".
   */
  archived?: FundingArchivedPlan[];

  /** Per-row stage log — see `FundingRowEvent`. */
  events?: FundingRowEvent[];

  /** Opaque provider bag. ⚠️ Only `cardBrand` / `cardLast4` are safe to display. */
  providerState?: { cardBrand?: string; cardLast4?: string; [k: string]: unknown } | null;
}

/**
 * One archived plan on a row, as `POST …/restore` addresses it.
 *
 * ⚠️ Restore is keyed by `archivedId`, never by position: the list is symmetric, so
 * a restore pushes the current plan on and the indices all move.
 */
export interface FundingArchivedPlan {
  archivedId: string;
  method: string;
  type?: FundingMethodType;
  amount?: number;
  decision?: FundingDecision | null;
  approvedAmt?: number | null;
  archivedAt?: string;
  [k: string]: unknown;
}

/**
 * A card decline, kept on the row after the 402 has been dismissed.
 *
 * ⚠️ `action` is the field that matters — it decides which button the screen may
 * offer next. `providerMessage` is Stripe's own wording and is for LOGS: the
 * decline codes must never be repeated to the cardholder.
 */
export interface FundingDecline {
  declineCode?: string;
  action?: 'retry' | 'new_card' | 'recapture_card' | 'contact_issuer';
  retryable?: boolean;
  /** Safe to show the rep. */
  message?: string;
  /** ⚠️ For logs only — never shown to the cardholder. */
  providerMessage?: string;
  at?: string;
}

/**
 * One stage of a row as it completed.
 *
 * ⚠️ Deduplicated by the server EXCEPT `chargeFailed`, which records every attempt
 * — so the count of those is a real retry count, not a rendering artefact.
 *
 * ⚠️ Deliberately SEPARATE from `attemptHistory`: that one is per JOB and
 * lender-facing (what was asked, what was granted); this is per ROW and mechanical.
 * Folding them together loses which row a stage belonged to.
 */
export interface FundingRowEvent {
  type:
    | 'linkSent'
    | 'cardOnFile'
    | 'charged'
    | 'chargeFailed'
    | 'decision'
    | 'activated'
    | 'collected'
    | 'deposited'
    | 'applicationClosed';
  at?: string;
  by?: { userId?: string; name?: string; role?: string } | null;
  [k: string]: unknown;
}

/**
 * One line of a multi-method allocation, as it is persisted BESIDE the four flat
 * scalars (`downPayment` / `paymentMethod` / `balance` / `balancePaymentMethod`)
 * on `Lead`, `LeadOutcome`, `LeadCalculatorOutcome`, `LeadDraft` and
 * `JobBuilderDraft`.
 *
 * ⚠️ **`method` holds a plan KEY, not a label** — the same domain as the
 * `paymentMethod` scalar it mirrors, which every consumer resolves against the
 * company's payment-plan catalogue. A joined display string like `"Check + AMEX"`
 * resolves to nothing everywhere at once.
 *
 * ⚠️ Do NOT confuse this with `FundingPaymentRow.method`, which is the catalogue
 * LABEL — that is the field the funding server derives `type` from. The two live
 * on different records and carry different values on purpose.
 */
export interface PaymentAllocation {
  /** Plan KEY (`'check'`, `'2521'`, …). */
  method: string;
  /** Whole dollars. */
  amount: number;
  /** Resolved locally for readers with no catalogue to hand; the server ignores it. */
  label?: string;
  type?: FundingMethodType;
}

/** Written server-side whenever a lender decision arrives. Read-only. */
export interface FundingAttempt {
  pid: string;
  method: string;
  requested: number;
  approved: number;
  outcome: 'Full' | 'Partial' | 'Declined';
  at: string;
}

export interface FundingRecord {
  /** Absent on the synthetic empty record a first `GET` returns. */
  _id?: string;
  leadId: string;
  companyId?: string;
  contractPrice: number;
  /** Persisted but never read or written by any endpoint. Ignore it (spec §3). */
  contractPriceUnlocked?: boolean;
  /**
   * The saved structure. ⚠️ Read it rather than inferring one: `inferPayMode` only
   * guesses from the rows, and a contract paid in full with a single down row is
   * indistinguishable from an upfront one that way.
   *
   * Omitting it from a `PUT` leaves the stored structure alone.
   */
  payMode?: 'split' | 'upfront';
  status: FundingRecordStatus;
  submittedAt?: string | null;
  submittedBy?: string | null;
  result: FundingResult;
  resultChangedAt?: string | null;
  payments: FundingPaymentRow[];
  attemptHistory: FundingAttempt[];
  createdAt?: string;
  updatedAt?: string;
}

/** The only fields an upsert may carry; everything else on a row is server-owned. */
export interface FundingUpsertRow {
  pid: string;
  kind: FundingKind;
  method: string;
  /** Accepted and discarded — sent for forward-compatibility only (spec §3.1). */
  type?: FundingMethodType;
  amount: number;
}

type FundingResponse = AxiosResponse<FundingEnvelope<{ funding: FundingRecord }>>;

/**
 * `sync-all` answers with the record PLUS what the sweep did.
 *
 * ⚠️ `problems` is per row and never fails the call — one lender being unreachable
 * must not stop the other two rows being refreshed, which is the whole reason this
 * exists as one endpoint instead of a loop over `sync`.
 */
export interface FundingSyncAllResult {
  funding: FundingRecord;
  /** How many rows were pollable and got asked. */
  polled?: number;
  /** How many came back different. */
  changed?: number;
  /** Per-row failures, already worded for display. */
  problems?: string[];
}

type FundingSyncAllResponse = AxiosResponse<FundingEnvelope<FundingSyncAllResult>>;

/**
 * The company's down-payment ceiling.
 *
 * ⚠️ The SERVER enforces this (it is the `422` a `PUT` can now answer with), so the
 * app does not have to. Reading it is purely so the rep sees the ceiling beside the
 * input instead of discovering it by being refused.
 */
export interface DownPaymentLimit {
  /** Percent of the contract price, e.g. `50`. */
  maxPercentage?: number;
  /** Optional per-state overrides, keyed by state code. */
  states?: Record<string, number>;
  [k: string]: unknown;
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * A fresh, stable payment id.
 *
 * ⚠️ Must NOT be a session counter: rows persist between visits, so a counter
 * would re-issue `p-1` for a brand-new row and collide with — and silently
 * overwrite — the saved row of the same name. Random suffix, `p-` prefixed to
 * match the shape the spec documents (`p-yboq8agk`).
 */
export function newPaymentId(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}`;
}

/** Amounts are whole dollars; the API rejects decimals with `422` (spec §5.2). */
export function toWholeDollars(value: number | string): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/**
 * What a funding failure means, so a caller can decide what to DO without
 * reading the message (spec §2.1).
 *
 * `stale` is the one worth wiring: "card not on file yet", "payment is locked",
 * "shortfall unassigned" and "not ready to submit" all mean *this view of the
 * record is behind the server's*. Re-`GET` and re-render, and the dead button
 * usually just comes alive.
 */
export type FundingErrorKind =
  /** 400 — malformed request. A bug in the app; don't retry, log it. */
  | 'bug'
  /** 422 — understood but not allowed. Show the message; retrying can't help. */
  | 'rule'
  /** 409 — conflicts with the record's CURRENT state. Re-GET and re-render. */
  | 'stale'
  /**
   * 409 on `…/link` or `…/link-sent` — the company's payment gateway is connected
   * but cannot accept payments (Stripe `charges_enabled: false`).
   *
   * ⚠️ **Terminal for now, and the one 409 that must NOT be retried.** Nothing
   * about the record is stale, so re-`GET`ting returns the same answer and a client
   * that implements the documented "refresh and retry" 409 behaviour loops. Someone
   * with portal access has to finish setup in Stripe. It also used to surface as a
   * `503 "No payment provider is configured yet"`, which sent whoever was debugging
   * to check environment variables that were already correct.
   */
  | 'setupRequired'
  /**
   * 409 on `…/refund` — the company has **no refund approvers configured**.
   *
   * ⚠️ A second 409 that a refresh cannot fix, and it must not be mistaken for a
   * stale-state one: nothing about the record is behind, the company simply has
   * nobody who may approve, so re-`GET`ting returns the same answer forever. Only
   * someone with portal access can set them. Surface it as "ask your admin", never
   * as a generic failure or a retry.
   */
  | 'approversMissing'
  /**
   * 409 on `…/approvals/:id/remind` — the reminder cooldown has not elapsed.
   *
   * ⚠️ The THIRD 409 a refresh cannot fix, and the one most easily mistaken for a
   * stale record: nothing is behind, the request is simply too young or was already
   * reminded today. The body carries the server's own `message` AND a full `reminder`
   * object, so the rep can be told exactly when they may try again — surface both
   * rather than swallowing it into a generic "Funding updated".
   */
  | 'remindTooSoon'
  /** 402 — the processor declined the card. Nothing was collected. */
  | 'cardDeclined'
  /** 404 — the lead or the payment was not found. */
  | 'notFound'
  /** 502 — delivery/provider failure. NOTHING WAS WRITTEN; offer another channel. */
  | 'delivery'
  /** 503 — no payment provider configured. NOTHING WAS WRITTEN; environment problem. */
  | 'noProvider'
  | 'unknown';

export interface FundingError {
  kind: FundingErrorKind;
  /** The server's own wording — safe to show, never to branch on. */
  message: string;
  httpStatus?: number;
  /** Only on a blocked `submit` (409). Pre-formatted; render verbatim. */
  blockers?: string[];
  /**
   * Only on `…/remind`. Present on the **409** as well as the 200, which is the
   * whole point — a refused reminder still has to tell the rep when they may retry.
   */
  reminder?: FundingApprovalReminder;
}

const KIND_BY_STATUS: Record<number, FundingErrorKind> = {
  400: 'bug',
  402: 'cardDeclined',
  404: 'notFound',
  409: 'stale',
  422: 'rule',
  502: 'delivery',
  503: 'noProvider',
};

/**
 * Is this the path of a link endpoint (`…/link` or `…/link-sent`)?
 *
 * Read off the failed request rather than passed in by each caller, so no future
 * call site can forget it and quietly re-introduce the retry loop. Query strings
 * and trailing slashes are tolerated because the value comes from axios' `config`,
 * which is whatever the caller handed it.
 */
export function isLinkEndpointUrl(url?: string | null): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  return /\/link(-sent)?$/.test(path);
}

/**
 * Is this the REQUEST-a-refund path (`…/refund`, not `…/refund/:rid/issue`)?
 *
 * Read off the failed request for the same reason `isLinkEndpointUrl` is: a 409
 * here means "no approvers configured", and a call site that forgot to say so
 * would fall into the generic stale handling, refetch, and report the failure as
 * an informational "Funding updated" — which reads as success.
 */
export function isRefundRequestUrl(url?: string | null): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  return /\/refund$/.test(path);
}

/**
 * Is this the reminder path (`…/approvals/:id/remind`)?
 *
 * Read off the failed request for the same reason the two above are: a 409 here means
 * "too soon", and left as a generic `stale` it would refetch and report a refusal as
 * an informational "Funding updated".
 */
export function isRemindEndpointUrl(url?: string | null): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  return /\/remind$/.test(path);
}

/**
 * Normalize any funding rejection into `{ kind, message, blockers }`.
 *
 * `opts.linkEndpoint` forces the link-endpoint reading for a caller that knows it
 * (a re-classified error that has lost its axios `config`, say). Left undefined it
 * is inferred from the request url.
 */
export function classifyFundingError(
  err: any,
  opts?: { linkEndpoint?: boolean; refundRequest?: boolean; remind?: boolean }
): FundingError {
  const httpStatus: number | undefined = err?.httpStatus ?? err?.response?.status;
  const body = err?.response?.data ?? err;
  const blockers = body?.data?.blockers;
  const url = err?.config?.url ?? err?.response?.config?.url;
  const onLink = opts?.linkEndpoint ?? isLinkEndpointUrl(url);
  const onRefund = opts?.refundRequest ?? isRefundRequestUrl(url);
  const onRemind = opts?.remind ?? isRemindEndpointUrl(url);

  let kind: FundingErrorKind = (httpStatus && KIND_BY_STATUS[httpStatus]) || 'unknown';
  // ⚠️ The THREE 409s a refresh cannot fix. All must be decided here rather than at
  // the call sites, or the generic `stale` handling refetches and reports them as an
  // informational "Funding updated" — which reads as success.
  if (kind === 'stale' && onLink) kind = 'setupRequired';
  else if (kind === 'stale' && onRefund) kind = 'approversMissing';
  else if (kind === 'stale' && onRemind) kind = 'remindTooSoon';

  // ⚠️ The reminder window rides ON the 409 body, not only on the 200 — it is what
  // tells the rep WHEN they may try again, so it is carried through rather than
  // dropped with the rest of the response.
  const reminder = body?.reminder ?? body?.data?.reminder;

  return {
    kind,
    message: body?.message || err?.message || 'Something went wrong',
    httpStatus,
    ...(Array.isArray(blockers) ? { blockers } : {}),
    ...(reminder && typeof reminder === 'object' ? { reminder: reminder as FundingApprovalReminder } : {}),
  };
}

/**
 * Does this failure mean the app's copy of the record is stale?
 *
 * `stale` (409) always does. `notFound` on a PAYMENT does too — the row was
 * removed or re-keyed elsewhere — so both should trigger a re-`GET`.
 *
 * ⚠️ `setupRequired`, `approversMissing` and `remindTooSoon` deliberately do NOT: the
 * record is perfectly current in all three — one company has an unusable Stripe
 * account, another has nobody configured to approve, and the third simply reminded
 * the approver too recently — and re-reading returns the same answer.
 */
export function shouldRefetchAfter(error: FundingError): boolean {
  return error.kind === 'stale' || error.kind === 'notFound';
}

// ── endpoints ──────────────────────────────────────────────────────────────

const base = (leadId: string) => `/lead/v1/${encodeURIComponent(leadId)}/funding`;
const row = (leadId: string, pid: string) => `${base(leadId)}/${encodeURIComponent(pid)}`;

export const FundingEndpoints = {
  record: base,
  payment: row,
  link: (leadId: string, pid: string) => `${row(leadId, pid)}/link`,
  linkSent: (leadId: string, pid: string) => `${row(leadId, pid)}/link-sent`,
  cardOnFile: (leadId: string, pid: string) => `${row(leadId, pid)}/card-on-file`,
  decision: (leadId: string, pid: string) => `${row(leadId, pid)}/decision`,
  sync: (leadId: string, pid: string) => `${row(leadId, pid)}/sync`,
  activate: (leadId: string, pid: string) => `${row(leadId, pid)}/activate`,
  charge: (leadId: string, pid: string) => `${row(leadId, pid)}/charge`,
  checkCollected: (leadId: string, pid: string) => `${row(leadId, pid)}/check-collected`,
  /** Re-settle a drifted row against what the job needs now. */
  reactivate: (leadId: string, pid: string) => `${row(leadId, pid)}/reactivate`,
  /** Bring an archived plan back. Symmetric — the current plan goes onto the shelf. */
  restore: (leadId: string, pid: string) => `${row(leadId, pid)}/restore`,
  /** Every pollable row in ONE call. Lead-scoped, not row-scoped. */
  syncAll: (leadId: string) => `${base(leadId)}/sync-all`,
  submit: (leadId: string) => `${base(leadId)}/submit`,
  result: (leadId: string) => `${base(leadId)}/result`,
  /** Raise a refund against a collected row. Creates the approval too. */
  refund: (leadId: string, pid: string) => `${row(leadId, pid)}/refund`,
} as const;

/**
 * Approvals. ⚠️ Lead-scoped for the per-deal read, **flat** for every action —
 * declared separately for the same reason `DOWN_PAYMENT_LIMIT_ENDPOINT` is.
 *
 * ⚠️ `list` is TWO segments (`/approvals/list`), not one: `LeadController` owns
 * `GET /lead/v1/:id`, so a bare `/lead/v1/approvals` is ambiguous with a lead of
 * that id.
 */
export const ApprovalEndpoints = {
  forLead: (leadId: string) => `/lead/v1/${encodeURIComponent(leadId)}/approvals`,
  mine: '/lead/v1/approvals/mine',
  list: '/lead/v1/approvals/list',
  approvers: '/lead/v1/approvals/approvers',
  decide: (id: string) => `/lead/v1/approvals/${encodeURIComponent(id)}/decide`,
  reassign: (id: string) => `/lead/v1/approvals/${encodeURIComponent(id)}/reassign`,
  resend: (id: string) => `/lead/v1/approvals/${encodeURIComponent(id)}/resend`,
  remind: (id: string) => `/lead/v1/approvals/${encodeURIComponent(id)}/remind`,
} as const;

/**
 * The company's down-payment ceiling. ⚠️ NOT under the funding base — it is a
 * company config read, and it needs no permission beyond the JWT.
 */
export const DOWN_PAYMENT_LIMIT_ENDPOINT = '/company/v1/down-payment-limit/sales';

/**
 * Headers every funding call carries.
 *
 * `companyid` is REQUIRED — the API answers `400` without it, and scoping is by
 * lead within that company (a lead outside it is a `404`, never a `403`).
 *
 * ⚠️ `userId` is what puts the REP in the audit trail. It is optional to the API,
 * but absent it every action on the record is attributed to "RevDSM" (system) — so a
 * check marked collected, a card charged and a loan activated all lose the name of
 * the person who did them. It is sent on every call for that reason, not just the
 * ones that obviously write.
 */
const cfg = (companyId?: string, userId?: string) => {
  const headers: Record<string, string> = {};
  if (companyId) headers.companyid = companyId;
  if (userId) headers.userId = userId;
  return Object.keys(headers).length ? { headers } : undefined;
};

export const FundingService = {
  /**
   * The whole record. Safe to call on first open — with nothing saved yet the
   * server answers with a synthetic empty record (no `_id`) rather than a 404.
   */
  getFunding: (leadId: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.get(FundingEndpoints.record(leadId), cfg(companyId, userId)),

  /**
   * Create or replace the payment rows — the save for the whole pricing screen.
   *
   * ⚠️ `payments` is the COMPLETE list: rows omitted are DELETED (and removing a
   * row that has a sent link or a decision is refused with `409`). Funding state
   * is preserved per `pid` for rows whose `method` is unchanged; changing the
   * `method` resets that row's steps, link and decision.
   *
   * Two `422`s became reachable once rows are repeatable, and both NAME the
   * offending row — surface the message as-is rather than folding it into a
   * generic failure:
   *   - a `method` that is not one of this company's payment methods (which used
   *     to be silently classified as financing);
   *   - an `amount` of zero.
   * `toUpsertRows` drops both shapes before they are sent, so in practice these
   * only fire if a row reaches here another way.
   */
  savePayments: (
    leadId: string,
    payload: { contractPrice: number; payments: FundingUpsertRow[]; payMode?: 'split' | 'upfront' },
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> => api.put(FundingEndpoints.record(leadId), payload, cfg(companyId, userId)),

  /** One row. ⚠️ Returns `data.payment`, not `data.funding`. */
  getPayment: (
    leadId: string,
    pid: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<FundingEnvelope<{ payment: FundingPaymentRow }>>> =>
    api.get(FundingEndpoints.payment(leadId, pid), cfg(companyId, userId)),

  /**
   * The hosted-page URL. **Marks nothing** — call it when the send modal opens.
   *
   * Idempotent: repeat calls return the SAME url while the session is open, so a
   * rep can open the sheet, back out, show a QR and then text instead without
   * stacking links or leaving an earlier one live. This one url is what the QR
   * encodes AND what text/email deliver.
   *
   * ⚠️ The url is a BEARER CREDENTIAL scoped to this payment — anyone holding it
   * can complete it. Don't log it, don't persist it, don't let it outlive the send.
   *
   * ⚠️ `409` here is the `charges_enabled` gate, NOT a stale record — see
   * `FundingErrorKind.setupRequired`. Do not re-`GET` and retry.
   */
  getLink: (
    leadId: string,
    pid: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<FundingEnvelope<{ url: string; funding: FundingRecord }>>> =>
    api.post(FundingEndpoints.link(leadId, pid), undefined, cfg(companyId, userId)),

  /**
   * Record that a send actually happened → Link Sent (step 1). Cards and loans only.
   *
   * `text`/`email` send a real SMS/email and REQUIRE a destination; `qr` sends
   * nothing and must omit it (call it when the rep confirms "They scanned it").
   *
   * ⚠️ On `502`/`503` nothing is written — the step does not advance, and the app
   * must not show the link as sent.
   *
   * ⚠️ Same for `409`: this endpoint refuses on the `charges_enabled` gate BEFORE
   * marking anything sent, so the step never advances on a link that could not be
   * delivered. It is `setupRequired`, not `stale` — do not retry it.
   */
  markLinkSent: (
    leadId: string,
    pid: string,
    body: { channel: FundingChannel; destination?: string },
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> =>
    api.post(
      FundingEndpoints.linkSent(leadId, pid),
      // The spec is explicit that QR must omit `destination`, not send it empty.
      body.channel === 'qr' ? { channel: 'qr' } : { channel: body.channel, destination: body.destination },
      cfg(companyId, userId)
    ),

  /**
   * The processor's confirmation that the homeowner saved their card → step 2.
   * **Does not charge.**
   *
   * The spec says to prefer `sync` in normal operation; this exists for a webhook
   * or an explicit out-of-band confirmation.
   */
  markCardOnFile: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.cardOnFile(leadId, pid), { cardOnFile: true }, cfg(companyId, userId)),

  /**
   * Record a lender decision directly. Financing only. Appends to `attemptHistory`
   * and **locks the row** (its amount/method/kind can no longer change via `PUT`).
   *
   * `full` sets `approvedAmt` to the request automatically; `short` REQUIRES an
   * `approvedAmt` above 0 and below the request; `declined` zeroes it.
   *
   * In the normal flow a decision arrives through `sync` instead — this is the
   * out-of-band path for a decision reported to the rep directly.
   */
  recordDecision: (
    leadId: string,
    pid: string,
    body: { decision: FundingDecision; approvedAmt?: number },
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> =>
    api.post(
      FundingEndpoints.decision(leadId, pid),
      body.decision === 'short' ? body : { decision: body.decision },
      cfg(companyId, userId)
    ),

  /**
   * Ask the processor or lender what happened — **the main mechanism** for
   * advancing card and financing rows. Never moves money.
   *
   * The 200 `message` says what landed: `No change yet`, `Card confirmed on file`,
   * `Lender approved in full` / `…part of the request` / `Lender declined`.
   */
  syncPayment: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.sync(leadId, pid), undefined, cfg(companyId, userId)),

  /**
   * Poll EVERY pollable row in one request.
   *
   * ⚠️ Prefer this over a loop of `syncPayment`: one row failing never fails the
   * sweep (the failures come back itemised in `problems`), where a loop stops — or
   * worse, half-completes and leaves the screen describing a mix of two moments.
   */
  syncAll: (leadId: string, companyId?: string, userId?: string): Promise<FundingSyncAllResponse> =>
    api.post(FundingEndpoints.syncAll(leadId), undefined, cfg(companyId, userId)),

  /**
   * Activate an approved loan → `activated: true`, step 3.
   *
   * `409` when there is no decision yet, when the loan was declined, or when a
   * short approval's shortfall is still unassigned (cover it with `savePayments`).
   */
  activateLoan: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.activate(leadId, pid), undefined, cfg(companyId, userId)),

  /**
   * Re-settle a DRIFTED row against what the job needs now — the lender is
   * re-committed to `liveUsage` and `baseline` moves to match.
   *
   * The guards are worth pre-empting in the UI rather than discovering: bank rows
   * only, a decision must already exist, it is refused on a declined row, and it
   * answers `409` when the row already matches (i.e. `drifted` is false).
   */
  reactivateLoan: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.reactivate(leadId, pid), undefined, cfg(companyId, userId)),

  /**
   * Bring an archived plan back onto a row.
   *
   * ⚠️ **Symmetric**: whatever is current is archived in exchange, so nothing is
   * lost and the restore can itself be undone. Addressed by `archivedId` and never
   * by position — the list reorders on every swap.
   */
  restoreArchivedPlan: (
    leadId: string,
    pid: string,
    archivedId: string,
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> =>
    api.post(FundingEndpoints.restore(leadId, pid), { archivedId }, cfg(companyId, userId)),

  /**
   * Charge a card that is on file. ⚠️ **This moves real money.**
   *
   * Down-payment cards only — a balance card is charged by the processor after
   * install. `200 Card already charged` is idempotent success. On `402` the row is
   * NOT marked charged and nothing moved, so a retry is a genuine new attempt.
   */
  chargeCard: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.charge(leadId, pid), undefined, cfg(companyId, userId)),

  /**
   * Mark a down-payment check physically taken → `collected: true`, step 1.
   * The only step in the system with no third-party verification.
   */
  markCheckCollected: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.checkCollected(leadId, pid), undefined, cfg(companyId, userId)),

  /**
   * Submit the funding.
   *
   * `200 Funding already submitted` is idempotent success. A block is `409`
   * carrying `data.blockers` — pre-formatted, itemised and ordered, to be
   * **rendered verbatim** so the rep sees what is missing rather than a generic
   * "not ready". A `bankDecline` result submits immediately with no blocker check.
   */
  submitFunding: (leadId: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.submit(leadId), undefined, cfg(companyId, userId)),

  /**
   * Set the job outcome. Also updates the lead's status, upserts `LeadOutcome`
   * and emits a lead-change socket event.
   *
   * ⚠️ **Bank Decline is a lender's verdict, not a rep's opinion** — it requires a
   * `Declined` entry in `attemptHistory`, so the app must not offer it until one
   * exists, and it cannot be undone once the funding is submitted.
   */
  setResult: (leadId: string, result: FundingResult, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.result(leadId), { result }, cfg(companyId, userId)),

  /**
   * The company's maximum down payment, so the rep can be shown the ceiling
   * instead of being refused at Confirm by the `PUT`'s `422`.
   *
   * ⚠️ Advisory ONLY. The server is the enforcer; a client-side cap that disagreed
   * with it would either block a legal down payment or promise an illegal one.
   */
  getDownPaymentLimit: (
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<FundingEnvelope<DownPaymentLimit>>> =>
    api.get(DOWN_PAYMENT_LIMIT_ENDPOINT, cfg(companyId, userId)),

  /**
   * Raise a refund against a collected row — and the approval that gates it.
   *
   * ⚠️ **Submit the addendum draft FIRST and pass its `draftId`.** It is optional to
   * the API and required in practice: it is the ONLY join between the refund and the
   * paperwork the customer signs, it can only be set at creation (there is no endpoint
   * to attach a draft afterwards), and the consent handler moves only refunds whose
   * `draftId` matches the signed draft. A refund created without one reaches
   * `pendingCustomer` and **waits there forever** — no signature will ever advance it.
   *
   * ⚠️ `amount` is what the HOMEOWNER receives, in whole dollars, `> 0` and no more
   * than what is left refundable on the row. `feeBorne` records who absorbs the
   * processor's fee; that arithmetic is the processor's, so never send a net figure.
   *
   * ⚠️ Always send `assignedToUserId`. It is optional server-side, but an unassigned
   * request appears in NOBODY's `/approvals/mine` and simply sits there.
   *
   * ⚠️ A **409** here means the company has no approvers configured, not that the
   * record is stale — `classifyFundingError` maps it to `approversMissing`.
   */
  requestRefund: (
    leadId: string,
    pid: string,
    body: {
      amount: number;
      method: FundingRefundMethod;
      reason: FundingRefundReason;
      feeBorne?: 'company' | 'customer';
      note?: string;
      assignedToUserId?: string;
      draftId?: string;
    },
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> =>
    api.post(FundingEndpoints.refund(leadId, pid), body, cfg(companyId, userId)),
};

/**
 * Approvals — the internal gate in front of a refund.
 *
 * ⚠️ **There is deliberately no `issueRefund` here.** The endpoint exists
 * (`POST …/refund/:rid/issue`) and moves real money, but issuing is **Command Center
 * only** — Lance, 24 Aug: *"Only managers who have access to command center can issue
 * a refund."* The rep detects, requests and tracks; a manager releases the money.
 * Shipping the method in the app every rep carries is how it ends up behind a button,
 * which is the same reasoning that retired `mockProvider` above.
 */
export const ApprovalService = {
  /**
   * Who may approve a refund for this company, and whether anybody can.
   *
   * ⚠️ Read the list from HERE, never by filtering a user list client-side. The
   * config stores ROLE ids; this endpoint is the join to people, and it is the same
   * rule the decide guard enforces server-side. It is also the only user-list API
   * available to the mobile client at all.
   */
  approvers: (type = 'refund', companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.get(`${ApprovalEndpoints.approvers}?type=${encodeURIComponent(type)}`, cfg(companyId, userId)),

  /** Every approval on one deal — the detail read. */
  forLead: (leadId: string, companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.get(ApprovalEndpoints.forLead(leadId), cfg(companyId, userId)),

  /** Pending and assigned to the signed-in user. */
  mine: (companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.get(ApprovalEndpoints.mine, cfg(companyId, userId)),

  /**
   * ⚠️ **Approving returns no money.** It advances the refund to `pendingCustomer` —
   * it unlocks the customer's signature and nothing more. Never render the result as
   * "Refunded".
   *
   * `403` is a guard refusal carrying its own wording (wrong role, or the company does
   * not allow approving your own request) — show the server's message, it is the only
   * thing that explains WHY.
   */
  decide: (
    approvalId: string,
    body: { decision: 'approved' | 'declined'; note?: string },
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<any>> =>
    api.post(ApprovalEndpoints.decide(approvalId), body, cfg(companyId, userId)),

  /** Send it to somebody else. ⚠️ `pending`-only — 409 otherwise. */
  reassign: (
    approvalId: string,
    assignToUserId: string,
    note?: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<any>> =>
    api.post(
      ApprovalEndpoints.reassign(approvalId),
      { userId: assignToUserId, ...(note ? { note } : {}) },
      cfg(companyId, userId)
    ),

  /**
   * ⚠️ **LEGACY — writes an `ApprovalRequest.history[]` row and sends NOTHING.**
   * Use `remind` below, which actually reaches the approver. Kept only because the
   * route still exists; it is not wired to any UI.
   */
  resend: (approvalId: string, companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.post(ApprovalEndpoints.resend(approvalId), {}, cfg(companyId, userId)),

  /**
   * Nudge a silent approver (REVDSM-1160).
   *
   * ⚠️ Deliberately NOT gated on approver permission — the whole point is the REP
   * chasing somebody else's silence, so a rep who cannot approve can still remind.
   *
   * ⚠️ A **409 is not an error to swallow**: it means "too soon", and its `message`
   * and `reminder.nextRemindAt` are exactly what the rep needs to see.
   * `classifyFundingError` files it as `remindTooSoon` and carries the `reminder`
   * object through, so the call site can render the window rather than a retry.
   *
   * ⚠️ The delivery mechanism is the LEAD CHAT — the server posts a card and **adds
   * the approver as a participant on that thread**, since a message in a thread they
   * are not on tells them nothing. Nothing is sent by push or email.
   */
  remind: (
    approvalId: string,
    note?: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<any>> =>
    api.post(ApprovalEndpoints.remind(approvalId), note ? { note } : {}, cfg(companyId, userId)),
};

/**
 * ⚠️ **`POST …/{pid}/mock-provider` is gone, along with the Scenario Simulator that
 * drove it.** It stood in for a homeowner or a lender that does not exist in
 * development, so a tap on it wrote an invented approval or decline onto a real
 * funding record. Removed on request; the app now only ever reports what the actual
 * processor or lender did, which is what `syncPayment` reads.
 *
 * Do not reintroduce it here. If a simulator is ever needed again it belongs behind
 * a build flag, not in the service every rep's device ships with.
 */

export default FundingService;
