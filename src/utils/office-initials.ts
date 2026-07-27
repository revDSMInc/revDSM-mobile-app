/**
 * Office-initials helpers — 1:1 port of the web `src/utils/office-initials.js`.
 *
 * Used to prefix a resulted lead's job/lead number with its office abbreviation
 * (e.g. "FL803", "STN/A"), matching the web job builder and chat thread list.
 *
 * Logic (mirrors the web `agreement-dialog.js`):
 *  1. Office name from `repDetails.office[0].name` or `repDetails.officeName`.
 *  2. Look it up in the US-state abbreviations map (e.g. "Florida" → "FL").
 *  3. If not in the map, take the first 2 chars uppercased (e.g. "Tampa" → "TA").
 *  4. If no name at all, fall back to `office[0].code`.
 *  5. Final fallback: empty string.
 */

const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

/** e.g. "FL", "TA", "GA" — empty string when nothing resolvable. */
export function getOfficeInitials(repDetails: any): string {
  const officeName = repDetails?.office?.[0]?.name || repDetails?.officeName || '';
  if (officeName) {
    const cleanName = String(officeName).trim().toLowerCase();
    return STATE_ABBREVIATIONS[cleanName] || String(officeName).substring(0, 2).toUpperCase();
  }
  return repDetails?.office?.[0]?.code || '';
}

/** officeInitials + leadId/jobNumber, e.g. "FL803", "STN/A" (bare number when no initials). */
export function buildJobNumber(repDetails: any, leadNum: string | number): string {
  const initials = getOfficeInitials(repDetails);
  return initials ? `${initials}${leadNum}` : String(leadNum ?? 'N/A');
}
