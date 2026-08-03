import { Storage } from './storage';
import {
  calculateDistance,
  getScheduledDateTime,
  isSelfGeneratedLead,
  isResumeAppointment,
  isBeforeTimeWindow,
  isGpsBypassActive,
  isEarlyStartBypassActive,
  GEOFENCE_RADIUS_MILES,
} from './location-util';
import { logEvent } from '../services/api/LoggerService';
import ChatService from '../services/api/ChatService';

export type UserLocation = { latitude: number; longitude: number } | null;
export type LeadLogModule = 'lead_check_in' | 'lead_resume' | 'lead_review' | '';

export interface AppointmentLogPlan {
  logModule: LeadLogModule;
  shouldCallWork: boolean;
  shouldCreateChat: boolean;
  isInRange: boolean;
}

export const persistActiveLeadId = (leadId?: string) => {
  if (leadId) Storage.setItem('leadId', leadId);
};

export const logLeadCardSelect = async (user: any, lead: any) => {
  const userId = user?._id || user?.id;
  if (!userId) return;
  const leadId = lead?._id || lead?.id;
  await persistActiveLeadId(leadId);

  const contactPerson = lead?.customerDetails
    ? `${lead.customerDetails.firstName || ''} ${lead.customerDetails.lastName || ''}`.trim()
    : 'N/A';
  const address = lead?.customerDetails?.address || lead?.fullAddress || 'N/A';

  await logEvent('select', {
    user_id: userId,
    module_type: 'lead_card',
    created_by: userId,
    meta: {
      leadId,
      contactPerson,
      address,
      action: 'view_lead_details',
    },
  });
};

export function isLeadInGeofence(lead: any, userLocation: UserLocation): boolean {
  const coords = lead?.location?.coordinates;
  if (!userLocation || !coords || coords.length < 2) return false;
  return (
    calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      coords[1],
      coords[0]
    ) <= GEOFENCE_RADIUS_MILES
  );
}

/** Leads list / job card — mirrors web getJobStatus + useJobCard.handleImageButtonClick dispatch */
export function planStartAppointment(lead: any, userLocation: UserLocation): AppointmentLogPlan {
  const rawInRange = isLeadInGeofence(lead, userLocation);
  // GPS bypass replaces the physical geofence check (web parity)
  const isInRange = rawInRange || isGpsBypassActive(lead);

  const isSelfGen = isSelfGeneratedLead(lead);
  const isResumeLead = isResumeAppointment(lead);

  const scheduledTime = getScheduledDateTime(lead);
  const beforeWindow = isBeforeTimeWindow(scheduledTime);
  // Early-start bypass replaces the time-window gate (only meaningful on-site)
  const earlyStartActive =
    (lead?.earlyStart === true || isEarlyStartBypassActive(lead)) && isInRange;

  let logModule: LeadLogModule = '';
  if (isResumeLead) {
    // Checked in before → GPS alone decides Resume vs Review (time window ignored)
    logModule = isInRange ? 'lead_resume' : 'lead_review';
  } else if (isSelfGen) {
    // Self-gen never checked in → on-site starts; off-site is Preview (no action)
    if (isInRange) logModule = 'lead_check_in';
  } else {
    // Regular never checked in → on-site + not-too-early starts; else Preview (no action)
    if (isInRange && (!beforeWindow || earlyStartActive)) logModule = 'lead_check_in';
  }

  const isResulted = !['lfLead', 'selfGenerated', 'scheduled'].includes(lead?.status || '');
  // Only the actionable states (check-in / resume / review) hit the work endpoint;
  // a Preview button is disabled and never reaches here.
  const shouldCallWork = !isResulted && logModule !== '';

  return {
    logModule,
    shouldCallWork,
    shouldCreateChat: !isResumeLead,
    isInRange,
  };
}

/** Zone map submitted-lead popup — mirrors web submitted-lead-popup.js */
export function planZoneCanvasserStartAppointment(
  lead: any,
  userLocation: UserLocation
): AppointmentLogPlan {
  const workflowState = lead?.workflowState || 'preview';
  const isInRange = isLeadInGeofence(lead, userLocation);
  let logModule: LeadLogModule = '';
  let shouldCallWork = false;

  if (workflowState === 'preview' && isInRange) {
    logModule = 'lead_check_in';
    shouldCallWork = true;
  } else if (workflowState === 'resume') {
    logModule = isInRange ? 'lead_resume' : 'lead_review';
    shouldCallWork = true;
  }

  return {
    logModule,
    shouldCallWork,
    shouldCreateChat: workflowState !== 'resume',
    isInRange,
  };
}

