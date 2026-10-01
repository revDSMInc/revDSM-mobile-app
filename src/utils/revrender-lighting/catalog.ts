import CATALOG from '../../constants/revrender-looks.json';
import { Look, LookGroup, LookTab } from './types';

/**
 * The 357-look catalogue, bundled.
 *
 * Bundled rather than fetched for now. 483 §13 lists team colours, the Utah Jazz
 * rebrand, conference realignment and the country list as still to verify, so a
 * correction currently needs an app release — the catalogue is behind
 * `allLooks()` precisely so it can be swapped for a fetched one without touching
 * any caller.
 */
const LOOKS = CATALOG as unknown as Look[];

export function allLooks(): Look[] {
  return LOOKS;
}

export function findLook(id: string, customs: Look[] = []): Look | undefined {
  return LOOKS.find((l) => l.id === id) ?? customs.find((l) => l.id === id);
}

const TAB_GROUPS: Record<LookTab, LookGroup[]> = {
  seasons: ['everyday', 'season'],
  teams: ['team'],
  themes: ['theme'],
  custom: ['custom'],
};

export function looksForTab(tab: LookTab, customs: Look[] = []): Look[] {
  if (tab === 'custom') return customs;
  const groups = TAB_GROUPS[tab];
  return LOOKS.filter((l) => groups.includes(l.group));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Seasons tab: Everyday first in catalogue order, then holidays sorted by
 * calendar month and then by name (483 §4).
 */
export function seasonsSections(): { everyday: Look[]; holidays: Look[] } {
  const everyday = LOOKS.filter((l) => l.group === 'everyday');
  const holidays = LOOKS.filter((l) => l.group === 'season').sort((a, b) => {
    const m = MONTHS.indexOf(a.month ?? '') - MONTHS.indexOf(b.month ?? '');
    return m !== 0 ? m : a.name.localeCompare(b.name);
  });
  return { everyday, holidays };
}

/** Categories within a tab, in the order the sheet should list them. */
export function categoriesForTab(tab: LookTab, customs: Look[] = []): { name: string; count: number }[] {
  const byName = new Map<string, number>();
  for (const l of looksForTab(tab, customs)) {
    byName.set(l.category, (byName.get(l.category) ?? 0) + 1);
  }
  return [...byName.entries()].map(([name, count]) => ({ name, count }));
}

export function looksInCategory(tab: LookTab, category: string, customs: Look[] = []): Look[] {
  return looksForTab(tab, customs)
    .filter((l) => l.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "Now" / "Next" tags on the Seasons tab, computed from the device date.
 * Nothing is preselected — these are labels only (483 §4).
 */
export function monthTags(now: Date = new Date()): { now: string; next: string } {
  const i = now.getMonth();
  return { now: MONTHS[i], next: MONTHS[(i + 1) % 12] };
}

export function tagForLook(look: Look, now: Date = new Date()): 'now' | 'next' | null {
  if (look.group !== 'season' || !look.month) return null;
  const tags = monthTags(now);
  if (look.month === tags.now) return 'now';
  if (look.month === tags.next) return 'next';
  return null;
}
