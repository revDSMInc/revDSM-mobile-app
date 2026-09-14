/**
 * dealCenterWarmer.ts — read each lead's quote while there is signal, so the Deal Center opens at
 * a door without one.
 *
 * The Deal Center caches its own snapshot when the rep opens it online, which covers a lead they
 * have already worked. It does NOT cover the case QA reported: a lead the rep has never opened,
 * knocked with no coverage. There the device cannot know what the server holds, so the screen
 * honestly refuses to start a rival quote — and the rep is stuck.
 *
 * This warms those leads from the Leads list, which is where the rep sits before they drive out.
 *
 * ⚠️ It NEVER creates anything. `resolveAppointmentId` (the Deal Center's own) falls through to
 * `POST /appointments` when it finds none — right there, wrong here: a background pass over a
 * whole list would file an appointment for every lead the rep has merely been assigned.
 */

import { LeadService } from './api/leads';
import { isOnline } from './connectivity';
import { readOfflineCache, writeOfflineCache } from '../utils/offline-query-cache';
import {
  dealCenterCacheName,
  matchAppointmentForLead,
  selectLeadsToWarm,
  type CachedDealCenter,
  type WarmCandidate,
} from '../utils/offline-deal-center';
import { isClientId } from '../utils/offline-lead-work';

/** Two at a time: enough to finish a list quickly, few enough to leave the screen responsive. */
const MAX_CONCURRENT = 2;

let running = false;

const leadIdOf = (lead: any): string => String(lead?._id || lead?.id || '').trim();

/**
 * Read the quotes for the leads on screen and keep a copy.
 *
 * Safe to call on every focus: it is a no-op offline, while another pass is running, or when every
 * lead already holds a fresh snapshot.
 */
export const warmLeadCalculators = async (leads: any[], userId?: string | null): Promise<void> => {
  if (running || !isOnline() || !Array.isArray(leads) || !leads.length) return;

  const owner = userId || null;
  const byId = new Map<string, any>();
  leads.forEach((lead) => {
    const id = leadIdOf(lead);
    // ⚠️ A lead this device minted has no server appointment and never will until it uploads;
    // asking for one is a guaranteed 404, and the Deal Center already mints for it offline.
    if (!id || isClientId(id) || byId.has(id)) return;
    byId.set(id, lead);
  });
  if (!byId.size) return;

  const candidates: WarmCandidate[] = [];
  byId.forEach((_lead, id) => {
    const name = dealCenterCacheName(id);
    const held = name ? readOfflineCache<CachedDealCenter>(name, { userId: owner }) : null;
    candidates.push({ leadId: id, savedAt: held ? held.savedAt : null });
  });

  const wanted = selectLeadsToWarm(candidates);
  if (!wanted.length) return;

  running = true;
  try {
    // One appointments read per distinct lead date, shared by every lead on it — the endpoint is
    // filtered by date, not by lead, so asking per lead would be the same answer N times.
    const appointmentsByDate = new Map<string, any[]>();
    const appointmentsFor = async (leadDate: string): Promise<any[]> => {
      if (appointmentsByDate.has(leadDate)) return appointmentsByDate.get(leadDate)!;
      let list: any[] = [];
      try {
        const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
        const body = res.data?.data || res.data || [];
        list = Array.isArray(body) ? body : [];
      } catch {
        // Non-fatal. A lead whose appointment cannot be resolved is simply left un-warmed; it
        // still behaves exactly as it did before this existed.
      }
      appointmentsByDate.set(leadDate, list);
      return list;
    };

    const queue = [...wanted];
    const worker = async (): Promise<void> => {
      for (;;) {
        const id = queue.shift();
        if (!id || !isOnline()) return;
        const lead = byId.get(id);
        try {
          const apptId =
            lead?.appointmentId
              ? String(lead.appointmentId)
              : matchAppointmentForLead(
                  await appointmentsFor(String(lead?.leadDate || lead?.lead_date || '')),
                  lead
                );
          // No appointment means no calculators — and that is an ANSWER, not a failure. Writing
          // the empty snapshot is what lets the Deal Center mint a first calculator at the door
          // instead of refusing; see `resolveOfflineDealCenterSource`.
          let rows: unknown[] = [];
          if (apptId) {
            const res = await LeadService.getCalculators(apptId);
            const body = res.data?.data || res.data || [];
            rows = Array.isArray(body) ? body : [];
          }
          const name = dealCenterCacheName(id);
          if (name) {
            writeOfflineCache<CachedDealCenter>(
              name,
              { appointmentId: apptId, calculators: rows },
              owner
            );
          }
        } catch {
          // Same reasoning as above — one unreadable lead must not stop the rest of the list.
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, () => worker())
    );
  } finally {
    running = false;
  }
};
