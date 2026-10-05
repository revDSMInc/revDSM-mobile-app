import CATALOG from '../../constants/revrender-looks.json';
import { ENV } from '../../config/env';
import { LeadService } from '../../services/api/leads';
import { Storage } from '../storage';
import { Look, LookGroup, LookTab } from './types';

/**
 * The 357-look catalogue — served by the backend, seeded from the bundle.
 *
 * Server-owned since 1 Oct: 483 §13 lists team colours, the Utah Jazz rebrand,
 * conference realignment and the country list as unverified, plus Marvel/DC
 * names pending legal. Bundled, every correction needed an app release.
 *
 * ⚠️ The accessors stay SYNCHRONOUS. `LOOKS` is a module-level value that
 * `hydrateFromCache()` and `refreshCatalogue()` replace; making `allLooks()`
 * async would ripple through every consumer for no benefit.
 */

/**
 * ⚠️ KEYED ON THE API HOST, deliberately.
 *
 * A single shared key carries the previous environment's catalogue — AND ITS
 * VERSION TAG — across a switch of `API_URL` between local, dev and np. Worse:
 * if two environments ever mint the same version string the backend answers 304
 * and the app keeps the wrong catalogue indefinitely, with nothing on screen
 * saying so. The module-level `version` is reset alongside the key.
 */
const CACHE_KEY = `revrender_look_catalogue_v1_${ENV.API_URL}`;

/**
 * ⚠️ `lookId`, not `id`. The API names it `lookId`; everything in this app
 * keys on `id`. Miss this and every tile renders with an undefined key, which
 * shows up as selection toggling the wrong tile rather than as a crash.
 */
const normalize = (raw: any[]): Look[] =>
  raw.map((l) => ({ ...l, id: l?.lookId ?? l?.id })).filter((l) => Boolean(l.id)) as Look[];

/** The bundle is the SEED, so the grid is never empty on a first run with no signal. */
let LOOKS: Look[] = normalize(CATALOG as unknown as any[]);
let version: string | null = null;

export function allLooks(): Look[] {
  return LOOKS;
}

/** The catalogue version currently held, for tests and diagnostics. */
export function catalogueVersion(): string | null {
  return version;
}

/**
 * Load a previously fetched catalogue off the device. Call before the first
 * paint so a rep with no signal still gets the corrected list, not the bundle.
 */
export function hydrateFromCache(): boolean {
  try {
    const raw = Storage.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const looks = normalize(parsed?.looks ?? []);
    // ⚠️ An empty cache must NOT replace the seed — see `refreshCatalogue`.
    if (!looks.length) return false;
    LOOKS = looks;
    version = parsed?.version ?? null;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch the catalogue. Returns true only when the in-memory list changed.
 *
 * ⚠️ AN EMPTY LIST IS A FAILURE, NOT AN ANSWER. np currently returns
 * `count: 0` because its database is unseeded, and treating that as truth would
 * blank the grid on a screen whose whole job is picking a look. Keep whatever is
 * already loaded.
 *
 * ⚠️ A 304 means "yours is current" and carries an EMPTY BODY — reading
 * `res.data.looks` on it would look exactly like the empty-list failure above.
 * It is checked first.
 */
export async function refreshCatalogue(): Promise<boolean> {
  try {
    const res = await LeadService.getRevRenderLooks(version ?? undefined);
    if (res.status === 304) return false;

    const looks = normalize(res.data?.looks ?? []);
    if (!looks.length) return false;

    LOOKS = looks;
    version = res.data?.version ?? null;
    Storage.setItem(CACHE_KEY, JSON.stringify({ version, looks: res.data?.looks }));
    return true;
  } catch {
    // Offline or a server error: the seed (or the cache) stands.
    return false;
  }
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
