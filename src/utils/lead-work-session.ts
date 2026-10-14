import { Storage } from './storage';
import { LeadService } from '../services/api/leads';
import { logLeadSessionPause } from './lead-activity-log';
import { isClientId } from './offline-lead-work';

const ACTIVE_WORK_LEAD_KEY = 'sales:activeWorkLead';

export type LeadSessionEndReason = 'left_lead' | 'stale_launch';

export interface ActiveLeadWorkSession {
  leadId: string;
  jobLeadId?: string;
  userId?: string;
  isDeal?: boolean;
  startedAt?: number;
}

export const getActiveLeadWorkSession = (): ActiveLeadWorkSession | null => {
  try {
    const raw = Storage.getItem(ACTIVE_WORK_LEAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.leadId ? parsed : null;
  } catch {
    return null;
  }
};

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
  }
};

export const clearLeadWorkSession = (): void => {
  try {
    Storage.removeItem(ACTIVE_WORK_LEAD_KEY);
  } catch {
  }
};

/**
 * Release the rep from the lead, queueing it when the PUT cannot go now.
 *
 * `endWorkLead` is a bare PUT with no queue of its own, so offline it threw, the catch swallowed
 * it, and the rep stayed live on the ops board for good. The pause LOG already queued, so only
 * half of "leaving a lead" used to survive a door with no signal.
 *
 * The queue is reached through an injected hook rather than an import: this file is loaded by
 * jest, and `services/offlineLeadStore` pulls in React Native (CLAUDE.md section 6).
 */
type WorkReleaseQueue = (leadId: string) => void;
let queueRelease: WorkReleaseQueue | null = null;

export const setWorkReleaseQueue = (fn: WorkReleaseQueue): void => {
  queueRelease = fn;
};

const releaseWork = async (leadId: string, failureLabel: string): Promise<void> => {
  try {
    await LeadService.endWorkLead(leadId);
  } catch (err) {
    console.warn(failureLabel, err);
    queueRelease?.(leadId);
  }
};

/**
 * End the rep's lead session from ANYWHERE, not just Lead Center.
 *
 * A rep leaves a lead from whatever screen they happen to be on - Deal Center, Job Builder,
 * the Pitch Book - via the header, a back button, or the hardware back. Lead Center's own
 * `pauseLeadSession` is bound in a `useFocusEffect`, so it is torn down the moment a child screen
 * opens; leaving from there released nothing and the lead stayed open on the server.
 *
 * Reads the active session from MMKV rather than props, so it needs no lead object and is safe to
 * call when nothing is open (it no-ops).
 */
export const endActiveLeadWorkSession = async (): Promise<void> => {
  const session = getActiveLeadWorkSession();
  if (!session?.leadId) return;

  clearLeadWorkSession();

  if (!session.isDeal) {
    try {
      await logLeadSessionPause(
        { _id: session.userId },
        { _id: session.leadId, leadId: session.jobLeadId }
      );
    } catch (err) {
      console.warn('[LeadWork] Session pause logging failed:', err);
    }
  }

  // An offline-created lead has no server record to release yet; the queued work carries it.
  if (isClientId(session.leadId)) return;

  await releaseWork(session.leadId, '[LeadWork] Work end failed:');
};

export const endStaleLeadWorkSession = async (): Promise<void> => {
  const session = getActiveLeadWorkSession();
  if (!session) return;

  clearLeadWorkSession();

  const openFor = session.startedAt ? Math.round((Date.now() - session.startedAt) / 60000) : null;
  console.log(
    `[LeadWork] Closing a session the last run left open: ${session.leadId}` +
      (openFor != null ? ` (opened ${openFor}m ago)` : '')
  );

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

  if (isClientId(session.leadId)) {
    console.log('[LeadWork] Stale session was an offline lead; nothing to release.');
    return;
  }

  await releaseWork(session.leadId, '[LeadWork] Stale work release failed:');
};
