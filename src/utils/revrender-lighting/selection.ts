import { Look } from './types';

/**
 * Selection, favourites and recents for the Lighting tab (483 §3, §7).
 *
 * Pure functions over plain state so the screen can hold it in useState and the
 * behaviour stays testable — this is where the quiet bugs live: a selection that
 * double-counts across tabs, or a dedupe that lets two identical renders through
 * and bills the company twice.
 */

/** How many recently-rendered looks the Quick picks panel shows (483 §3). */
export const RECENTS_LIMIT = 3;

export interface LightingState {
  /** Selected look ids, across every tab. */
  sel: string[];
  /** Favourite look ids. Unlimited, newest first. */
  fav: string[];
  /** Recently rendered look ids, most recent first. */
  recent: string[];
  customs: Look[];
}

export const emptyState = (): LightingState => ({ sel: [], fav: [], recent: [], customs: [] });

/**
 * Tapping a tile toggles it. The same look can appear in Quick picks, its own
 * tab and the selected box at once, so selection is keyed by id and must stay
 * consistent everywhere it is shown.
 */
export function toggleSelected(state: LightingState, lookId: string): LightingState {
  const sel = state.sel.includes(lookId)
    ? state.sel.filter((id) => id !== lookId)
    : [...state.sel, lookId];
  return { ...state, sel };
}

export function isSelected(state: LightingState, lookId: string): boolean {
  return state.sel.includes(lookId);
}

/** Count for the tab badges — how many selected looks live in this set. */
export function selectedCountIn(state: LightingState, looks: Look[]): number {
  const ids = new Set(looks.map((l) => l.id));
  return state.sel.filter((id) => ids.has(id)).length;
}

/** Hold a tile to favourite it; the star in the selected box does the same. */
export function toggleFavourite(state: LightingState, lookId: string): LightingState {
  const fav = state.fav.includes(lookId)
    ? state.fav.filter((id) => id !== lookId)
    : [lookId, ...state.fav];  // newest first
  return { ...state, fav };
}

export function isFavourite(state: LightingState, lookId: string): boolean {
  return state.fav.includes(lookId);
}

/**
 * ⚠️ `recordRendered()` USED TO LIVE HERE AND WAS DELETED. Do not add it back.
 *
 * "Recently Rendered" is now DERIVED SERVER-SIDE from the rep's actual run
 * history (`renderType: 'look'`, newest first, distinct look ids). A run row
 * only exists once a render completed, which settles 483 §13's open question
 * ("record at Add or at Generate?") by construction.
 *
 * Writing recents from the client as well would be a second source of truth,
 * and the two would disagree the first time a generate failed.
 */

/**
 * Apply the server's favourites + recents to local state.
 *
 * ⚠️ Does NOT touch `sel` or `customs`. Selection is this screen's working
 * state and the server knows nothing about it; custom looks are device-local
 * until the write endpoints exist, and the GET returns `customLooks: []`
 * ALWAYS — so merging that empty array in would delete the rep's custom looks
 * every time the screen mounted.
 */
export function applyServerPreferences(
  state: LightingState,
  prefs: { favouriteLookIds?: unknown; recentLookIds?: unknown },
): LightingState {
  const ids = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : null;

  return {
    ...state,
    fav: ids(prefs.favouriteLookIds) ?? state.fav,
    recent: ids(prefs.recentLookIds) ?? state.recent,
  };
}

/**
 * Favourites already sit in their own row, so showing them again under Recently
 * Rendered wastes the panel. Excluded at display time rather than at write time,
 * so unfavouriting something brings it back if it is still recent.
 */
export function recentsToShow(state: LightingState): string[] {
  return state.recent.filter((id) => !state.fav.includes(id)).slice(0, RECENTS_LIMIT);
}

/** "+ Add N Render Combos" is disabled at zero (483 §2). */
export function canAdd(state: LightingState): boolean {
  return state.sel.length > 0;
}

export function addButtonLabel(state: LightingState): string {
  const n = state.sel.length;
  // ⚠️ Zero reads as the singular, NOT "+ Add 0 Render Combos". The button is
  // disabled at zero, so the label is a name for the action, not a count of it —
  // and a literal 0 in a disabled control reads as a bug.
  if (n <= 1) return '+ Add Render Combo';
  return `+ Add ${n} Render Combos`;
}

/**
 * Turns the selection into queue items — one per look — and clears it.
 * Deduped by lookId, since the same look can be tapped from several places.
 */
export function takeSelection(state: LightingState, resolve: (id: string) => Look | undefined): {
  looks: Look[];
  state: LightingState;
} {
  const looks = [...new Set(state.sel)]
    .map(resolve)
    .filter((l): l is Look => Boolean(l));
  return { looks, state: { ...state, sel: [] } };
}
