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
