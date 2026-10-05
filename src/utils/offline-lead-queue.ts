/**
 * offline-lead-queue.ts — the rules for replaying a lead CREATE that was made with no signal.
 *
 * The hard problem an offline write queue has is not storing the work, it is deciding what to do
 * when a replay's outcome is UNKNOWN. A request that times out mid-flight may have been received
 * and processed, or may never have arrived, and the client cannot tell which. Both answers are
 * wrong in a different direction:
 *
 * - retry     -> the lead may be filed TWICE
 * - don't     -> the rep's work may be silently LOST
 *
 * The usual escape is an `Idempotency-Key` header, which this backend does not offer yet
 * (`OFFLINE-BACKEND-ALIGNMENT.md`, blocker 1). ⚠️ But it turns out we do not need one for every
 * lead, because the backend ALREADY enforces a unique key on one of them:
 *
 * > "we can't create the lead with the same lead id, but we can create the lead with the same
 * >  number and lead code and first name, last name as well."
 *
 * That single fact splits the problem cleanly, and the whole file is built on it:
 *
 * | lead type | unique key on the server | replay of an unknown outcome |
 * |---|---|---|
 * | **Issued** (`lfLead`) | **`lfLeadId`** — rep-entered, server-rejected if taken | **safe** — a second copy is refused by the server, and that refusal PROVES the first one landed |
 * | **Self-gen** | none (phone, name and lead code may all repeat) | **not safe** — a replay files a real duplicate |
 *
 * So an Issued Lead gets a true idempotent retry today, using the server's own index as the key.
 * A self-gen lead does not, and is parked for the rep rather than guessed at.
 *
 * ⚠️ The corollary is the rule that is easiest to get backwards: on a replay, a
 * "lead id already exists" rejection is a **SUCCESS**, not a failure. It is the server telling us
 * the work is already done. Reporting it as an error would leave the rep re-entering a lead that
 * is already on their list.
 *
 * Pure and RN-free (no MMKV, no axios) so every rule here is testable; `services/offlineLeadQueue`
 * is the storage and the drain.
 */

import { isNetworkError, isTimeoutError } from './network-error';

// ─── The queued item ───────────────────────────────────────────────────────────

export type QueuedLeadStatus =
  /** Waiting for a connection. The normal state. */
  | 'pending'
  /** A replay is in flight right now. */
  | 'sending'
  /** Filed on the server. Kept briefly so the rep sees it land, then swept. */
  | 'synced'
  /** The server refused it for a reason a retry cannot fix — bad data. The rep must act. */
  | 'failed'
  /** ⚠️ Outcome UNKNOWN and not safe to replay. The rep must confirm. See `needs-review` below. */
  | 'needs-review';

export interface QueuedLead {
  /** Client-generated id. Also the handle every later write would hang off. */
  clientId: string;
  /** Exactly the body `LeadService.createLead` would have posted. */
  payload: Record<string, unknown>;
  /** `selfGen` | `lfLead` — decides whether a replay is safe. */
  leadType: string;
  /** For the pending list, so a rep can see WHICH lead is waiting without opening it. */
  label: string;
  createdAt: string;
  attempts: number;
  status: QueuedLeadStatus;
  /** Human-readable, shown on a `failed` / `needs-review` row. */
  lastError?: string;
  /** The server's `_id` once it lands — the clientId -> serverId mapping. */
  serverId?: string;
}

/**
 * ⚠️ Bounded so a permanently-rejected lead cannot retry forever on every reconnect. Reaching it
 * moves the item to `needs-review`, never to silent deletion — the rep's work is never discarded
 * by a counter.
 */
export const MAX_CREATE_ATTEMPTS = 5;

// ─── Identity ──────────────────────────────────────────────────────────────────

/**
 * A client-side id, in the shape `uploadQueue` already uses (this repo has no uuid dependency and
 * one is not worth adding for this).
 *
 * ⚠️ It is generated ONCE, when the lead is queued, and never regenerated on a retry — it is what
 * makes two replays of one lead recognisable as the same lead, and it is the `clientId` the
 * backend is being asked to echo back (`OFFLINE-BACKEND-ALIGNMENT.md`, blocker 2).
 */
