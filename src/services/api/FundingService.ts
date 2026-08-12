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

  syncedAt?: string | null;
  /** Set once a lender decision lands; the row's amount/method/kind then freeze. */
  lockedAt?: string | null;
  /** Opaque provider bag — do not read or display. */
  providerState?: unknown;
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
  /** 402 — the processor declined the card. Nothing was collected. */
  | 'cardDeclined'
  /** 404 — lead or payment not found (or the mock provider is disabled). */
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

/** Normalize any funding rejection into `{ kind, message, blockers }`. */
export function classifyFundingError(err: any): FundingError {
  const httpStatus: number | undefined = err?.httpStatus ?? err?.response?.status;
  const body = err?.response?.data ?? err;
  const blockers = body?.data?.blockers;
  return {
    kind: (httpStatus && KIND_BY_STATUS[httpStatus]) || 'unknown',
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
  mockProvider: (leadId: string, pid: string) => `${row(leadId, pid)}/mock-provider`,
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

  /**
   * TEST ONLY — stand in for the homeowner or the lender.
   *
   * Returns `404 Mock provider actions are disabled` unless the server runs with
   * `FUNDING_PROVIDER=mock`. It only RECORDS what the third party did; the rep
   * still has to `sync` for it to land, which keeps the production code path under
   * test. Cards take `cardOnFile`; loans take `full` / `short` (+`approvedAmt`) /
   * `declined`.
   */
  mockProvider: (
    leadId: string,
    pid: string,
    body: { action: 'cardOnFile' | FundingDecision; approvedAmt?: number },
    companyId?: string
  ): Promise<FundingResponse> =>
    api.post(
      FundingEndpoints.mockProvider(leadId, pid),
      body.action === 'short' ? body : { action: body.action },
      cfg(companyId)
    ),
};

export default FundingService;
