/**
 * Which Messages rows can jump into the My Deals flow (REVUIUX-552).
 *
 * Three buckets qualify: a sold job waiting to be installed, one installing
 * today, and a lead a manager sent back to the rep for rehash that has not
 * been resulted yet. Already Installed deliberately does not — there is no
 * deal left for the rep to work.
 *
 * The same predicates drive both the filter list and whether the job number /
 * lead id is tappable, so the two cannot drift apart.
 */

/** Mirrors the backend list; a lead leaves the rehash bucket once resulted. */
export const RESULTED_STATUSES = [
  'sale',
  'demoNoSale',
  'noDemo',
  'notHit',
  'cancelled',
  'rehash',
  'reset',
  'completed',
  'demo',
];

/**
 * Sent back to a rep from the Rehash Center and still open. Note `isRehashed`
 * is the flag the Rehash Center sets, while the 'rehash' *status* is the rep's
 * own result and takes the lead out of this bucket.
 */
export function isPendingRehash(leadDetails: any): boolean {
  if (!leadDetails?.isRehashed) return false;
  return !RESULTED_STATUSES.includes(leadDetails?.status || '');
}

// The server resolves these off the job builder; the row cannot work them out
// itself (REVUIUX-552). `installBucket` is 'Pending Install' | 'Installing
// Today' | 'Already Installed' | null.
export type InstallBucket = 'Pending Install' | 'Installing Today' | 'Already Installed';

/**
 * ⚠️ `installBucket` IS NOT ON EVERY LEAD SHAPE, and that is what broke the chat
 * header for Pending Install / Installing Today.
 *
 * The Messages LIST gets its leads from the socket (`all-lead-chats-response`), and the
 * backend computes `installBucket` into that payload. The chat HEADER does not: it is
 * reached from pushes and notifications too, so it refetches the lead by id
 * (`lead/v1/details/:id`) - a generic lead read that carries no `installBucket` at all.
 * So the header asked a question the REST lead could never answer, both predicates
 * returned false, and the title was not tappable for those two buckets. Pending Rehash
 * kept working only because `isRehashed` / `status` DO come back from that endpoint.
 *
 * So: use the server's bucket whenever we have it, and otherwise derive the same answer
 * from the fields the REST lead does carry. The derivation is the pre-f55b9263 rule and
 * is a FALLBACK ONLY - when the backend has spoken the backend wins, because it resolves
 * the bucket off the job builder and we cannot.
 */
export function installBucketOf(leadDetails: any): InstallBucket | null {
  const fromServer = leadDetails?.installBucket;
  if (fromServer === 'Pending Install' || fromServer === 'Installing Today') return fromServer;
  if (fromServer === 'Already Installed') return 'Already Installed';

  const installationDate = leadDetails?.installationDate;
  if (!installationDate) return null;

  // Compare as TEXT (CLAUDE.md §6): `new Date()` on an ISO string shifts the calendar day
  // by the device's timezone offset, which would call tomorrow's install "today".
  const day = String(installationDate).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return 'Installing Today';
  if (day > today) return leadDetails?.status === 'sale' ? 'Pending Install' : null;
  return 'Already Installed';
}

export function isPendingInstall(leadDetails: any): boolean {
  return installBucketOf(leadDetails) === 'Pending Install';
}

export function isInstallingToday(leadDetails: any): boolean {
  return installBucketOf(leadDetails) === 'Installing Today';
}

/** Whether tapping this row's job number or lead id should open the deal. */
export function canOpenDeal(leadDetails: any): boolean {
  return (
    isPendingRehash(leadDetails) ||
    isPendingInstall(leadDetails) ||
    isInstallingToday(leadDetails)
  );
}
