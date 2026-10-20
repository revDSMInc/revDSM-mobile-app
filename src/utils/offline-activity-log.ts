import { findUnresolvedClientIds } from './offline-lead-work';

export interface QueuedActivityLog {
  id: string;
  eventType: string;
  payload: Record<string, any>;
  meta: Record<string, any>;
  attachLocation: boolean;
  occurredAt: string;
  ownerId: string;
  attempts: number;
}

// Every module is held while offline: an unlisted module used to be dropped silently, which is how
// the funding / result-lead / roofline-deck / investment-center logs went missing. Only a log that
// can never be replayed under a rep's session belongs here.
export const NON_QUEUEABLE_LOG_MODULES: readonly string[] = ['system'];

/**
 * ⚠️ A log that names a lead the SERVER HAS NEVER SEEN must be queued, not sent.
 *
 * Reported: "I created the lead offline, started working, synced on WiFi — the check-in log
 * never arrived, and the lead is not checked in on the other device."
 *
 * A lead created offline is addressed by a CLIENT id (`lead-1792...`) until its create drains.
 * `logEvent` only held a log when `isOnline()` was false, so an offline-created lead opened
 * while the phone had signal sent its check-in STRAIGHT OUT carrying that client id - a lead
 * reference the backend cannot resolve. The log was accepted-and-orphaned or refused, and
 * either way it never appeared against the real lead.
 *
 * Being online says nothing about whether the IDS in the payload exist yet. These are separate
 * questions and the gate has to ask both.
 */
export const hasUnsendableClientId = (payload: unknown): boolean =>
  findUnresolvedClientIds(payload).length > 0;

export const isQueueableLog = (moduleType: unknown): boolean =>
  typeof moduleType === 'string' &&
  moduleType.length > 0 &&
  !NON_QUEUEABLE_LOG_MODULES.includes(moduleType);

// A cap that drops the oldest entry is a lost log, so it is sized for a full day in the field.
export const MAX_QUEUED_LOGS = 2000;
export const MAX_LOG_ATTEMPTS = 5;

// THE one variable that carries when a rep did something: `meta.occurredAt` (ISO-8601). It is taken
// when `logEvent` is called, never when the request is sent or the network returns. A caller that
// already knows the true moment (a photo's capture time) passes it in and it is kept.
export const ACTION_TIME_KEY = 'occurredAt';

