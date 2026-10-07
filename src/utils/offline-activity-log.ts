/**
 * offline-activity-log.ts — which activity logs survive a door with no signal, and how.
 *
 * `logEvent` POSTs, so offline it fails and the row is gone. Most of the time that is a diagnostic
 * nobody misses. For a handful of events it is not: the portal's Forever Record is what the office
 * reads to know a rep ARRIVED, and a rep who worked a full day out of coverage looked, from the
 * office, like a rep who never left the truck.
 *
 * Pure and RN-free for the reason `utils/session-scope.ts` is: `LoggerService` binds axios, MMKV
 * and Geolocation and cannot be loaded under jest, while every rule here fails silently — a log
 * queued under the wrong key, replayed twice, or stamped with the wrong time all read as a portal
 * problem rather than an app one.
 */

/** One held log, exactly as `sendLog` would have posted it. */
export interface QueuedActivityLog {
  /** Client-side id, so a replay can be de-duplicated and a failure can name the row. */
  id: string;
  /** `action_type` — the first argument to `logEvent`. */
  eventType: string;
  payload: Record<string, any>;
  meta: Record<string, any>;
  attachLocation: boolean;
  /** When the rep actually did the thing. See `stampOfflineLog`. */
  occurredAt: string;
  /** Whose session queued it — a shared handset must never replay another rep's rows. */
  ownerId: string;
  attempts: number;
}

/**
 * ⚠️ An ALLOW-LIST, and deliberately a short one.
 *
 * The opposite choice — queue everything — is what makes this dangerous rather than merely large:
 * `logCalculatorFieldEntry` fires per field, so one offline quote is hundreds of rows, and MMKV
 * rewrites its whole store on every write. A day in a dead zone would fill the device with
 * telemetry and then replay it as a flood that buries the events anyone actually reads.
 *
 * The first four are the ones the office acts on: the rep arrived, resumed, reviewed from off-site,
 * or left. `customer_details` earns its place on the same test — it fires at most a handful of
 * times per lead (an open, a save, and a debounced row per field the rep actually changed), not per
 * keystroke, and the edits it records are now queued for upload, so dropping the log would leave
 * the portal timeline blank for a correction that really did reach the record.
 *
 * ⚠️ THE TEST FOR ADDING ONE, and it is a rate test, not an importance test: does this module fire
 * a HANDFUL of times per lead, and does the WORK it describes get queued for upload? Both must
 * hold. A module that fires per field fails the first; a module whose work is dropped offline
 * fails the second, and queuing its log would file a timeline row for something that never
 * happened.
 *
 * The second group below was added after a rep worked a whole lead offline — created it, priced
 * it, dropped it, built the job, resulted it — and the portal timeline showed almost none of it.
 * Every one of those actions IS queued and does reach the server, so the work landed while the
 * record of it did not. Each fires on a milestone (a drop secured, a job submitted, a sale
 * resulted), not per keystroke.
 *
 * ⚠️ `calculator_field_entry` and `lead_result_field_entry` are deliberately NOT here and must
 * not be added. They fire PER FIELD — one offline quote is hundreds of rows, MMKV rewrites its
 * whole store on every write, and the replay would bury the events above in telemetry. That is
 * the specific failure this allow-list exists to prevent.
 *
 * Everything else is still fire-and-forget and is still dropped offline, as before.
 */
export const QUEUEABLE_LOG_MODULES: readonly string[] = [
  'lead_check_in',
  'lead_resume',
  'lead_review',
  'lead_session',
  'customer_details',
  // ── Work a rep can complete at a door, all of which uploads ──────────────────
  /** The lead itself, created with no signal. */
  'self_gen_lead',
  /** Quote milestones — a calculator opened, named, duplicated, deleted. Not field entries. */
  'calculator',
  /** A drop secured or declined: the negotiation record the office reads. */
  'rollout_and_drop',
  /** The job build — steps completed and the submit. */
  'job_builder',
  /** Result Lead ▸ Confirm and the payment split. */
  'funding',
  /** The agreement signed at the door. */
  'agreement',
  /** Consent form and roof waiver, both captured offline and queued. */
  'consent_form',
  'roof_waiver',
  'roof_waiver_form',
];

