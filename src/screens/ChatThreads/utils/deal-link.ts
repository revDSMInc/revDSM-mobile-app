/**
 * Which Messages rows can jump into the My Deals flow (REVUIUX-552).
 *
 * Three buckets qualify: a sold job waiting to be installed, one installing
 * today, and a lead a manager sent back to the rep for rehash that has not
 * been resulted yet. Already Installed deliberately does not - there is no
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

export function isPendingInstall(leadDetails: any): boolean {
  if (leadDetails?.status !== 'sale' || !leadDetails?.installationDate) return false;
  return new Date(leadDetails.installationDate).getTime() > Date.now();
}

export function isInstallingToday(leadDetails: any): boolean {
  const installationDate = leadDetails?.installationDate;
  if (!installationDate) return false;
  return String(installationDate).startsWith(new Date().toISOString().split('T')[0]);
}

/** Whether tapping this row's job number or lead id should open the deal. */
export function canOpenDeal(leadDetails: any): boolean {
  return (
    isPendingRehash(leadDetails) ||
    isPendingInstall(leadDetails) ||
    isInstallingToday(leadDetails)
  );
}
