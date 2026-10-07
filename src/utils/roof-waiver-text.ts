function formatProductList(products?: (string | null | undefined)[]): string {
  const list = (products || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and/or ${list[list.length - 1]}`;
}

export interface RoofWaiverTextArgs {
  companyName?: string | null;
  products?: (string | null | undefined)[];
}

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
