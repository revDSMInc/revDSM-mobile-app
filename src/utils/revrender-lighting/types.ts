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
}

export interface CustomLook extends Look {
  group: 'custom';
  category: 'Custom';
  createdAt: number;
}
