export type LookGroup = 'everyday' | 'season' | 'team' | 'theme' | 'custom';

export type LookPattern = 'single' | 'alternating';

export type LookTab = 'seasons' | 'teams' | 'themes' | 'custom';

export interface Look {
  id: string;
  group: LookGroup;
  category: string;
  month?: string;
  name: string;
  colors: string[];
  pattern: LookPattern;
  /** Team rows only (REVUIUX-483 §10) — absent, not null, elsewhere. */
  lat?: number;
  lng?: number;
  state?: string;
  tier?: 'pro' | 'college';
}

export interface CustomLook extends Look {
  group: 'custom';
  category: 'Custom';
  createdAt: number;
}
