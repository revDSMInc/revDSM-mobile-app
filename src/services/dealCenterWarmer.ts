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

const MAX_CONCURRENT = 2;

let running = false;

const leadIdOf = (lead: any): string => String(lead?._id || lead?.id || '').trim();

export const warmLeadCalculators = async (leads: any[], userId?: string | null): Promise<void> => {
  if (running || !isOnline() || !Array.isArray(leads) || !leads.length) return;

  const owner = userId || null;
  const byId = new Map<string, any>();
  leads.forEach((lead) => {
    const id = leadIdOf(lead);
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
    const appointmentsByDate = new Map<string, any[]>();
    const appointmentsFor = async (leadDate: string): Promise<any[]> => {
      if (appointmentsByDate.has(leadDate)) return appointmentsByDate.get(leadDate)!;
      let list: any[] = [];
      try {
        const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
        const body = res.data?.data || res.data || [];
        list = Array.isArray(body) ? body : [];
      } catch {
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
