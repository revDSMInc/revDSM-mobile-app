import { isNetworkError, isTimeoutError } from './network-error';

export type QueuedLeadStatus =
  | 'pending'
  | 'sending'
  | 'synced'
  | 'failed'
  | 'needs-review';

export interface QueuedLead {
  clientId: string;
  payload: Record<string, unknown>;
  leadType: string;
  label: string;
  createdAt: string;
  attempts: number;
  status: QueuedLeadStatus;
  lastError?: string;
  serverId?: string;
}

export const MAX_CREATE_ATTEMPTS = 5;

export const newLeadClientId = (): string =>
  `lead-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const describeQueuedLead = (payload: Record<string, any> | null | undefined): string => {
  const c = payload?.customer || {};
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  if (name) return name;
  const address = typeof payload?.fullAddress === 'string' ? payload.fullAddress.trim() : '';
  return address || 'New lead';
};

export const hasServerUniqueKey = (payload: Record<string, any> | null | undefined): boolean => {
  if (!payload) return false;
  if (payload.leadType !== 'lfLead') return false;
  return typeof payload.lfLeadId === 'string' && payload.lfLeadId.trim().length > 0;
};

export type CreateOutcome =
  | 'never-sent'
  | 'duplicate'
  | 'rejected'
  | 'ambiguous';

const DUPLICATE_LEAD_ID_RE =
  /(lead\s*_?id|lfleadid|lf\s*lead\s*id)[^.]{0,40}(already|exist|taken|duplicat|in use)|(already|exist|taken|duplicat)[^.]{0,40}(lead\s*_?id|lfleadid)|e11000/i;

export const isDuplicateLeadIdMessage = (message: unknown): boolean =>
  typeof message === 'string' && DUPLICATE_LEAD_ID_RE.test(message);

export const messageOfError = (err: any): string => {
  const candidates = [
    err?.response?.data?.message,
    err?.data?.message,
    err?.message,
    typeof err?.response?.data === 'string' ? err.response.data : undefined,
  ];
  return candidates.find((m) => typeof m === 'string' && m.trim()) || '';
};

const statusOfError = (err: any): number | undefined => {
  const s = err?.httpStatus ?? err?.response?.status ?? err?.status;
  return typeof s === 'number' ? s : undefined;
};

export const classifyCreateOutcome = (err: any): CreateOutcome => {
  const message = messageOfError(err);
  const status = statusOfError(err);

  if (isDuplicateLeadIdMessage(message)) return 'duplicate';

  if (status === undefined) {
    if (isTimeoutError(err)) return 'ambiguous';
    if (isNetworkError(err)) return 'never-sent';
    return 'ambiguous';
  }

  if (status >= 500) return 'ambiguous';
  if (status === 408 || status === 429) return 'never-sent';
  if (status >= 400) return 'rejected';

  return 'ambiguous';
};

export type RetryDecision =
  | 'retry'
  | 'done'
  | 'failed'
  | 'needs-review';

export const resolveRetryDecision = (
  outcome: CreateOutcome,
  payload: Record<string, any> | null | undefined,
): RetryDecision => {
  const guarded = hasServerUniqueKey(payload);

  switch (outcome) {
    case 'never-sent':
      return 'retry';
    case 'duplicate':
      return guarded ? 'done' : 'needs-review';
    case 'rejected':
      return 'failed';
    case 'ambiguous':
      return guarded ? 'retry' : 'needs-review';
    default:
      return 'needs-review';
  }
};

export const applyDecision = (item: QueuedLead, decision: RetryDecision, error?: string): QueuedLead => {
  const attempts = item.attempts + 1;
  if (decision === 'done') return { ...item, attempts, status: 'synced', lastError: undefined };
  if (decision === 'failed') return { ...item, attempts, status: 'failed', lastError: error };
  if (decision === 'needs-review') return { ...item, attempts, status: 'needs-review', lastError: error };
  if (attempts >= MAX_CREATE_ATTEMPTS) {
    return { ...item, attempts, status: 'needs-review', lastError: error };
  }
  return { ...item, attempts, status: 'pending', lastError: error };
};

export const readCreatedLeadId = (body: any): string | null => {
  const candidates = [
    body?.data?.lead?._id,
    body?.data?._id,
    body?.lead?._id,
    body?._id,
    body?.data?.lead?.id,
    body?.data?.id,
  ];
  const found = candidates.find((v) => typeof v === 'string' && v.trim());
  return found ? String(found) : null;
};

export const isSuccessfulCreate = (body: any): boolean => {
  if (!body || typeof body !== 'object') return false;
  if (body.success === false || body.status === false) return false;
  if (typeof body.status === 'number' && body.status >= 400) return false;
  if (typeof body.code === 'number' && body.code >= 400) return false;
  if (isDuplicateLeadIdMessage(body.message)) return false;
  return true;
};

export const activeQueuedLeads = (items: QueuedLead[] | null | undefined): QueuedLead[] =>
  (items || []).filter((i) => i && i.status !== 'synced');

export const drainableLeads = (items: QueuedLead[] | null | undefined): QueuedLead[] =>
  (items || []).filter((i) => i && i.status === 'pending');
