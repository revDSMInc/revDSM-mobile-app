/**
 * revRender Roofline Lighting (REVUIUX-483).
 *
 * 483 supersedes the earlier vendor spec: the rep picks a LOOK and nothing else.
 * No components, no cover type, no channel colour, no Lights Off, no time of
 * day. The channel matches the home's existing trim and the scene is always
 * dusk, so the only choice is the lighting.
 */

/** Catalogue groups, as shipped in revrender-looks.json. */
export type LookGroup = 'everyday' | 'season' | 'team' | 'theme' | 'custom';

/** Derived from the colour count — never chosen by the rep (483 §8). */
export type LookPattern = 'single' | 'alternating';

/** The four tabs under "Browse Looks". */
export type LookTab = 'seasons' | 'teams' | 'themes' | 'custom';

export interface Look {
  id: string;
  group: LookGroup;
  /** Everyday, a month, a league/conference, or a theme category. */
  category: string;
  /** Present on seasonal looks: 'Jan' … 'Dec'. */
  month?: string;
  name: string;
  /** Hex strings, as they should appear when lit. */
  colors: string[];
  pattern: LookPattern;
}

/** A look the rep built in the Custom tab. */
export interface CustomLook extends Look {
  group: 'custom';
  category: 'Custom';
  createdAt: number;
}
