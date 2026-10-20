import { Storage } from './storage';
import {
  calculateDistance,
  getScheduledDateTime,
  isSelfGeneratedLead,
  isResumeAppointment,
  isBeforeTimeWindow,
  isGpsBypassActive,
  countsAsAtTheDoor,
  isEarlyStartBypassActive,
  GEOFENCE_RADIUS_MILES,
} from './location-util';
import { logEvent } from '../services/api/LoggerService';
import ChatService from '../services/api/ChatService';
import SocketManager from '../services/SocketManager';

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

export function planStartAppointment(lead: any, userLocation: UserLocation): AppointmentLogPlan {
  /*
   * IMPORTANT: `countsAsAtTheDoor` treats an UNKNOWN location as in range. `userLocation`
   * starts null here and fills in asynchronously, and an early tap used to look "out of range"
   * - which made `shouldCallWork` false and dropped the check-in silently. The rule lives in
   * `location-util` because this module cannot be loaded under jest (it imports LoggerService
   * -> netinfo); the tests drive it there.
   */
  const isInRange = countsAsAtTheDoor(lead, userLocation, isGpsBypassActive(lead));

  const isSelfGen = isSelfGeneratedLead(lead);
  const isResumeLead = isResumeAppointment(lead);

  const scheduledTime = getScheduledDateTime(lead);
  const beforeWindow = isBeforeTimeWindow(scheduledTime);
  const earlyStartActive =
    (lead?.earlyStart === true || isEarlyStartBypassActive(lead)) && isInRange;

  let logModule: LeadLogModule = '';
  if (isResumeLead) {
    logModule = isInRange ? 'lead_resume' : 'lead_review';
  } else if (isSelfGen) {
    if (isInRange) logModule = 'lead_check_in';
  } else {
    if (isInRange && (!beforeWindow || earlyStartActive)) logModule = 'lead_check_in';
  }

  const isResulted = !['lfLead', 'selfGenerated', 'scheduled'].includes(lead?.status || '');
  const shouldCallWork = !isResulted && logModule !== '';

  return {
    logModule,
    shouldCallWork,
    shouldCreateChat: !isResumeLead,
    isInRange,
  };
}

export function planZoneCanvasserStartAppointment(
  lead: any,
  userLocation: UserLocation
): AppointmentLogPlan {
  const workflowState = lead?.workflowState || 'preview';
  // Same rule as `planStartAppointment`: an unknown location must not silently drop the
  // check-in for a canvassed door either.
  const isInRange = countsAsAtTheDoor(lead, userLocation);
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
      jobLeadId: lead.leadId || 'N/A',
      hasExistingImages:
        typeof lead.hasSalesPhotos === 'boolean'
          ? lead.hasSalesPhotos
          : (lead.salesPhotos || []).length > 0,
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

    SocketManager.joinLeadOnsiteWatch(leadId);
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
  const userId = user?._id || user?.id;
  const leadId = lead?._id || lead?.id;
  if (!userId || !leadId) return;

  await logEvent('pause', {
    user_id: userId,
    module_type: 'lead_session',
    action: 'session_pause',
    created_by: userId,
    meta: {
      leadId,
      jobLeadId: lead?.leadId || 'N/A',
    },
  });

  SocketManager.leaveLeadOnsiteWatch(leadId);
}