const LEAD_ACTION_BY_MODULE: Record<Exclude<LeadLogModule, ''>, string> = {
  lead_check_in: 'check_in_clicked',
  lead_resume: 'check_resume_clicked',
  lead_review: 'check_review_clicked',
};

export async function logLeadActionClick(
  user: any,
  logModule: LeadLogModule,
  lead: any,
  extraMeta?: Record<string, unknown>
) {
  const userId = user?._id || user?.id;
  if (!userId || !logModule) return;

  // Web parity (useJobCard.handleImageButtonClick): attach the ACTIVE bypass +
  // its reason to the check-in / resume log so the Forever Record shows which
  // manager override was in effect when the rep arrived. Review carries no
  // bypass meta (matching web — a review is off-site, no override was used).
  const bypassMeta: Record<string, unknown> = {};
  if (logModule === 'lead_check_in' || logModule === 'lead_resume') {
    if (isGpsBypassActive(lead)) {
      bypassMeta.usedGpsBypass = true;
      bypassMeta.gpsBypassReason = lead?.bypass?.gpsBypassReason || null;
    }
    if (isEarlyStartBypassActive(lead)) {
      bypassMeta.usedEarlyStartBypass = true;
      bypassMeta.earlyStartBypassReason = lead?.bypass?.earlyStartReason || null;
    }
  }

  await logEvent('click', {
    user_id: userId,
    module_type: logModule,
    action: LEAD_ACTION_BY_MODULE[logModule],
    created_by: userId,
    meta: {
      leadId: lead._id || lead.id,
      hasExistingImages: (lead.salesPhotos || []).length > 0,
      isSelfGenerated: isSelfGeneratedLead(lead),
      ...bypassMeta,
      ...extraMeta,
    },
  });
}

export interface ExecuteStartAppointmentOptions {
  lead: any;
  user: any;
  userLocation: UserLocation;
  workMutation: { mutateAsync: (args: { leadId: string; userId: string }) => Promise<any> };
  fromZoneCanvasser?: boolean;
  onWorkSuccess?: (updatedLead: any) => void;
}

export async function executeStartAppointmentFlow(
  opts: ExecuteStartAppointmentOptions
): Promise<{ lead: any; logModule: LeadLogModule; workCalled: boolean }> {
  const { lead, user, userLocation, workMutation, fromZoneCanvasser, onWorkSuccess } = opts;
  const leadId = lead._id || lead.id;
  const userId = user?._id || user?.id;
  let targetLead = lead;

  await persistActiveLeadId(leadId);

  const plan = fromZoneCanvasser
    ? planZoneCanvasserStartAppointment(lead, userLocation)
    : planStartAppointment(lead, userLocation);

  let workCalled = false;
  if (plan.shouldCallWork && userId && leadId) {
    const res = await workMutation.mutateAsync({ leadId, userId });
    workCalled = true;

    if (plan.shouldCreateChat) {
      ChatService.createChatForLead(leadId).catch((e) =>
        console.warn('[Chat] Auto-creation failed:', e)
      );
    }

    if (plan.logModule) {
      await logLeadActionClick(user, plan.logModule, lead);
    }
    const workData = res.data?.data || res.data;
    if (workData) {
      targetLead = { ...lead, ...workData };
      onWorkSuccess?.(targetLead);
    }
  }

  return { lead: targetLead, logModule: plan.logModule, workCalled };
}

export async function logLeadSessionEnter(user: any, lead: any) {
  const userId = user?._id || user?.id;
  const leadId = lead?._id || lead?.id;
  if (!userId || !leadId) return;
  await persistActiveLeadId(leadId);
}

export async function logLeadSessionPause(user: any, lead: any) {
  // No-op - removed irrelevant telemetry logs
}

export async function logLeadCheckOut(user: any, lead: any) {
  const userId = user?._id || user?.id;
  if (!userId || !lead?._id) return;
  await logEvent('unload', {
    user_id: userId,
    module_type: 'lead_check_out',
    action: 'check_out_unloaded',
    created_by: userId,
    meta: { leadId: lead._id || lead.id, unload: true },
  });
}
