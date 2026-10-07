import CATALOG from '../../constants/revrender-looks.json';
import { ENV } from '../../config/env';
import { LeadService } from '../../services/api/leads';
import { Storage } from '../storage';
import { Look, LookGroup, LookTab } from './types';

const CACHE_KEY = `revrender_look_catalogue_v1_${ENV.API_URL}`;

const normalize = (raw: any[]): Look[] =>
  raw.map((l) => ({ ...l, id: l?.lookId ?? l?.id })).filter((l) => Boolean(l.id)) as Look[];

let LOOKS: Look[] = normalize(CATALOG as unknown as any[]);
let version: string | null = null;

export function allLooks(): Look[] {
  return LOOKS;
}

export function catalogueVersion(): string | null {
  return version;
}

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

export function seasonsSections(): { everyday: Look[]; holidays: Look[] } {
  const everyday = LOOKS.filter((l) => l.group === 'everyday');
  const holidays = LOOKS.filter((l) => l.group === 'season').sort((a, b) => {
    const m = MONTHS.indexOf(a.month ?? '') - MONTHS.indexOf(b.month ?? '');
    return m !== 0 ? m : a.name.localeCompare(b.name);
  });
  return { everyday, holidays };
}

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
