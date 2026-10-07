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

export function getOfficeInitials(repDetails: any): string {
  const officeName = repDetails?.office?.[0]?.name || repDetails?.officeName || '';
  if (officeName) {
    const cleanName = String(officeName).trim().toLowerCase();
    return STATE_ABBREVIATIONS[cleanName] || String(officeName).substring(0, 2).toUpperCase();
  }
  return repDetails?.office?.[0]?.code || '';
}

export function buildJobNumber(repDetails: any, leadNum: string | number): string {
  const initials = getOfficeInitials(repDetails);
  return initials ? `${initials}${leadNum}` : String(leadNum ?? 'N/A');
}