export const isQueueableLog = (moduleType: unknown): boolean =>
  typeof moduleType === 'string' && QUEUEABLE_LOG_MODULES.includes(moduleType);

/** A stuck device must not grow this without bound; the OLDEST is dropped first. */
export const MAX_QUEUED_LOGS = 200;
/** After this many failed replays the row is dropped — it is a diagnostic, not the rep's work. */
export const MAX_LOG_ATTEMPTS = 5;

/**
 * Stamp a held log with the moment it happened.
 *
 * ⚠️ The backend stamps `createdAt` ON RECEIPT and the portal timeline renders in arrival order
 * (the note on `LoggerService`'s serialized queue records this). So a check-in queued at a 9am door
 * and replayed at 5pm reads as a 5pm arrival — wrong, and wrong in the direction that matters,
 * since these events are exactly the ones the office uses to see when a rep was on site.
 *
 * `occurredAt` carries the truth in `meta`, and `queuedOffline` says why the two differ. Additive:
 * `meta` is free-form per module, so nothing that reads it today can be broken by them, and the
 * portal can adopt `occurredAt` whenever it likes.
 */
export const stampOfflineLog = <T extends Record<string, any>>(
  meta: T,
  occurredAt: string
): T & { occurredAt: string; queuedOffline: true } => ({
  ...meta,
  occurredAt,
  queuedOffline: true,
});

/** Append, keeping the queue bounded and the order the rep did things in. */
export const appendQueuedLog = (
  queue: QueuedActivityLog[] | null | undefined,
  entry: QueuedActivityLog,
  max: number = MAX_QUEUED_LOGS
): QueuedActivityLog[] => {
  const next = [...(queue || []), entry];
  return next.length > max ? next.slice(next.length - max) : next;
};

/**
 * The rows this session may replay, oldest first.
 *
 * ⚠️ Scoped by owner for the reason the whole offline module is: a shared handset that files one
 * rep's arrival under the next rep's token has put a false record on the portal, and unlike a
 * display leak there is no way to see it from the device.
 */
export const replayableLogs = (
  queue: QueuedActivityLog[] | null | undefined,
  ownerId: string
): QueuedActivityLog[] => {
  const me = String(ownerId || '').trim();
  if (!me) return [];
  return (queue || []).filter((l) => String(l?.ownerId || '').trim() === me);
};

/** Drop a row that has landed, or has failed too many times to be worth keeping. */
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

/**
 * Re-address every held log from the client id this device minted to the id the server issued.
 *
 * ⚠️ Its ABSENCE was a reported bug, and the symptom was the portal's Forever Record showing
 * **"Sales Arrival: Pending… Awaiting Check-In"** on a door the rep had demonstrably worked — while
 * *Sales Process* right beneath it showed their session. The check-in log had replayed, but it
 * carried `meta.leadId: "work-1773…"`, which matches no lead, so the portal could not hang it on
 * the timeline. The row is filed and orphaned: nothing errors, nothing retries, and the office
 * sees a rep who never arrived.
 *
 * ⚠️ `payload.meta` AND `meta` both, because `LoggerService` stores the same object under both
 * keys (`payload: { ...payload, meta: heldMeta }, meta: heldMeta`) and the POST body is built from
 * `payload`. Rewriting one and not the other sends the stale id.
 *
 * ⚠️ Matched on the id only — never on `ownerId` or the module. A lead created by this device is
 * addressed by this client id in every row that mentions it, and a partial rewrite would leave the
 * timeline half-attached.
 *
 * Returns the SAME array when nothing matched, so a no-op write can be skipped.
 */
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
