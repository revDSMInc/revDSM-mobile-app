/**
 * offline-deal-center.ts — which copy of a lead's Deal Center the rep is shown with no signal.
 *
 * Split out of `useDynamicCalculators` for the reason `utils/addendum-drafts.ts` and
 * `utils/session-scope.ts` exist: the hook pulls in axios, MMKV and the whole calculator engine and
 * cannot be loaded under jest, while the choice it makes here is exactly the kind that fails
 * SILENTLY. Getting it wrong does not throw — it either shows the rep an empty Deal Center on a
 * lead they have already quoted, or files a SECOND calculator alongside the ones the server holds.
 * Both were reported from the field.
 */

/** The snapshot kept while online so the same lead's Deal Center can open with no signal. */
export interface CachedDealCenter {
  /**
   * ⚠️ Cached with the calculators, not re-resolved offline, and it is load-bearing.
   * `resolveAppointmentId` CREATES an appointment when it cannot find one, so a device that has
   * forgotten the id would file a duplicate appointment for a lead that already has one — and hang
   * the rep's offline calculators off it.
   */
  appointmentId?: string | null;
  /** The server rows verbatim, so the offline hydrate is the same mapping as the online one. */
  calculators: unknown[];
}

/** The cache is per LEAD, so one lead's quote can never open under another. */
export const DEAL_CENTER_CALC_CACHE = 'deal-center-calculators';

export const dealCenterCacheName = (leadId: unknown): string | null => {
  const id = leadId === null || leadId === undefined ? '' : String(leadId).trim();
  return id ? `${DEAL_CENTER_CALC_CACHE}:${id}` : null;
};

/** The rows of a snapshot, or `[]` for anything that is not one. */
export const cachedCalculatorsOf = (
  snapshot: CachedDealCenter | null | undefined
): unknown[] => (Array.isArray(snapshot?.calculators) ? (snapshot as CachedDealCenter).calculators : []);

export type OfflineDealCenterSource =
  /** The device record — it holds writes the server has not got, so it can only be newer. */
  | 'device'
  /** The snapshot taken while online — the rep's real quote, with its real ids. */
  | 'cache'
  /** Nothing exists anywhere, and we KNOW that. Safe to start the first calculator. */
  | 'mint'
  /** The server may hold a quote we have never seen. Show nothing rather than a rival copy. */
  | 'unavailable';

/**
 * ⚠️ The whole point of `'unavailable'` is that "the server has no calculators" and "we do not know
 * what the server has" are DIFFERENT, and the app used to treat them the same — it minted a fresh
 * calculator whenever the device record was empty.
 *
 * On a lead the rep had already quoted online that produced the reported bug twice over: an empty
 * Deal Center at the door (their real quote was on the server, unread), and then a phantom fourth
 * tab beside `G` / `S` / `FWrap` once the queue drained, because the mint was POSTed as a new
 * calculator. The rep believed they were continuing their quote and had in fact started a rival one.
 *
 * Minting is only safe when the emptiness is KNOWN — either the lead was created on this device (so
 * the server has never heard of it) or we hold a snapshot that says the server has none.
 */
export const resolveOfflineDealCenterSource = (input: {
  /** `work.calculators.length` — what this device is already holding for the lead. */
  storedCalculators?: number | null;
  /** The snapshot for THIS lead, or null when none was ever taken. */
  cached?: CachedDealCenter | null;
  /** The lead itself only exists on this device (created at a door, or a client id). */
  leadCreatedOffline?: boolean;
  /**
   * The device's calculators have ALL reached the server already (nothing pending).
   *
   * ⚠️ Then the device copy is not newer than the server — the rep may have kept quoting online
   * since, which is what the snapshot records. Preferring the device there would paint a stale quote
   * and PUT it back over the newer one on the next edit. So a drained record only wins when there is
   * no snapshot to prefer.
   */
  storedDrained?: boolean;
}): OfflineDealCenterSource => {
  const snapshotHasRows = !!input.cached && cachedCalculatorsOf(input.cached).length > 0;
  if ((input.storedCalculators || 0) > 0 && !(input.storedDrained && snapshotHasRows)) return 'device';
  // A snapshot is proof of what the server held. Empty is an ANSWER, not an absence.
  if (input.cached) return cachedCalculatorsOf(input.cached).length > 0 ? 'cache' : 'mint';
  return input.leadCreatedOffline ? 'mint' : 'unavailable';
};

// ─── Warming the snapshot from the Leads list ─────────────────────────────────

/**
 * How long a snapshot is treated as fresh enough to skip re-warming.
 *
 * ⚠️ A balance, not a guess. Too short and a rep with thirty issued leads re-reads all of them
 * every hour of the shift; too long and a quote edited on the portal is stale at the door. Six
 * hours re-warms roughly twice a working day, and the Deal Center's own save keeps the snapshot
 * current for any lead the rep is actually working.
 */
export const WARM_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

/** At most this many leads are read per pass, so a long list cannot become a request storm. */
export const WARM_BATCH_LIMIT = 12;

export interface WarmCandidate {
  leadId: string;
  /** `savedAt` of the snapshot already held, or null when there is none. */
  savedAt: number | null;
}

/**
 * Which leads are worth reading, and in what order.
 *
 * ⚠️ Leads with NO snapshot come first, and that ordering is the point rather than a nicety: those
 * are the ones that would show "This quote isn't saved on your device" at a door. A lead that
 * already has a slightly stale copy can still be opened and quoted; one with none cannot.
 */
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
  // Never-cached first, then oldest first among the rest.
  wanted.sort((a, b) => {
    if ((a.savedAt === null) !== (b.savedAt === null)) return a.savedAt === null ? -1 : 1;
    return (a.savedAt || 0) - (b.savedAt || 0);
  });
  return wanted.slice(0, Math.max(0, limit)).map((c) => c.leadId.trim());
};

/**
 * The appointment for a lead, out of a list the caller already fetched.
 *
 * ⚠️ A READ, and only a read. `resolveAppointmentId` in the Deal Center falls through to
 * `POST /appointments` when it finds nothing — correct there, because the rep is about to quote —
 * and catastrophic here: a background warm over a whole leads list would file an appointment for
 * every lead the rep has merely been assigned.
 *
 * ⚠️ `'N/A'` is a real stored value for a self-gen lead's `leadId`, so matching on it would pair
 * every self-gen lead with the first self-gen appointment of the day.
 */
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
