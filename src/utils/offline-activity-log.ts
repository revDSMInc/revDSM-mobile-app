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

export const settleQueuedLog = (
  queue: QueuedActivityLog[] | null | undefined,
  id: string,
  outcome: 'sent' | 'failed',
  maxAttempts: number = MAX_LOG_ATTEMPTS
): QueuedActivityLog[] =>
  (queue || []).flatMap((l) => {
    if (l.id !== id) return [l];
    if (outcome === 'sent') return [];
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
