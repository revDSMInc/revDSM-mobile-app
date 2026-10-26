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
  | 'ambiguous'
  // The session expired. Says nothing about the work itself, so it is neither a failure nor a retry.
  | 'unauthorized';

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

  if (status === 401) return 'unauthorized';
  if (status >= 500) return 'ambiguous';
  if (status === 408 || status === 429) return 'never-sent';
  /**
   * ⚠️ 409 IS NOT A REJECTION. It fell into the `status >= 400` bucket below and came out
   * `rejected`, which `resolveStepDecision` turns into `failed` - a DEAD END on the very first
   * attempt, with no guarded retry and no chance to adopt what is already there.
   *
   * A conflict means the server is holding a record that collides with ours: usually the one we
   * ourselves created on an earlier, half-finished drain. That is recoverable - look it up and
   * claim it - which is exactly what a guarded retry is for, and what the `appointment` and
   * `calculator` steps now do.
   *
   * Reported as: offline deal syncs, rep is told "Couldn't be uploaded", and the calculator
   * turns out to be on the server already. Never seen online, because online each create goes
   * out alone against a server that already knows about the previous ones.
   *
   * ⚠️ A step whose `stepReplaySafety` is `manual` still lands in `needs-review` - this only
   * changes WHICH door a conflict goes through, not whether a human can be bypassed.
   */
  if (status === 409) return 'duplicate';
  if (status >= 400) return 'rejected';

  return 'ambiguous';
};

export type RetryDecision =
  | 'retry'
  | 'done'
  | 'failed'
  | 'needs-review';

/**
 * ⚠️ `serverHonoursIdempotencyKey` is true now that `POST lead/v1/create` deduplicates on our
 * key (deployed 2026-10-16). It is a parameter rather than a constant so the behaviour can be
 * turned off in one place if the server ever stops honouring it.
 *
 * It only changes the AMBIGUOUS case, and only in one direction: toward keeping the rep's
 * work. The form itself sends no key - an online create is not queued, so there is nothing to
 * replay - but the RETRY it hands to the queue does, and that is what makes retrying safe.
 */
export const resolveRetryDecision = (
  outcome: CreateOutcome,
  payload: Record<string, any> | null | undefined,
  serverHonoursIdempotencyKey: boolean = true,
): RetryDecision => {
  const guarded = hasServerUniqueKey(payload) || serverHonoursIdempotencyKey;

  switch (outcome) {
    case 'never-sent':
      return 'retry';
    case 'duplicate':
      // ⚠️ Still `hasServerUniqueKey`, NOT `guarded`. A duplicate rejection only proves the
      // first create landed when the thing it collided on is unique to this lead. The
      // idempotency key says nothing here: the server would have REPLAYED a key it had seen,
      // not rejected it, so a duplicate error on a keyed create is a genuine conflict.
      return hasServerUniqueKey(payload) ? 'done' : 'needs-review';
    case 'rejected':
      return 'failed';
    case 'ambiguous':
      // ⚠️ THE FIX for "I typed a Self Gen lead and it vanished". There is no unique field on
      // a Self Gen, so this used to be `needs-review`, which discarded the rep's typing. The
      // queued retry carries a key, so a replay cannot duplicate - retry and keep the work.
      return guarded ? 'retry' : 'needs-review';
    case 'unauthorized':
      // Online create from the form: the 401 interceptor is already signing the rep out. Do not
      // queue (the form is about to be dismissed under a dead session) and do not call it done.
      return 'failed';
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
