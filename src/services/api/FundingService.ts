import { AxiosResponse } from 'axios';
import api from './index';
import {
  LEAD_NOT_SYNCED,
  LEAD_NOT_SYNCED_MESSAGE,
  isLeadNotSyncedError,
  isSyncedLeadId,
  leadNotSyncedError,
} from '../../utils/lead-sync-state';

export interface FundingEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export type FundingKind = 'down' | 'bal';
export type FundingMethodType = 'check' | 'cc' | 'bank';
export type FundingDecision = 'full' | 'short' | 'declined';
export type FundingChannel = 'qr' | 'text' | 'email';
export type FundingResult = 'sale' | 'bankDecline';
export type FundingRecordStatus = 'pending' | 'submitted';

export type FundingApplicationClosed = 'abandoned' | 'canceled' | 'expired' | 'error';

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

export interface FundingRefund {
  rid: string;
  amount: number;
  netAmount?: number | null;
  feeBorne?: 'company' | 'customer' | null;
  method: FundingRefundMethod;
  reason: FundingRefundReason;
  note?: string | null;
  state: FundingRefundState;
  requestedBy?: string | null;
  approvalId?: string | null;
  draftId?: string | null;
  providerRef?: string | null;
  receipt?: string | null;
  events?: FundingRowEvent[];
  at?: string | null;
}

export type ApprovalState = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface FundingApprovalReminder {
  canRemind: boolean;
  waitingHours?: number;
  waitingDays?: number;
  remindersSent?: number;
  lastRemindedAt?: string | null;
  nextRemindAt?: string | null;
  blockedReason?: string | null;
}

export interface ApprovalRecord {
  _id?: string;
  id?: string;
  leadId?: string;
  state: ApprovalState;
  type?: 'refund' | string;
  requestedBy?: { userId?: string; id?: string; name?: string; role?: string } | string | null;
  assignedToUserId?: string | null;
  assignedTo?: { id?: string; name?: string } | null;
  eligibleRoles?: { id: string; name: string }[];
  note?: string | null;
  decidedAt?: string | null;
  subject?: { kind?: string; paymentId?: string; refundId?: string } | null;
  eligibleRoleIds?: string[];
  decision?: { outcome?: string; at?: string; by?: any; note?: string } | null;
  history?: { action?: string; at?: string; by?: any; toUserId?: string | null; note?: string | null }[];
  refund?: { rid?: string; amount?: number; method?: string; reason?: string } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  reminder?: FundingApprovalReminder | null;
}

export interface ApproverFeed {
  approvers: { id: string; name: string; email?: string; roleId?: string; roleName?: string }[];
  roles: { id: string; name: string }[];
  isConfigured: boolean;
  allowSelfApproval: boolean;
}

export interface FundingPaymentRow {
  pid: string;
  kind: FundingKind;
  method: string;
  type: FundingMethodType;
  amount: number;

  step: number;
  linkSent: boolean;
  sentChannel: FundingChannel | null;
  sentTo: string | null;
  sentAt?: string | null;

  decision: FundingDecision | null;
  requested: number | null;
  approvedAmt: number | null;
  activated: boolean;
  charged: boolean;
  collected: boolean;

  applicationClosed?: FundingApplicationClosed | null;
  applicationClosedAt?: string | null;

  syncedAt?: string | null;
  lockedAt?: string | null;

  baseline?: number | null;
  liveUsage?: number | null;
  drifted?: boolean;

  refunds?: FundingRefund[];

  approvedCeiling?: number | null;
  chargeAttempts?: number;
  collectedBy?: { userId?: string; name?: string; role?: string } | null;
  lastDecline?: FundingDecline | null;

  archived?: FundingArchivedPlan[];

  events?: FundingRowEvent[];

  providerState?: { cardBrand?: string; cardLast4?: string; [k: string]: unknown } | null;
}

export interface FundingArchivedPlan {
  archivedId: string;
  method: string;
  type?: FundingMethodType;
  amount?: number;
  decision?: FundingDecision | null;
  approvedAmt?: number | null;
  archivedAt?: string;
  linkSent?: boolean;
  activated?: boolean;
  /** REVUIUX-536: money moved on this plan. Such an entry is reference-only and can never be restored. */
  charged?: boolean;
  collected?: boolean;
  refundedAmount?: number | null;
  [k: string]: unknown;
}

export interface FundingDecline {
  declineCode?: string;
  action?: 'retry' | 'new_card' | 'recapture_card' | 'contact_issuer';
  retryable?: boolean;
  message?: string;
  providerMessage?: string;
  at?: string;
}

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

