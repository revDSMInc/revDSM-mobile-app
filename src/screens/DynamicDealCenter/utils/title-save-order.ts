/**
 * title-save-order.ts — RN port of web
 * `src/sections/deal-center/components/utils/title-save-order.utils.js`.
 *
 * The backend enforces a UNIQUE calculator title per appointment/user. When a
 * calculator's value changes, its derived SM/MD/LG suffix shifts, and its new title can
 * collide with a SIBLING that still holds that title in the DB — a `PUT /lfcalculators/{id}`
 * with the colliding title then fails with **409 Conflict** (which is exactly why the
 * mobile save was intermittently failing: the confirm/entries never persisted).
 *
 * This computes the order to re-title the displaced calculators so no PUT ever collides:
 *
 *  1. LINEAR CHAIN — A wants B's title, B moves to C's title, C moves to a free title.
 *     Save order: C, then B, then A.
 *  2. SWAP / CYCLE — A wants B's title AND B wants A's title. A direct swap collides in
 *     one pass, so the displaced calc is first parked on a TEMP title (`__tmp_<id>`,
 *     guaranteed unique, never shown), the others take their new titles, then the temp
 *     is finalized.
 */

export const TEMP_TITLE_PREFIX = '__tmp_';

export interface TitleSaveStep {
  calculatorId: string;
  newTitle: string;
}

/**
 * Keep only titles that are UNIQUE across the map (web `getUniquePersistableTitles`).
 * A shared "⚠️" duplicate-price title appears more than once and is dropped — writing it
 * would hit the unique-title constraint; the ⚠️ is a UI-only signal.
 */
export const getUniquePersistableTitles = (
  titlesMap: Record<string, string>
): Record<string, string> => {
  const counts: Record<string, number> = {};
  Object.values(titlesMap || {}).forEach((t) => {
    counts[t] = (counts[t] || 0) + 1;
  });
  const result: Record<string, string> = {};
  Object.entries(titlesMap || {}).forEach(([id, t]) => {
    if (t && counts[t] === 1) result[id] = t;
  });
  return result;
};

/**
 * @param allCalcs      every calculator with its CURRENT (DB / last-saved) title
 * @param changedCalcId the calculator whose value the rep just edited
 * @param newTitles     the freshly-derived title for every calculator (`id → title`)
 * @returns the calculators to re-title, in a collision-free save order. The LAST entry
 *          is always the changed calculator itself (the caller saves it with its full
 *          entries payload); everything before it is a displaced sibling.
 */
export function computeTitleSaveOrder({
  allCalcs,
  changedCalcId,
  newTitles,
}: {
  allCalcs: Array<{ id: string; dbTitle?: string }>;
  changedCalcId: string;
  newTitles: Record<string, string>;
}): TitleSaveStep[] {
  if (!allCalcs?.length || !changedCalcId) return [];

  // currentTitle (DB) → id, and id → currentTitle (DB).
  const currentTitleToId: Record<string, string> = {};
  const idToCurrentTitle: Record<string, string> = {};
  allCalcs.forEach((c) => {
    if (c.dbTitle) currentTitleToId[c.dbTitle] = c.id;
    idToCurrentTitle[c.id] = c.dbTitle || '';
  });

  const makeEntry = (id: string, title: string): TitleSaveStep => ({ calculatorId: id, newTitle: title });

  // Follow the displacement chain from the changed calculator.
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined = changedCalcId;

  while (cursor && !visited.has(cursor)) {
    const cur: string = cursor;
    visited.add(cur);
    const targetTitle: string | undefined = newTitles[cur];
    if (!targetTitle) break;

    chain.push(cur);

    const displaced: string | undefined = currentTitleToId[targetTitle];
    if (displaced && displaced !== cur && newTitles[displaced] !== idToCurrentTitle[displaced]) {
      cursor = displaced;
    } else {
      break;
    }
  }

  // A cycle is when we stop on a calc already in the chain (includes the direct-swap
  // case where the chain loops back to the changed calc).
  const cycleStartId = cursor && visited.has(cursor) && chain.includes(cursor) ? cursor : null;

  if (cycleStartId) {
    const cycleStart = chain.indexOf(cycleStartId);
    const cycleMembers = chain.slice(cycleStart);
    const prefix = chain.slice(0, cycleStart).reverse();

    const result: TitleSaveStep[] = [];
    const cycleReversed = [...cycleMembers].reverse();
    // Park all cycle members except the last on a temp title (break the cycle).
    cycleReversed.slice(1).forEach((id) => result.push(makeEntry(id, `${TEMP_TITLE_PREFIX}${id}`)));
    // Now each cycle member can take its real new title (the cycle is broken).
    cycleReversed.forEach((id) => result.push(makeEntry(id, newTitles[id])));
    // Finally the linear prefix (deepest first).
    prefix.forEach((id) => result.push(makeEntry(id, newTitles[id])));
    return result;
  }

  // LINEAR case — reverse the chain (deepest sibling first, changed calc last).
  return [...chain].reverse().map((id) => makeEntry(id, newTitles[id]));
}
