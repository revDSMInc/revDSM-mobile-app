import { Storage } from './storage';
import {
  calculateDistance,
  getScheduledDateTime,
  isSelfGeneratedLead,
  isResumeAppointment,
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

/** Leads list / job card — mirrors Leads/index handleActionPress + useJobCard resume/review rules */
export function planStartAppointment(lead: any, userLocation: UserLocation): AppointmentLogPlan {
  const isInRange = isLeadInGeofence(lead, userLocation);
  const isSelfGen = isSelfGeneratedLead(lead);
  const isResumeLead = isResumeAppointment(lead);

  const scheduledTime = getScheduledDateTime(lead);
  const nowTime = Date.now();
  const fifteenMinBefore = scheduledTime ? scheduledTime.getTime() - 15 * 60 * 1000 : null;
  const oneHourAfter = scheduledTime ? scheduledTime.getTime() + 60 * 60 * 1000 : null;
  const isBeforeWindow = fifteenMinBefore !== null ? nowTime < fifteenMinBefore : false;
  const isWithinWindow =
    fifteenMinBefore !== null && oneHourAfter !== null
      ? nowTime >= fifteenMinBefore && nowTime <= oneHourAfter
      : false;

  let logModule: LeadLogModule = '';
  if (isResumeLead) {
    const shouldResume = isSelfGen ? isInRange : isInRange && isWithinWindow;
    logModule = shouldResume ? 'lead_resume' : 'lead_review';
  } else {
    const shouldCheckIn = isSelfGen
      ? isInRange && !isBeforeWindow
      : isInRange && (isWithinWindow || (!isBeforeWindow && !isWithinWindow));
    if (shouldCheckIn) logModule = 'lead_check_in';
  }

  const isResulted = !['lfLead', 'selfGenerated', 'scheduled'].includes(lead?.status || '');
  const shouldCallWork = !isResulted && !isBeforeWindow;

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

export async function logLeadActionClick(
  user: any,
  logModule: LeadLogModule,
  lead: any,
  extraMeta?: Record<string, unknown>
) {
  const userId = user?._id || user?.id;
  if (!userId || !logModule) return;
  await logEvent('click', {
    user_id: userId,
    module_type: logModule,
    action: `${logModule}_clicked`,
    created_by: userId,
    meta: {
      leadId: lead._id || lead.id,
      hasExistingImages: (lead.salesPhotos || []).length > 0,
      isSelfGenerated: isSelfGeneratedLead(lead),
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
