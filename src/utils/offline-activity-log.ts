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

export const QUEUEABLE_LOG_MODULES: readonly string[] = [
  'lead_check_in',
  'lead_resume',
  'lead_review',
  'lead_session',
  'customer_details',
  'self_gen_lead',
  'calculator',
  'rollout_and_drop',
  'job_builder',
  'funding',
  'agreement',
  'consent_form',
  'roof_waiver',
  'roof_waiver_form',
];

export const isQueueableLog = (moduleType: unknown): boolean =>
  typeof moduleType === 'string' && QUEUEABLE_LOG_MODULES.includes(moduleType);

export const MAX_QUEUED_LOGS = 200;
export const MAX_LOG_ATTEMPTS = 5;

export const stampOfflineLog = <T extends Record<string, any>>(
  meta: T,
  occurredAt: string
): T & { occurredAt: string; queuedOffline: true } => ({
  ...meta,
  occurredAt,
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