export interface PaymentAllocation {
  method: string;
  amount: number;
  label?: string;
  type?: FundingMethodType;
}

export interface FundingAttempt {
  pid: string;
  method: string;
  requested: number;
  approved: number;
  outcome: 'Full' | 'Partial' | 'Declined';
  at: string;
}

export interface FundingRecord {
  _id?: string;
  leadId: string;
  companyId?: string;
  contractPrice: number;
  contractPriceUnlocked?: boolean;
  payMode?: 'split' | 'upfront';
  /** Calculator this lead's funding is attached to; null = unclaimed. Server-owned. */
  calculatorId?: string | null;
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

export interface FundingUpsertRow {
  pid: string;
  kind: FundingKind;
  method: string;
  type?: FundingMethodType;
  amount: number;
}

type FundingResponse = AxiosResponse<FundingEnvelope<{ funding: FundingRecord }>>;

export interface FundingSyncAllResult {
  funding: FundingRecord;
  polled?: number;
  changed?: number;
  problems?: string[];
}

type FundingSyncAllResponse = AxiosResponse<FundingEnvelope<FundingSyncAllResult>>;

export interface DownPaymentLimit {
  maxPercentage?: number;
  states?: Record<string, number>;
  [k: string]: unknown;
}

export function newPaymentId(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}`;
}

export function toWholeDollars(value: number | string): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export type FundingErrorKind =
  | 'bug'
  | 'rule'
  | 'stale'
  | 'setupRequired'
  | 'approversMissing'
  | 'remindTooSoon'
  | 'cardDeclined'
  | 'notFound'
  | 'delivery'
  | 'noProvider'
  | 'settledOnOtherCalculator'
  | 'scopeNeedsDecision'
  | 'scopeNeedsRefundApproval'
  | 'scopeRefundFirst'
  | 'scopeAfterSubmit'
  | 'rowSettled'
  | 'rowRefundInFlight'
  | 'rowHasDecision'
  | 'rowApplicationSent'
  | 'rowHoldsPlans'
  | 'offline'
  | 'leadNotSynced'   // ← new: the lead has not uploaded yet; nothing was sent
  | 'unknown';

export interface FundingError {
  kind: FundingErrorKind;
  message: string;
  httpStatus?: number;
  /** Machine code from `data.code` (e.g. FUNDING_SETTLED_ON_OTHER_CALCULATOR). */
  code?: string;
  /** REVUIUX-519 scope-switch refusals: what is still held (net of refunds) and what the new contract cannot hold. */
  settledAmount?: number;
  overage?: number;
  blockers?: string[];
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

export const FUNDING_SETTLED_ON_OTHER_CALCULATOR = 'FUNDING_SETTLED_ON_OTHER_CALCULATOR';
export const FUNDING_SCOPE_SWITCH_NEEDS_DECISION = 'FUNDING_SCOPE_SWITCH_NEEDS_DECISION';
export const FUNDING_SCOPE_SWITCH_NEEDS_REFUND_APPROVAL = 'FUNDING_SCOPE_SWITCH_NEEDS_REFUND_APPROVAL';
export const FUNDING_SCOPE_SWITCH_REFUND_FIRST = 'FUNDING_SCOPE_SWITCH_REFUND_FIRST';

// REVUIUX-519 add. 2: the job builder is submitted, so a scope change is an addendum — not a prompt, not retryable.
export const FUNDING_SCOPE_SWITCH_AFTER_SUBMIT = 'FUNDING_SCOPE_SWITCH_AFTER_SUBMIT';
// REVUIUX-519 add. 3 / 536 §6: refusals to DROP a row by omission. Each carries its own sentence in `message`.
export const FUNDING_ROW_SETTLED = 'FUNDING_ROW_SETTLED';
export const FUNDING_ROW_REFUND_IN_FLIGHT = 'FUNDING_ROW_REFUND_IN_FLIGHT';
export const FUNDING_ROW_HAS_DECISION = 'FUNDING_ROW_HAS_DECISION';
export const FUNDING_ROW_APPLICATION_SENT = 'FUNDING_ROW_APPLICATION_SENT';
export const FUNDING_ROW_HOLDS_PLANS = 'FUNDING_ROW_HOLDS_PLANS';

const KIND_BY_CODE: Record<string, FundingErrorKind> = {
  [FUNDING_SETTLED_ON_OTHER_CALCULATOR]: 'settledOnOtherCalculator',
  [FUNDING_SCOPE_SWITCH_NEEDS_DECISION]: 'scopeNeedsDecision',
  [FUNDING_SCOPE_SWITCH_NEEDS_REFUND_APPROVAL]: 'scopeNeedsRefundApproval',
  [FUNDING_SCOPE_SWITCH_REFUND_FIRST]: 'scopeRefundFirst',
  [FUNDING_SCOPE_SWITCH_AFTER_SUBMIT]: 'scopeAfterSubmit',
  [FUNDING_ROW_SETTLED]: 'rowSettled',
  [FUNDING_ROW_REFUND_IN_FLIGHT]: 'rowRefundInFlight',
  [FUNDING_ROW_HAS_DECISION]: 'rowHasDecision',
  [FUNDING_ROW_APPLICATION_SENT]: 'rowApplicationSent',
  [FUNDING_ROW_HOLDS_PLANS]: 'rowHoldsPlans',
};

export type SettledAction = 'reuse' | 'refund' | 'reuseWithRefund';

export function isLinkEndpointUrl(url?: string | null): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  return /\/link(-sent)?$/.test(path);
}

export function isRefundRequestUrl(url?: string | null): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  return /\/refund$/.test(path);
}

export function isRemindEndpointUrl(url?: string | null): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  return /\/remind$/.test(path);
}

export function classifyFundingError(
  err: any,
  opts?: { linkEndpoint?: boolean; refundRequest?: boolean; remind?: boolean }
): FundingError {
  // Raised by `leadPath` before any request. Must be first: there is no httpStatus to read,
  // and 400 → 'bug' would print Mongo wording to a rep.
  if (isLeadNotSyncedError(err)) {
    return {
      kind: 'leadNotSynced',
      message: (err as any)?.message || LEAD_NOT_SYNCED_MESSAGE,
      code: LEAD_NOT_SYNCED,
    };
  }

  const httpStatus: number | undefined = err?.httpStatus ?? err?.response?.status;
  const body = err?.response?.data ?? err;
  const blockers = body?.data?.blockers;
  const url = err?.config?.url ?? err?.response?.config?.url;
  const onLink = opts?.linkEndpoint ?? isLinkEndpointUrl(url);
  const onRefund = opts?.refundRequest ?? isRefundRequestUrl(url);
  const onRemind = opts?.remind ?? isRemindEndpointUrl(url);

  let kind: FundingErrorKind = (httpStatus && KIND_BY_STATUS[httpStatus]) || 'unknown';
  if (kind === 'stale' && onLink) kind = 'setupRequired';
  else if (kind === 'stale' && onRefund) kind = 'approversMissing';
  else if (kind === 'stale' && onRemind) kind = 'remindTooSoon';

  const reminder = body?.reminder ?? body?.data?.reminder;
  const code: string | undefined = typeof body?.data?.code === 'string' ? body.data.code : undefined;
  // Match on `data.code`, never the message. A refused re-scope is not a stale record: no refetch/retry.
  if (code && KIND_BY_CODE[code]) kind = KIND_BY_CODE[code];
  const settledAmount = Number(body?.data?.settledAmount);
  const overage = Number(body?.data?.overage);

  return {
    kind,
    message: body?.message || err?.message || 'Something went wrong',
    httpStatus,
    ...(code ? { code } : {}),
    ...(Number.isFinite(settledAmount) ? { settledAmount } : {}),
    ...(Number.isFinite(overage) && overage > 0 ? { overage } : {}),
    ...(Array.isArray(blockers) ? { blockers } : {}),
    ...(reminder && typeof reminder === 'object' ? { reminder: reminder as FundingApprovalReminder } : {}),
  };
}

export function shouldRefetchAfter(error: FundingError): boolean {
  return error.kind === 'stale' || error.kind === 'notFound';
}

/**
 * ⚠️ The containment layer for the counterfeit-id trap (P4). Every funding URL is built from
 * here, so one check covers all 20 endpoints: a client id can never leave the device as a
 * lead-scoped request, however a call site is gated.
 *
 * Throws SYNCHRONOUSLY, inside the service method. Every current caller is inside a
 * `try`/`await` (`useFunding`'s `run`/`load`/`refetch`/`refreshPayment`/`submit`), so it is
 * caught exactly like a rejection. A future caller using a bare `.catch()` with no `try`
 * must await it.
 */
const leadPath = (leadId: string): string => {
  if (!isSyncedLeadId(leadId)) throw leadNotSyncedError(String(leadId));
  return encodeURIComponent(leadId);
};

const base = (leadId: string) => `/lead/v1/${leadPath(leadId)}/funding`;
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
  reactivate: (leadId: string, pid: string) => `${row(leadId, pid)}/reactivate`,
  restore: (leadId: string, pid: string) => `${row(leadId, pid)}/restore`,
  syncAll: (leadId: string) => `${base(leadId)}/sync-all`,
  submit: (leadId: string) => `${base(leadId)}/submit`,
  result: (leadId: string) => `${base(leadId)}/result`,
  refund: (leadId: string, pid: string) => `${row(leadId, pid)}/refund`,
} as const;

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

export const DOWN_PAYMENT_LIMIT_ENDPOINT = '/company/v1/down-payment-limit/sales';

const cfg = (companyId?: string, userId?: string) => {
  const headers: Record<string, string> = {};
  if (companyId) headers.companyid = companyId;
  if (userId) headers.userId = userId;
  return Object.keys(headers).length ? { headers } : undefined;
};

export const FundingService = {
  getFunding: (leadId: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.get(FundingEndpoints.record(leadId), cfg(companyId, userId)),

  savePayments: (
    leadId: string,
    payload: {
      contractPrice: number;
      payments: FundingUpsertRow[];
      payMode?: 'split' | 'upfront';
      calculatorId?: string;
      settledAction?: SettledAction;
    },
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> => api.put(FundingEndpoints.record(leadId), payload, cfg(companyId, userId)),

  getPayment: (
    leadId: string,
    pid: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<FundingEnvelope<{ payment: FundingPaymentRow }>>> =>
    api.get(FundingEndpoints.payment(leadId, pid), cfg(companyId, userId)),

  getLink: (
    leadId: string,
    pid: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<FundingEnvelope<{ url: string; funding: FundingRecord }>>> =>
    api.post(FundingEndpoints.link(leadId, pid), undefined, cfg(companyId, userId)),

  markLinkSent: (
    leadId: string,
    pid: string,
    body: { channel: FundingChannel; destination?: string },
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> =>
    api.post(
      FundingEndpoints.linkSent(leadId, pid),
      body.channel === 'qr' ? { channel: 'qr' } : { channel: body.channel, destination: body.destination },
      cfg(companyId, userId)
    ),

  markCardOnFile: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.cardOnFile(leadId, pid), { cardOnFile: true }, cfg(companyId, userId)),

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

  syncPayment: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.sync(leadId, pid), undefined, cfg(companyId, userId)),

  syncAll: (leadId: string, companyId?: string, userId?: string): Promise<FundingSyncAllResponse> =>
    api.post(FundingEndpoints.syncAll(leadId), undefined, cfg(companyId, userId)),

  activateLoan: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.activate(leadId, pid), undefined, cfg(companyId, userId)),

  reactivateLoan: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.reactivate(leadId, pid), undefined, cfg(companyId, userId)),

  restoreArchivedPlan: (
    leadId: string,
    pid: string,
    archivedId: string,
    companyId?: string,
    userId?: string
  ): Promise<FundingResponse> =>
    api.post(FundingEndpoints.restore(leadId, pid), { archivedId }, cfg(companyId, userId)),

  chargeCard: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.charge(leadId, pid), undefined, cfg(companyId, userId)),

  markCheckCollected: (leadId: string, pid: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.checkCollected(leadId, pid), undefined, cfg(companyId, userId)),

  submitFunding: (leadId: string, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.submit(leadId), undefined, cfg(companyId, userId)),

  setResult: (leadId: string, result: FundingResult, companyId?: string, userId?: string): Promise<FundingResponse> =>
    api.post(FundingEndpoints.result(leadId), { result }, cfg(companyId, userId)),

  getDownPaymentLimit: (
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<FundingEnvelope<DownPaymentLimit>>> =>
    api.get(DOWN_PAYMENT_LIMIT_ENDPOINT, cfg(companyId, userId)),

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

export const ApprovalService = {
  approvers: (type = 'refund', companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.get(`${ApprovalEndpoints.approvers}?type=${encodeURIComponent(type)}`, cfg(companyId, userId)),

  forLead: (leadId: string, companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.get(ApprovalEndpoints.forLead(leadId), cfg(companyId, userId)),

  mine: (companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.get(ApprovalEndpoints.mine, cfg(companyId, userId)),

  decide: (
    approvalId: string,
    body: { decision: 'approved' | 'declined'; note?: string },
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<any>> =>
    api.post(ApprovalEndpoints.decide(approvalId), body, cfg(companyId, userId)),

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

  resend: (approvalId: string, companyId?: string, userId?: string): Promise<AxiosResponse<any>> =>
    api.post(ApprovalEndpoints.resend(approvalId), {}, cfg(companyId, userId)),

  remind: (
    approvalId: string,
    note?: string,
    companyId?: string,
    userId?: string
  ): Promise<AxiosResponse<any>> =>
    api.post(ApprovalEndpoints.remind(approvalId), note ? { note } : {}, cfg(companyId, userId)),
};

export default FundingService;
