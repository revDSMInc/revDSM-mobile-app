export interface CachedDealCenter {
  appointmentId?: string | null;
  calculators: unknown[];
}

export const DEAL_CENTER_CALC_CACHE = 'deal-center-calculators';

export const dealCenterCacheName = (leadId: unknown): string | null => {
  const id = leadId === null || leadId === undefined ? '' : String(leadId).trim();
  return id ? `${DEAL_CENTER_CALC_CACHE}:${id}` : null;
};

export const cachedCalculatorsOf = (
  snapshot: CachedDealCenter | null | undefined
): unknown[] => (Array.isArray(snapshot?.calculators) ? (snapshot as CachedDealCenter).calculators : []);

export type OfflineDealCenterSource =
  | 'device'
  | 'cache'
  | 'mint'
  | 'unavailable';

export const resolveOfflineDealCenterSource = (input: {
  storedCalculators?: number | null;
  cached?: CachedDealCenter | null;
  leadCreatedOffline?: boolean;
  storedDrained?: boolean;
}): OfflineDealCenterSource => {
  const snapshotHasRows = !!input.cached && cachedCalculatorsOf(input.cached).length > 0;
  if ((input.storedCalculators || 0) > 0 && !(input.storedDrained && snapshotHasRows)) return 'device';
  if (input.cached) return cachedCalculatorsOf(input.cached).length > 0 ? 'cache' : 'mint';
  return input.leadCreatedOffline ? 'mint' : 'unavailable';
};

export const WARM_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

export const WARM_BATCH_LIMIT = 12;

export interface WarmCandidate {
  leadId: string;
  savedAt: number | null;
}

export const selectLeadsToWarm = (
  candidates: WarmCandidate[] | null | undefined,
  now: number = Date.now(),
  limit: number = WARM_BATCH_LIMIT,
  ttlMs: number = WARM_SNAPSHOT_TTL_MS
): string[] => {
  const stale = (c: WarmCandidate) => c.savedAt === null || now - c.savedAt >= ttlMs;
  const wanted = (candidates || []).filter(
    (c) => !!c && typeof c.leadId === 'string' && c.leadId.trim() !== '' && stale(c)
  );
  wanted.sort((a, b) => {
    if ((a.savedAt === null) !== (b.savedAt === null)) return a.savedAt === null ? -1 : 1;
    return (a.savedAt || 0) - (b.savedAt || 0);
  });
  return wanted.slice(0, Math.max(0, limit)).map((c) => c.leadId.trim());
};

export const matchAppointmentForLead = (
  appointments: any[] | null | undefined,
  lead: any
): string | null => {
  const direct = lead?.appointmentId;
  if (direct) return String(direct);
  const human = lead?.leadId;
  const selfGen = lead?._id || lead?.selfGenLeadId || lead?.id;
  const found = (appointments || []).find(
    (a: any) =>
      (a?.leadId && a.leadId !== 'N/A' && String(a.leadId) === String(human)) ||
      (a?.selfGenLeadId && a.selfGenLeadId !== 'N/A' && String(a.selfGenLeadId) === String(selfGen))
  );
  return found ? String(found._id || found.id) : null;
};
