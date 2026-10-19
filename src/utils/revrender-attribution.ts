/**
 * Which lead a batch of revRender results belongs to.
 *
 * ⚠️ REPORTED BY A CLIENT: "revRender generated in another lead" - a gutter lead showing 50 runs
 * of Christmas-light renders that belonged to a different property.
 *
 * `useLeadReports(lead, refetch)` is bound to ONE Lead Center, and its `handleStartRevRenders` is
 * handed to the RevRender screen as a NAVIGATION PARAM (`onGenerate` / `onGenerateAll`). A
 * function passed that way is a closure over the lead of whichever Lead Center pushed the screen.
 * With two Lead Centers in the stack - a push notification, the Notifications screen or chat
 * opening lead B while lead A sits below - RevRender called lead A's closure, and the job-list
 * storage key, the pre-gen run fetch and the final cache invalidation all named lead A.
 *
 * RevRender always sent the right id (`{ payloads, leadId, jobId }`); the caller dropped it.
 *
 * Pure so it can be tested - the hook imports React Native (CLAUDE.md §6).
 */

/**
 * The lead to file renders under.
 *
 * ⚠️ The id RevRender sends WINS. The hook's own lead is only a fallback for a caller that sends
 * nothing; preferring the closure is precisely what misfiled the runs.
 */
export const renderTargetLeadId = (
  sentLeadId?: string | null,
  hookLeadId?: string | null
): string => String(sentLeadId || hookLeadId || '');

/**
 * Should the hook's own `refetch` run when the batch finishes?
 *
 * ⚠️ `refetch` belongs to the hook's lead. When the renders were for a DIFFERENT lead, calling it
 * refreshes a screen the results have nothing to do with - and leaves the lead that does own them
 * unrefreshed. Only refresh when the two are the same lead.
 */
export const shouldRefetchAfterRenders = (
  renderLeadId?: string | null,
  hookLeadId?: string | null
): boolean => !!renderLeadId && String(renderLeadId) === String(hookLeadId || '');

/**
 * ⚠️ REPORTED AGAIN: "revRender showing in another lead." A lead with **0 photos** displayed
 * "13 Runs" belonging to other leads.
 *
 * This is a READ bug, distinct from `renderTargetLeadId` above (which fixes attribution at
 * GENERATE time). Two separate causes, both of which these helpers close:
 *
 * 1. ⚠️ **A device-only lead asked the server about itself.** An offline-created lead's `_id`
 *    is a client id (`lead-1760...`), and `GET /rev-render/v1/runs?leadId=<clientId>` was sent
 *    anyway. A server that ignores or fails to match an unknown `leadId` answers with
 *    *something* - and whatever it returns is rendered as this lead's history. The lead cannot
 *    possibly have server-side runs, so the request must never be made.
 *
 * 2. ⚠️ **Nothing checked that a returned run belongs to this lead.** The mapper dropped each
 *    run's own `leadId`, so one bad response could not be detected downstream, and it was then
 *    written into the per-lead offline cache where it persisted.
 */

/** May we ask the server for this lead's render runs at all? */
export const canFetchRenderRuns = (leadId: unknown): boolean => {
  const id = String(leadId ?? '').trim();
  if (!id) return false;
  // A client id exists only on this device; the server has nothing to match it against.
  return !/^(lead|appt|calc|work)-\d{10,}-/.test(id);
};

/**
 * Keep only the runs that actually belong to `leadId`.
 *
 * ⚠️ A run carrying NO lead id is KEPT. Older runs predate the field, and dropping them would
 * silently erase real render history - the opposite failure, and the harder one to notice. We
 * only reject a run that positively names a DIFFERENT lead.
 */
export const runsBelongingToLead = <T extends Record<string, any>>(
  runs: T[] | null | undefined,
  leadId: unknown
): T[] => {
  const want = String(leadId ?? '').trim();
  if (!Array.isArray(runs)) return [];
  if (!want) return [];
  return runs.filter((r) => {
    const owner = String(r?.leadId ?? r?.lead_id ?? r?.lead?._id ?? r?.lead ?? '').trim();
    return owner === '' || owner === want;
  });
};
