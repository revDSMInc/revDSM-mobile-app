import api from './index';

export const InstallAvailabilityEndpoint = 'installer/v1/installer-dispatch/availability';

export interface InstallAvailabilityWindow {
  key: string;
  /** Matches the text booking stores, e.g. "8:00 AM - 12:00 PM". */
  label: string;
  available: boolean;
  crewId: string | null;
  crewName: string | null;
  arrivalTime: string | null;
  multiDay: boolean;
  projectedCompletionDate: string | null;
  overflow: {
    crewId: string;
    crewName: string;
    arrivalTime: string;
    overByMins: number;
  } | null;
}

export interface InstallAvailability {
  /** False means "show every window as before". */
  enforced: boolean;
  canOverride: boolean;
  date: string;
  windows: InstallAvailabilityWindow[];
}

/**
 * Which arrival windows a job can be booked into on a day. Resolves to null when
 * the scheduler cannot be reached (offline, slow, error): booking must never be
 * blocked by the availability check itself, so callers treat null as "no rules".
 */
export async function fetchInstallAvailability(params: {
  date: string;
  leadId?: string;
}): Promise<InstallAvailability | null> {
  try {
    const res = await api.post<any>(InstallAvailabilityEndpoint, {
      date: params.date,
      ...(params.leadId ? { leadId: params.leadId } : {}),
    });
    const data = res?.data?.data;
    return data && Array.isArray(data.windows) ? (data as InstallAvailability) : null;
  } catch {
    return null;
  }
}