// ONE id per log, made when the action happens and sent again on every attempt (`user_activity_log_id`).
// The server stores a log under that id once, so a send the app gave up on (15 s timeout) but the server
// finished no longer becomes a second row when the log is retried or re-queued. A v4 UUID, because that
// is the only shape the backend accepts from a client.
export const newActivityLogId = (): string => {
  const bytes = new Uint8Array(16);
  const c = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const stampActionTime = <T extends Record<string, any>>(
  meta: T,
  at: string
): T & { occurredAt: string } => {
  const existing = meta?.[ACTION_TIME_KEY];
  const keep = typeof existing === 'string' && !Number.isNaN(Date.parse(existing));
  return { ...meta, [ACTION_TIME_KEY]: keep ? existing : at };
};

export const stampOfflineLog = <T extends Record<string, any>>(
  meta: T,
  occurredAt: string
): T & { occurredAt: string; queuedOffline: true } => ({
  ...stampActionTime(meta, occurredAt),
  queuedOffline: true,
});

export const appendQueuedLog = (
  queue: QueuedActivityLog[] | null | undefined,
  entry: QueuedActivityLog,
  max: number = MAX_QUEUED_LOGS
): QueuedActivityLog[] => {
  const next = [...(queue || []), entry];
  return next.length > max ? next.slice(next.length - max) : next;
};

export const replayableLogs = (
  queue: QueuedActivityLog[] | null | undefined,
  ownerId: string
): QueuedActivityLog[] => {
  const me = String(ownerId || '').trim();
  if (!me) return [];
  return (queue || []).filter((l) => String(l?.ownerId || '').trim() === me);
};

/**
 * ⚠️ A failure the NETWORK caused must not spend an attempt.
 *
 * Reported from the field: on slow mobile data, check-in / rollout / pause-work logs went
 * missing after a sync. `MAX_LOG_ATTEMPTS` is 5, and every failure used to count - so five
 * timeouts on a weak radio DELETED the log, even though the server had never seen it and
 * nothing was wrong with the payload. On office Wi-Fi five consecutive failures essentially
 * never happen, which is why it only showed up on cellular.
 *
 * The attempt counter exists to stop a POISON log (one the server keeps refusing) cycling
 * forever. A timeout is not that: it is the same log, undelivered. So a transport failure keeps
 * the log and spends nothing, and only a real answer from the server counts toward the cap.
 */
export type LogFailureKind = 'transport' | 'rejected';

export const settleQueuedLog = (
  queue: QueuedActivityLog[] | null | undefined,
  id: string,
  outcome: 'sent' | 'failed',
  maxAttempts: number = MAX_LOG_ATTEMPTS,
  failure: LogFailureKind = 'rejected'
): QueuedActivityLog[] =>
  (queue || []).flatMap((l) => {
    if (l.id !== id) return [l];
    if (outcome === 'sent') return [];
    // ⚠️ Undelivered, not refused: keep it, unchanged, for the next drain.
    if (failure === 'transport') return [l];
    const attempts = (l.attempts || 0) + 1;
    return attempts >= maxAttempts ? [] : [{ ...l, attempts }];
  });

export const rekeyQueuedLogs = (
  logs: readonly QueuedActivityLog[],
  fromId: string,
  toId: string
): QueuedActivityLog[] => {
  const from = String(fromId || '').trim();
  const to = String(toId || '').trim();
  if (!from || !to || from === to) return logs as QueuedActivityLog[];

  let changed = false;
  const next = logs.map((row) => {
    const metaMatches = String(row.meta?.leadId ?? '') === from;
    const payloadMatches = String(row.payload?.meta?.leadId ?? '') === from;
    if (!metaMatches && !payloadMatches) return row;
    changed = true;
    return {
      ...row,
      meta: metaMatches ? { ...row.meta, leadId: to } : row.meta,
      payload: payloadMatches
        ? { ...row.payload, meta: { ...row.payload.meta, leadId: to } }
        : row.payload,
    };
  });
  return changed ? next : (logs as QueuedActivityLog[]);
};

const logLeadId = (l: QueuedActivityLog): string =>
  String(l.payload?.meta?.leadId ?? l.meta?.leadId ?? '').trim();

// The next log that may be sent. A log still naming an id that exists only on this device (a lead,
// appointment or calculator not yet created on the server) is skipped, together with every later
// log of the same lead, so a lead's logs always go out in the order they happened and never ahead of
// the lead itself. Logs of other leads are not held up behind it.
export const nextSendableLog = (
  queue: QueuedActivityLog[] | null | undefined,
  ownerId: string,
  isUnresolved: (l: QueuedActivityLog) => boolean
): QueuedActivityLog | undefined => {
  const blockedLeads = new Set<string>();
  for (const l of replayableLogs(queue, ownerId)) {
    const lead = logLeadId(l);
    if (lead && blockedLeads.has(lead)) continue;
    if (isUnresolved(l)) {
      if (lead) blockedLeads.add(lead);
      continue;
    }
    return l;
  }
  return undefined;
};

/**
 * Should a log that FAILED to send be queued and retried, rather than dropped?
 *
 * ⚠️ THE BUG THIS EXISTS TO PREVENT (ticket 1310). The Forever Record showed "CONFIRMED ROLLOUTS"
 * with no price above it, so it looked as though the rep had confirmed a rollout without ever
 * entering a dollar amount - which is impossible, and reads as a process failure by the rep. The
 * two are SEPARATE log requests ("end price entered", then "rollout confirmed"), and on mobile
 * data one of them was simply lost.
 *
 * Why only on cellular: `logEvent` queues when `isOnline()` is false, but on 4G the app IS
 * online, so the log went straight out over a flaky radio - and `sendLog`'s catch merely printed
 * a warning. A timed-out log was gone for good. On office Wi-Fi the POST essentially never fails,
 * which is why the record always looked complete in testing.
 *
 * ⚠️ A 4xx must NOT be retried: the server understood us and refused, so replaying it forever
 * just fills the queue. Only "we could not deliver it" earns a retry - the same distinction the
 * connectivity layer draws between a transport error and a real response.
 */
export const shouldQueueFailedLog = (httpStatus?: number | null): boolean => {
  if (typeof httpStatus !== 'number') return true; // no response at all: timeout, DNS, TLS, reset
  if (httpStatus === 401) return true;             // session gone; it can go out after re-login
  if (httpStatus >= 500) return true;              // server fault, not ours
  return false;                                    // 4xx: the payload is the problem
};
