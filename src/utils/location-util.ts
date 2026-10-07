export const GEOFENCE_RADIUS_MILES = 1;

export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in kilometers
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;
  return distanceKm * 0.621371; // Convert km to miles
};

export const isSelfGeneratedLead = (lead: any): boolean => {
  return (
    !lead?.leadTime ||
    lead?.leadTime === null ||
    lead?.leadTime === 'N/A' ||
    lead?.isSelfGen === true ||
    lead?.selfGen === true ||
    lead?.leadType === 'selfGen' ||
    lead?.leadType === 'self_gen' ||
    lead?.leadType === 'self-generated' ||
    lead?.status === 'selfGenerated' ||
    lead?.status === 'self-generated'
  );
};

export const canCheckIn = (lead: any): boolean => {
  return (
    lead?.workflowState === 'preview' ||
    lead?.checkInCount > 0 ||
    (Array.isArray(lead?.checkIns) && lead.checkIns.length > 0) ||
    lead?.lastCheckIn != null
  );
};

export const isResumeAppointment = (lead: any): boolean => {
  return lead?.workflowState === 'resume';
};

export const getScheduledDateTime = (lead: any): Date | null => {
  if (!lead?.leadTime || typeof lead.leadTime !== 'string') return null;
  const dateStr = lead.leadDate || lead.installationDate;
  if (!dateStr) return null;

  const timeStr = lead.leadTime.toLowerCase().trim();
  const isPM = timeStr.includes('pm');
  const timeMatch = timeStr.match(/(\d+)/);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  if (isPM && hours !== 12) hours += 12;
  else if (!isPM && hours === 12) hours = 0;

  const baseDate = new Date(dateStr);
  if (isNaN(baseDate.getTime())) return null;

  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hours, 0, 0);
};

export {
  isGpsBypassActive,
  isEarlyStartBypassActive,
  gpsBypassReason,
  earlyStartBypassReason,
} from './job-bypass';

export const isWithinTimeWindow = (scheduledDateTime: Date | null): boolean => {
  if (!scheduledDateTime) return false;
  const now = Date.now();
  const scheduled = scheduledDateTime.getTime();
  return now >= scheduled - 15 * 60 * 1000 && now <= scheduled + 60 * 60 * 1000;
};

export const isBeforeTimeWindow = (scheduledDateTime: Date | null): boolean => {
  if (!scheduledDateTime) return false;
  return Date.now() < scheduledDateTime.getTime() - 15 * 60 * 1000;
};
