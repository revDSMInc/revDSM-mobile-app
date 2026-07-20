// The Roof Waiver Agreement the customer signs.
//
// Port of web `src/utils/roof-waiver-text.js`. The copy used to be inlined in the
// waiver modal, naming LeafFilter and its two products directly. It is built here
// instead so the company and its products are named once, from data.

/** "A", "A and/or B", "A, B and/or C" — matches the original's "and/or" phrasing. */
function formatProductList(products?: (string | null | undefined)[]): string {
  const list = (products || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and/or ${list[list.length - 1]}`;
}

export interface RoofWaiverTextArgs {
  /** From the auth user (`user.companyName`). */
  companyName?: string | null;
  /** Published product names (`useRepProducts`). */
  products?: (string | null | undefined)[];
}

/**
 * Both inputs fall back to generic wording when absent, so a company with no name
 * or no published products still gets a complete, signable paragraph rather than a
 * sentence with a hole in it. That matters more than usual here: the fallback is
 * also what renders while the products request is still in flight.
 *
 * Note the web keeps a literal 'LeafFilter' company fallback; mobile uses the
 * neutral "the company" wording instead, since the whole point of the ticket is
 * that no tenant should ever be shown another tenant's brand.
 */
export function buildRoofWaiverText({ companyName, products = [] }: RoofWaiverTextArgs = {}): string {
  const company = String(companyName || '').trim() || 'the company';
  const installs = formatProductList(products) || 'gutters and/or gutter protection';

  return (
    `I have contracted ${company} to install ${installs} on my home. ` +
    `I understand that the installer(s) must walk on my roof during the installation, ` +
    `in order to properly install the job. I will allow the installer(s) to walk on my ` +
    `roof during the installation process. I understand that neither ${company} nor the ` +
    `installer(s) will be held responsible for any alleged damage caused to the roof, ` +
    `thus waiving ${company} and the installer(s) from any and all liability concerning ` +
    `the roof, its components and any alleged damage resulting from walking on the roof. ` +
    `I understand that the ${company} warranty will only cover the installation, and not ` +
    `the potential damage caused by walking on the roof.`
  );
}