export const newLeadClientId = (): string =>
  `lead-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

/** How the pending row names the lead: the customer, else the address, else the client id. */
export const describeQueuedLead = (payload: Record<string, any> | null | undefined): string => {
  const c = payload?.customer || {};
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  if (name) return name;
  const address = typeof payload?.fullAddress === 'string' ? payload.fullAddress.trim() : '';
  return address || 'New lead';
};

// ─── The key fact: does the SERVER hold a unique index for this lead? ───────────

/**
 * True when the lead carries the one field the backend refuses to duplicate.
 *
 * ⚠️ This is the whole safety argument for auto-retry, so it is deliberately narrow: it requires a
 * non-blank `lfLeadId` on an `lfLead`, and nothing else counts. Phone, `leadCode` and the customer
 * name are all explicitly duplicable per the report above, so treating any of them as an identity
 * would let a genuine second lead be swallowed as "already landed" — losing a sale, which is worse
 * than the duplicate this is trying to prevent.
 */
export const hasServerUniqueKey = (payload: Record<string, any> | null | undefined): boolean => {
  if (!payload) return false;
  if (payload.leadType !== 'lfLead') return false;
  return typeof payload.lfLeadId === 'string' && payload.lfLeadId.trim().length > 0;
};

// ─── Classifying what came back ────────────────────────────────────────────────

export type CreateOutcome =
  /** No connection was established. The request PROVABLY never reached the server. */
  | 'never-sent'
  /** The server refused it because the lead id is taken -> an earlier attempt landed. */
  | 'duplicate'
  /** The server answered and refused it on the merits. A replay changes nothing. */
  | 'rejected'
  /** It may or may not have been processed. This is the case an idempotency key would remove. */
  | 'ambiguous';

/**
 * Matches the server's "this lead id is taken" refusal.
 *
 * ⚠️ Matched on the MESSAGE because the exact contract is not pinned down — this backend answers
 * some failures with a 200 carrying `{ message }` (web's own create reads `response.data.message`
 * on the non-success branch) and others with a 4xx. Both shapes are fed through here.
 *
 * ⚠️ It requires the message to name the LEAD ID specifically, or to be a Mongo duplicate-key
 * error. A bare "duplicate" is not enough: the caller only ever acts on this for a lead that
 * carries `lfLeadId`, but a message naming some other field must not be read as our key.
 */
const DUPLICATE_LEAD_ID_RE =
  /(lead\s*_?id|lfleadid|lf\s*lead\s*id)[^.]{0,40}(already|exist|taken|duplicat|in use)|(already|exist|taken|duplicat)[^.]{0,40}(lead\s*_?id|lfleadid)|e11000/i;

export const isDuplicateLeadIdMessage = (message: unknown): boolean =>
  typeof message === 'string' && DUPLICATE_LEAD_ID_RE.test(message);

/** Pull whatever the API layer put the server's wording in. */
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

/**
 * What actually happened to a create attempt.
 *
 * ⚠️ The split between `never-sent` and `ambiguous` is the most important line in this file, and
 * `isNetworkError` alone does NOT draw it — its own docs list "a timeout" alongside airplane mode.
 * A timeout means the connection existed and the server may well have processed the write, so it
 * is checked FIRST and classified as ambiguous. Only a failure with no connection at all —
 * airplane mode, DNS failure, refused socket — is provably never-sent.
 */
export const classifyCreateOutcome = (err: any): CreateOutcome => {
  const message = messageOfError(err);
  const status = statusOfError(err);

  // A duplicate answer is definitive whatever it arrived as (200-with-message or 4xx).
  if (isDuplicateLeadIdMessage(message)) return 'duplicate';

  if (status === undefined) {
    // Nothing came back. A timeout is the ambiguous half of that.
    if (isTimeoutError(err)) return 'ambiguous';
    if (isNetworkError(err)) return 'never-sent';
    return 'ambiguous';
  }

  // 5xx: the server received it and failed part-way. It may have written the lead first.
  if (status >= 500) return 'ambiguous';
  // 408 / 429 are the server asking us to come back; nothing was committed.
  if (status === 408 || status === 429) return 'never-sent';
  // Any other 4xx is a decision about the data itself.
  if (status >= 400) return 'rejected';

  return 'ambiguous';
};

// ─── What to do about it ───────────────────────────────────────────────────────

export type RetryDecision =
  /** Send it again. Either provably safe, or made safe by the server's unique key. */
  | 'retry'
  /** It is on the server. Mark it synced. */
  | 'done'
  /** The server refused the data. Surface it; a replay cannot help. */
  | 'failed'
  /** We cannot tell, and cannot safely guess. Ask the rep. */
  | 'needs-review';

/**
 * The decision table. Read the `ambiguous` row first — it is the one the backend blocker is about,
 * and the one the Issued-Lead unique key rescues.
 *
 * | outcome | Issued Lead (has `lfLeadId`) | Self-gen (no unique key) |
 * |---|---|---|
 * | `never-sent` | retry | **retry** — provably nothing was written |
 * | `duplicate` | **done** — the refusal proves it landed | needs-review |
 * | `rejected` | failed | failed |
 * | `ambiguous` | **retry** — a twin would be refused, so a replay cannot duplicate | **needs-review** |
 *
 * ⚠️ The two cells that carry the whole design are the `ambiguous` ones. An Issued Lead may be
 * replayed blindly because the server will not accept a second copy — that is idempotency, borrowed
 * from an index that already exists. A self-gen lead has no such protection, so it is parked and
 * the rep is told, rather than the app choosing between duplicating a sale and losing one.
 *
 * ⚠️ `duplicate` on a SELF-GEN lead is `needs-review`, not `done`. Without `lfLeadId` there is no
 * field the server would refuse for uniqueness, so such a message is about something we do not
 * understand — and reading it as "already landed" would discard a lead that was never filed.
 */
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

/** Apply a decision to the item, including the attempt cap. */
export const applyDecision = (item: QueuedLead, decision: RetryDecision, error?: string): QueuedLead => {
  const attempts = item.attempts + 1;
  if (decision === 'done') return { ...item, attempts, status: 'synced', lastError: undefined };
  if (decision === 'failed') return { ...item, attempts, status: 'failed', lastError: error };
  if (decision === 'needs-review') return { ...item, attempts, status: 'needs-review', lastError: error };
  // retry — but never forever.
  if (attempts >= MAX_CREATE_ATTEMPTS) {
    return { ...item, attempts, status: 'needs-review', lastError: error };
  }
  return { ...item, attempts, status: 'pending', lastError: error };
};

// ─── Reading a create RESPONSE (the success path is not always a success) ──────

/** The server `_id` of a lead that was just created, out of whatever wrapper it arrived in. */
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

/**
 * ⚠️ This endpoint can answer 200 with a FAILURE body — web's own create branches on
 * `response.data.status` / `success` and shows `response.data.message` as an error. So a resolved
 * promise is not proof the lead was filed, and the drain must run every response through here
 * rather than assuming 2xx means done.
 */
export const isSuccessfulCreate = (body: any): boolean => {
  if (!body || typeof body !== 'object') return false;
  if (body.success === false || body.status === false) return false;
  if (typeof body.status === 'number' && body.status >= 400) return false;
  if (typeof body.code === 'number' && body.code >= 400) return false;
  // A body carrying a duplicate-lead-id message is a refusal however it is dressed.
  if (isDuplicateLeadIdMessage(body.message)) return false;
  return true;
};

/** Only rows the rep still has to care about; `synced` is history. */
export const activeQueuedLeads = (items: QueuedLead[] | null | undefined): QueuedLead[] =>
  (items || []).filter((i) => i && i.status !== 'synced');

/** Rows the drain may pick up. */
export const drainableLeads = (items: QueuedLead[] | null | undefined): QueuedLead[] =>
  (items || []).filter((i) => i && i.status === 'pending');
