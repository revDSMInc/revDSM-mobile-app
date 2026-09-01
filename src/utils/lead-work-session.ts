/**
 * The rep's open work session on a lead — `PUT lead/v1/{leadId}/work`.
 *
 * Opening the Lead Center stamps `workStartedBy`; backing out clears it with
 * `{ workStartedBy: null }` and files a `lead_session` / `session_pause` log. While it is
 * set the ops board shows that rep LIVE on the lead, so a session left open is a rep who
 * looks like they are sitting in a customer's house they left hours ago.
 *
 * The screen unmounting is only ONE way a session ends. This module exists for the one
 * that does not go through the screen at all: **the app being killed**. No cleanup runs,
 * nothing unmounts, no JS executes — so the lead is closed on the NEXT LAUNCH instead.
 *
 * Deliberately modelled on `utils/installer-work-session.ts`, which solves the identical
 * problem for the installer's job session. Keep the two in step.
 *
 * ⚠️ This heals on the next launch, which may be hours later. The durable fix is
 * server-side: the rep's socket drops the instant the app dies, so ending the in-home
 * session on that disconnect (or on a stale `update-rep-location`) is the only thing that
 * can take them off the board in real time. Nothing a killed client can do reaches the
 * server.
 */

import { Storage } from './storage';
import { LeadService } from '../services/api/leads';
import { logLeadSessionPause } from './lead-activity-log';

/** Where the open session lives between screens — and across app launches. */
const ACTIVE_WORK_LEAD_KEY = 'sales:activeWorkLead';

/** Why a session was closed. Logged, and useful when reading a device trace. */
export type LeadSessionEndReason = 'left_lead' | 'stale_launch';

export interface ActiveLeadWorkSession {
  leadId: string;
  /** The human lead number, for the pause log's `meta.jobLeadId`. */
  jobLeadId?: string;
  userId?: string;
  /**
   * A DEAL, opened from My Deals. It still holds a work session (the Lead Center opens
   * one on mount either way), but it must never file a pause — web does not, because a
   * deal is read, not worked.
   */
  isDeal?: boolean;
  /** When the session was opened, so a trace can show how long it was left. */
  startedAt?: number;
}

export const getActiveLeadWorkSession = (): ActiveLeadWorkSession | null => {
  try {
    const raw = Storage.getItem(ACTIVE_WORK_LEAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.leadId ? parsed : null;
  } catch {
    // A record written by an older build, or storage that will not read — either way
    // there is nothing safe to close, and this must never throw at startup.
    return null;
  }
};

/**
 * Records that a lead now has an open work session.
 *
 * A storage failure is swallowed: it costs the ability to close the session from outside
 * the screen, and must never block the rep from opening the lead.
 *
 * ⚠️ A DEAL is recorded too — it opens a work session like any other lead and that has
 * to be released — but the record carries `isDeal` so the sweep releases it WITHOUT
 * filing a pause. Web files none for a deal.
 */
export const beginLeadWorkSession = (lead: any, user: any, isDeal?: boolean): void => {
  const leadId = lead?._id || lead?.id;
  if (!leadId) return;
  try {
    Storage.setItem(
      ACTIVE_WORK_LEAD_KEY,
      JSON.stringify({
        leadId,
        jobLeadId: lead?.leadId || 'N/A',
        userId: user?._id || user?.id,
        isDeal: isDeal === true,
        startedAt: Date.now(),
      })
    );
  } catch {
    // no-op — see above.
  }
};

/**
 * Forgets the open session WITHOUT closing it.
 *
 * For the normal exits, which do their own pause log and `endWorkLead` — this only stops
 * the next launch treating an already-closed session as stale and filing a second pause.
 */
export const clearLeadWorkSession = (): void => {
  try {
    Storage.removeItem(ACTIVE_WORK_LEAD_KEY);
  } catch {
    // no-op
  }
};

/**
 * Closes a session the last run never closed — the app was killed rather than backed out
 * of, so no cleanup ran and the board is still showing that rep in the house.
 *
 * ⚠️ The record is cleared BEFORE the requests go out, deliberately: a second call (a
 * re-entrant launch path, or the rep opening the lead again while this is in flight) must
 * be a no-op rather than a duplicate pause.
 *
 * ⚠️ Must run AFTER the token is restored. `endWorkLead` skips a tokenless call rather
 * than sending a 401, and `logEvent` holds a tokenless log instead of sending it — so
 * running this any earlier silently does nothing.
 *
 * ⚠️ The pause is timestamped at LAUNCH, not at the kill: the backend stamps `createdAt`
 * on receipt and the client sends no time of its own. The portal therefore shows the rep
 * leaving when the app next opened. Closing it late still beats leaving it open forever,
 * but it is another reason the real fix belongs on the socket disconnect.
 *
 * Never throws: a failed close is logged and swallowed.
 */
export const endStaleLeadWorkSession = async (): Promise<void> => {
  const session = getActiveLeadWorkSession();
  if (!session) return;

  clearLeadWorkSession();

  const openFor = session.startedAt ? Math.round((Date.now() - session.startedAt) / 60000) : null;
  console.log(
    `[LeadWork] Closing a session the last run left open: ${session.leadId}` +
      (openFor != null ? ` (opened ${openFor}m ago)` : '')
  );

  // The log first, so the portal timeline reads pause-then-released rather than the
  // other way round. It also emits the socket leave, taking the rep off the watch room.
  // Skipped for a deal, which never files one — see `beginLeadWorkSession`.
  if (!session.isDeal) {
    try {
      await logLeadSessionPause(
        { _id: session.userId },
        { _id: session.leadId, leadId: session.jobLeadId }
      );
    } catch (err) {
      console.warn('[LeadWork] Stale pause log failed:', err);
    }
  }

  try {
    await LeadService.endWorkLead(session.leadId);
  } catch (err) {
    console.warn('[LeadWork] Stale work release failed:', err);
  }
};
