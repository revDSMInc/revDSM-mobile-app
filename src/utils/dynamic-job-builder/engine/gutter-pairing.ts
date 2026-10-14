/**
 * My Deals, Gutters tab: a gutter combination and its downspout are ONE pair ("Combination #1" is written on
 * both). The tab has a gutter combination section plus a "Downspout & Accessories" combination section, and
 * the single universal Add Combination button has to know which of the two the next press is for.
 *
 * Pure on purpose (no React Native) so it can be unit tested. Other tabs never match `getGutterPairSections`.
 */

const DOWNSPOUT_LABEL = /downspout/i;

export interface GutterPair {
  primary: any[];
  downspout: any;
}

const isGuttersTab = (tab: any): boolean =>
  /(^|__)gutters$/i.test(String(tab?.id || '')) || String(tab?.label || '').trim().toLowerCase() === 'gutters';

/** The gutter + downspout combination sections of a Gutters tab, or null for any other tab / shape. */
export function getGutterPairSections(tab: any, combinationSections: any[] = []): GutterPair | null {
  if (!isGuttersTab(tab)) return null;
  const downspout = combinationSections.find((s: any) => DOWNSPOUT_LABEL.test(String(s?.label || '')));
  const primary = combinationSections.filter((s: any) => s && s !== downspout);
  if (!downspout || !primary.length) return null;
  return { primary, downspout };
}

/** A gutter with no downspout yet makes the next Add Combination press a downspout; otherwise a new gutter. */
export function nextPairAddTarget(gutterCount: number, downspoutCount: number): 'primary' | 'downspout' {
  return gutterCount > downspoutCount ? 'downspout' : 'primary';
}

/** "Downspout & Accessories" only shows when it has a card or is where the next press will add one. */
export function shouldShowDownspoutHeading(gutterCount: number, downspoutCount: number): boolean {
  return downspoutCount > 0 || gutterCount > downspoutCount;
}

/**
 * My Deals Soffit and Fascia: every section has its own Add Combination, and a combination shows only when the Deal
 * Center sent values for it (see `isSoffitComboEmptyInDealEdit`).
 */
export function usesPerSectionAdd(tab: any): boolean {
  return (
    /(^|__)(soffit|fascia)$/i.test(String(tab?.id || '')) ||
    ['soffit', 'fascia'].includes(String(tab?.label || '').trim().toLowerCase())
  );
}
