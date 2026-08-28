import { useQuery } from '@tanstack/react-query';
import { ApprovalService, type ApproverFeed } from '../../../services/api/FundingService';
import { useAuth } from '../../../hooks/useAuth';
import { normalizeApproverFeed } from '../utils/funding';

/**
 * Who may approve a refund for this company — `GET /lead/v1/approvals/approvers?type=refund`.
 *
 * ⚠️ **This is the ONLY way to get the list, and there is no client-side substitute.**
 * The company config stores ROLE ids, not people; this endpoint is the join, and it
 * is the same rule the `decide` guard enforces server-side. Filtering a user list in
 * the app would produce a picker whose choices the server then refuses. It is also
 * the only user-list API the mobile client has at all — chat participants are a
 * different set entirely.
 *
 * House pattern, matching `useDealPricing`: TanStack Query, a company-scoped key,
 * `staleTime: 5 min`, `retry: 1`. Approver config changes about as often as a company
 * reorganises, so a five-minute window is generous.
 */
export function useRefundApprovers(enabled = true, companyIdOverride?: string) {
  const { user } = useAuth();
  /**
   * ⚠️ The LEAD's company wins where the caller has one. `useFunding` is already
   * called as `useFunding(leadId, lead?.companyId || user?.companyId, …)`, and the
   * approver list has to be scoped exactly as the refund request that follows it —
   * offering a picker from one company and posting the request under another is a
   * guaranteed 403 at `decide` time.
   */
  const companyId = companyIdOverride || user?.companyId;
  const userId = user?._id || user?.id;

  const query = useQuery({
    // Company-scoped: two companies' approver lists must never share a cache entry.
    queryKey: ['refundApprovers', companyId || 'none'],
    queryFn: async (): Promise<ApproverFeed> => {
      try {
        const res = await ApprovalService.approvers('refund', companyId, userId);
        // ⚠️ The shape rule is pure and lives in `utils/funding.ts` — see
        // `normalizeApproverFeed`, which is what decides that a non-empty list counts
        // as configured even on a response that omits the flag.
        const feed = normalizeApproverFeed(res?.data);
        if (__DEV__) {
          console.log('[refundApprovers] loaded', feed.approvers.length, 'approver(s)', {
            isConfigured: feed.isConfigured,
            allowSelfApproval: feed.allowSelfApproval,
            roles: feed.roles.length,
          });
        }
        return feed;
      } catch (err: any) {
        // ⚠️ Logged rather than swallowed. "The endpoint is never called" and "it was
        // called and rejected" are the two explanations for an empty picker and they
        // have completely different fixes — the axios wrapper already prints the
        // request line, so this pair tells them apart. Same precedent as `usePitchBooks`.
        if (__DEV__) {
          console.log('[refundApprovers] FAILED', err?.response?.status, err?.response?.data || err?.message);
        }
        throw err;
      }
    },
    /**
     * ⚠️ **Deliberately NOT gated on `companyId`.** It used to be
     * `enabled && !!companyId`, and that is why the request was never made at all on a
     * profile that does not carry one: no console line, an empty dropdown, and a
     * "No approvers configured" message that had never asked the server anything. The
     * route is authenticated by the JWT, which already scopes the company; `companyid`
     * is a header convention that `cfg()` omits when absent, exactly as every other
     * funding call does.
     */
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const approvers = query.data?.approvers || [];

  return {
    feed: query.data || null,
    approvers,
    /**
     * ⚠️ Only ever `true` off a SUCCESSFUL read. A failed one leaves this false, which
     * disables the refund action — the right way to be wrong, since the request would
     * fail anyway. But the caller must render `isError` differently from a configured
     * `false`: one is "retry", the other is "ask your admin", and only one of them is
     * the rep's problem.
     */
    isConfigured: query.isSuccess && query.data?.isConfigured === true,
    allowSelfApproval: query.data?.allowSelfApproval === true,
    // ⚠️ Not a bare `isFetching`: a background revalidation would swap a chosen
    // approver back to "Loading approvers…" under the rep. It reports loading only
    // while there is nothing to show, which also covers a retry after a failed read.
    isLoading: query.isLoading || (query.isFetching && approvers.length === 0),
    isError: query.isError,
    refetch: query.refetch,
  };
}
