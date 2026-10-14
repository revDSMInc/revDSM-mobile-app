/**
 * One page of My Deals, normalised so it can be cached and replayed offline.
 *
 * The screen used to read the raw axios body inline and, on any failure, call `setLeads([])` -
 * so with no signal the rep saw **"No leads found"** on a list of deals they had already sold.
 * An empty list is indistinguishable from "you have no deals", which is the worst possible
 * reading of a connection problem.
 *
 * Pure (CLAUDE.md section 6): no React Native import, so the shape handling is testable.
 */

export interface DealsPage {
  leads: any[];
  totalPages: number;
}

/**
 * Pull the rows and page count out of whatever shape the endpoint returned.
 *
 * ⚠️ The envelope is inconsistent across this API - rows arrive as `data.leads` or `leads`,
 * and pagination as `pagination` or `data.pagination`. Both spellings are live; normalise
 * here rather than at each call site.
 */
export const toDealsPage = (res: any, pageLimit: number): DealsPage => {
  const body = res?.data || {};
  const rows = body?.data?.leads || body?.leads || [];
  const pagination = body?.pagination || body?.data?.pagination || {};
  const total = Number(pagination.total) || 0;
  const totalPages =
    Number(pagination.totalPages) ||
    Number(pagination.total_pages) ||
    (total > 0 && pageLimit > 0 ? Math.ceil(total / pageLimit) : 0);
  return { leads: Array.isArray(rows) ? rows : [], totalPages };
};
