import api from './index';

export const InstallAvailabilityEndpoint = 'installer/v1/installer-dispatch/availability';
export const InstallCalendarEndpoint = 'installer/v1/installer-dispatch/availability/calendar';
export const InstallBookEndpoint = 'installer/v1/installer-dispatch/availability/book';

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

export interface InstallCalendarDay {
  /** yyyy-MM-dd */
  date: string;
  /** At least one arrival window has a crew that can take the job. */
  available: boolean;
  windows: Record<string, boolean>;
}

export interface InstallCalendarAvailability {
  /** False means "dim nothing". */
  enforced: boolean;
  canOverride: boolean;
  days: InstallCalendarDay[];
}

/**
 * Which days in a range can take the job at all, so the calendar can dim the ones that
 * cannot. Resolves to null when the scheduler cannot be reached: the calendar then dims
 * nothing, and the per-day check still decides what can be booked.
 */
export async function fetchInstallCalendarAvailability(params: {
  startDate: string;
  endDate: string;
  leadId?: string;
}): Promise<InstallCalendarAvailability | null> {
  try {
    const res = await api.post<any>(InstallCalendarEndpoint, {
      startDate: params.startDate,
      endDate: params.endDate,
      ...(params.leadId ? { leadId: params.leadId } : {}),
    });
    const data = res?.data?.data;
    return data && Array.isArray(data.days) ? (data as InstallCalendarAvailability) : null;
  } catch {
    return null;
  }
}

/** What booking a time did. Only `taken` and `offline` stop the rep; the rest let booking go on. */
export type BookInstallResult =
  | { kind: 'booked'; assigned: boolean }
  | { kind: 'taken'; message: string }
  | { kind: 'offline' }
  | { kind: 'error' };

/**
 * "Yes, this time works for the customer": books the day and window and has the server
 * assign the crew, first come first served.
 *
 * - `taken`   - someone else got there first (409): the rep must pick another time.
 * - `offline` - the server could not be reached (no response at all): scheduling needs a
 *               connection, so the rep is stopped rather than booked unchecked.
 * - `error`   - the server answered but could not book (any other failure): the job is
 *               still saved when the job builder is submitted, which tries to assign again.
 */
export async function bookInstallSlot(params: {
  leadId: string;
  /** yyyy-MM-dd */
  date: string;
  /** The window text booking stores, e.g. "8:00 AM - 12:00 PM". */
  timeWindow: string;
  /** The job is being sold: a lead is only `sale` once its job builder is submitted. */
  isSale?: boolean;
}): Promise<BookInstallResult> {
  try {
    const res = await api.post<any>(InstallBookEndpoint, params);
    return { kind: 'booked', assigned: !!res?.data?.data?.assigned };
  } catch (error: any) {
    const status = error?.httpStatus;
    if (status === 409) {
      return { kind: 'taken', message: String(error?.message || 'That time was just taken. Please pick another time.') };
    }
    if (status === undefined) return { kind: 'offline' };
    return { kind: 'error' };
  }
}
