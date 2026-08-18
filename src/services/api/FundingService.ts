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
  /** Opaque provider bag — do not read or display. */
  providerState?: unknown;
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
 * Normalize any funding rejection into `{ kind, message, blockers }`.
 *
 * `opts.linkEndpoint` forces the link-endpoint reading for a caller that knows it
 * (a re-classified error that has lost its axios `config`, say). Left undefined it
 * is inferred from the request url.
 */
export function classifyFundingError(err: any, opts?: { linkEndpoint?: boolean }): FundingError {
  const httpStatus: number | undefined = err?.httpStatus ?? err?.response?.status;
  const body = err?.response?.data ?? err;
  const blockers = body?.data?.blockers;
  const url = err?.config?.url ?? err?.response?.config?.url;
  const onLink = opts?.linkEndpoint ?? isLinkEndpointUrl(url);

  let kind: FundingErrorKind = (httpStatus && KIND_BY_STATUS[httpStatus]) || 'unknown';
  // ⚠️ The ONE 409 a refresh cannot fix. Must be decided here rather than at the
  // call sites, or the generic `stale` handling refetches and reports it as an
  // informational "Funding updated" — which reads as success.
  if (kind === 'stale' && onLink) kind = 'setupRequired';

  return {
    kind,
    message: body?.message || err?.message || 'Something went wrong',
    httpStatus,
    ...(Array.isArray(blockers) ? { blockers } : {}),
  };
}

/**
 * Does this failure mean the app's copy of the record is stale?
 *
 * `stale` (409) always does. `notFound` on a PAYMENT does too — the row was
 * removed or re-keyed elsewhere — so both should trigger a re-`GET`.
 *
 * ⚠️ `setupRequired` deliberately does NOT: the record is perfectly current, the
 * company's Stripe account is not usable, and re-reading returns the same answer.
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
  submit: (leadId: string) => `${base(leadId)}/submit`,
  result: (leadId: string) => `${base(leadId)}/result`,
} as const;

/** Every funding call carries the company header. */
const cfg = (companyId?: string) => (companyId ? { headers: { companyid: companyId } } : undefined);

export const FundingService = {
  /**
   * The whole record. Safe to call on first open — with nothing saved yet the
   * server answers with a synthetic empty record (no `_id`) rather than a 404.
   */
  getFunding: (leadId: string, companyId?: string): Promise<FundingResponse> =>
    api.get(FundingEndpoints.record(leadId), cfg(companyId)),

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
    payload: { contractPrice: number; payments: FundingUpsertRow[] },
    companyId?: string
  ): Promise<FundingResponse> => api.put(FundingEndpoints.record(leadId), payload, cfg(companyId)),

  /** One row. ⚠️ Returns `data.payment`, not `data.funding`. */
  getPayment: (
    leadId: string,
    pid: string,
    companyId?: string
  ): Promise<AxiosResponse<FundingEnvelope<{ payment: FundingPaymentRow }>>> =>
    api.get(FundingEndpoints.payment(leadId, pid), cfg(companyId)),

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
    companyId?: string
  ): Promise<AxiosResponse<FundingEnvelope<{ url: string; funding: FundingRecord }>>> =>
    api.post(FundingEndpoints.link(leadId, pid), undefined, cfg(companyId)),

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
    companyId?: string
  ): Promise<FundingResponse> =>
    api.post(
      FundingEndpoints.linkSent(leadId, pid),
      // The spec is explicit that QR must omit `destination`, not send it empty.
      body.channel === 'qr' ? { channel: 'qr' } : { channel: body.channel, destination: body.destination },
      cfg(companyId)
    ),

  /**
   * The processor's confirmation that the homeowner saved their card → step 2.
   * **Does not charge.**
   *
   * The spec says to prefer `sync` in normal operation; this exists for a webhook
   * or an explicit out-of-band confirmation.
   */
  markCardOnFile: (leadId: string, pid: string, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.cardOnFile(leadId, pid), { cardOnFile: true }, cfg(companyId)),

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
    companyId?: string
  ): Promise<FundingResponse> =>
    api.post(
      FundingEndpoints.decision(leadId, pid),
      body.decision === 'short' ? body : { decision: body.decision },
      cfg(companyId)
    ),

  /**
   * Ask the processor or lender what happened — **the main mechanism** for
   * advancing card and financing rows. Never moves money.
   *
   * The 200 `message` says what landed: `No change yet`, `Card confirmed on file`,
   * `Lender approved in full` / `…part of the request` / `Lender declined`.
   */
  syncPayment: (leadId: string, pid: string, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.sync(leadId, pid), undefined, cfg(companyId)),

  /**
   * Activate an approved loan → `activated: true`, step 3.
   *
   * `409` when there is no decision yet, when the loan was declined, or when a
   * short approval's shortfall is still unassigned (cover it with `savePayments`).
   */
  activateLoan: (leadId: string, pid: string, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.activate(leadId, pid), undefined, cfg(companyId)),

  /**
   * Charge a card that is on file. ⚠️ **This moves real money.**
   *
   * Down-payment cards only — a balance card is charged by the processor after
   * install. `200 Card already charged` is idempotent success. On `402` the row is
   * NOT marked charged and nothing moved, so a retry is a genuine new attempt.
   */
  chargeCard: (leadId: string, pid: string, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.charge(leadId, pid), undefined, cfg(companyId)),

  /**
   * Mark a down-payment check physically taken → `collected: true`, step 1.
   * The only step in the system with no third-party verification.
   */
  markCheckCollected: (leadId: string, pid: string, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.checkCollected(leadId, pid), undefined, cfg(companyId)),

  /**
   * Submit the funding.
   *
   * `200 Funding already submitted` is idempotent success. A block is `409`
   * carrying `data.blockers` — pre-formatted, itemised and ordered, to be
   * **rendered verbatim** so the rep sees what is missing rather than a generic
   * "not ready". A `bankDecline` result submits immediately with no blocker check.
   */
  submitFunding: (leadId: string, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.submit(leadId), undefined, cfg(companyId)),

  /**
   * Set the job outcome. Also updates the lead's status, upserts `LeadOutcome`
   * and emits a lead-change socket event.
   *
   * ⚠️ **Bank Decline is a lender's verdict, not a rep's opinion** — it requires a
   * `Declined` entry in `attemptHistory`, so the app must not offer it until one
   * exists, and it cannot be undone once the funding is submitted.
   */
  setResult: (leadId: string, result: FundingResult, companyId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.result(leadId), { result }, cfg(companyId)),
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
