import { Look } from './types';

export const RECENTS_LIMIT = 3;

export interface LightingState {
  sel: string[];
  fav: string[];
  recent: string[];
  customs: Look[];
}

export const emptyState = (): LightingState => ({ sel: [], fav: [], recent: [], customs: [] });

export function toggleSelected(state: LightingState, lookId: string): LightingState {
  const sel = state.sel.includes(lookId)
    ? state.sel.filter((id) => id !== lookId)
    : [...state.sel, lookId];
  return { ...state, sel };
}

export function isSelected(state: LightingState, lookId: string): boolean {
  return state.sel.includes(lookId);
}

export function selectedCountIn(state: LightingState, looks: Look[]): number {
  const ids = new Set(looks.map((l) => l.id));
  return state.sel.filter((id) => ids.has(id)).length;
}

export function toggleFavourite(state: LightingState, lookId: string): LightingState {
  const fav = state.fav.includes(lookId)
    ? state.fav.filter((id) => id !== lookId)
    : [lookId, ...state.fav];  // newest first
  return { ...state, fav };
}

export function isFavourite(state: LightingState, lookId: string): boolean {
  return state.fav.includes(lookId);
}

function toCustomLook(raw: any): Look | null {
  const id = raw?.lookId ?? raw?.id;
  const colors = Array.isArray(raw?.colors)
    ? raw.colors.filter((c: unknown): c is string => typeof c === 'string' && c.length > 0)
    : [];
  if (typeof id !== 'string' || !id || !colors.length) return null;
  return {
    id,
    group: 'custom',
    category: 'Custom',
    name: typeof raw?.name === 'string' && raw.name ? raw.name : 'Custom look',
    colors,
    pattern: raw?.pattern === 'single' || colors.length === 1 ? 'single' : 'alternating',
  } as Look;
}

export function applyServerPreferences(
  state: LightingState,
  prefs: {
    favouriteLookIds?: unknown;
    recentLookIds?: unknown;
    customLooks?: unknown;
    guidanceDismissed?: unknown;
  },
): LightingState {
  const ids = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : null;

  const customs = Array.isArray(prefs.customLooks)
    ? (prefs.customLooks.map(toCustomLook).filter(Boolean) as Look[])
    : null;

  return {
    ...state,
    fav: ids(prefs.favouriteLookIds) ?? state.fav,
    recent: ids(prefs.recentLookIds) ?? state.recent,
    customs: customs ?? state.customs,
  };
}

export function guidanceDismissedFrom(prefs: { guidanceDismissed?: unknown }): {
  core: boolean;
  lighting: boolean;
} {
  const keys = Array.isArray(prefs.guidanceDismissed) ? prefs.guidanceDismissed : [];
  return {
    core: keys.includes('core'),
    lighting: keys.includes('lighting'),
  };
}

export function recentsToShow(state: LightingState): string[] {
  return state.recent.filter((id) => !state.fav.includes(id)).slice(0, RECENTS_LIMIT);
}

export function canAdd(state: LightingState): boolean {
  return state.sel.length > 0;
}

export function addButtonLabel(state: LightingState): string {
  const n = state.sel.length;
  if (n <= 1) return '+ Add Render Combo';
  return `+ Add ${n} Render Combos`;
}

export function takeSelection(state: LightingState, resolve: (id: string) => Look | undefined): {
  looks: Look[];
  state: LightingState;
} {
  const looks = [...new Set(state.sel)]
    .map(resolve)
    .filter((l): l is Look => Boolean(l));
  return { looks, state: { ...state, sel: [] } };
}

export const DEFAULT_CUSTOM_NAME = 'Custom look';

export function defaultCustomLookName(existing: { name?: string }[]): string {
  const re = new RegExp(`^${DEFAULT_CUSTOM_NAME} (\\d+)$`, 'i');
  const highest = (existing || []).reduce((max, l) => {
    const m = re.exec(String(l?.name ?? '').trim());
    const n = m ? parseInt(m[1], 10) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${DEFAULT_CUSTOM_NAME} ${highest + 1}`;
}
