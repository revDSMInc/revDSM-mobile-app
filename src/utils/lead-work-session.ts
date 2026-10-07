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

  try {
    await LeadService.endWorkLead(session.leadId);
  } catch (err) {
    console.warn('[LeadWork] Stale work release failed:', err);
  }
};
