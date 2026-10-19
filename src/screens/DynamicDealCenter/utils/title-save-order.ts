export const TEMP_TITLE_PREFIX = '__tmp_';

export interface TitleSaveStep {
  calculatorId: string;
  newTitle: string;
}

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
 * A title that is safe to SEND to the server, as opposed to the one shown on the tab.
 *
 * The server rejects a duplicate outright:
 *   POST /appointments/{id}/lfcalculators ->
 *   409 "LFCalculator title must be unique within this appointment for the current user"
 *
 * IMPORTANT: the DISPLAY title and the SAVED title are different things. `computeDerivedTitles`
 * deliberately gives two same-priced tabs the SAME decorated name (`[warn] G [warn]`) so the rep
 * can see they are ambiguous - that is a UI affordance and must never be persisted.
 * `getUniquePersistableTitles` drops it for exactly that reason.
 *
 * Online the fallback is the title the SERVER confirmed (the placeholder "2"), so a duplicate
 * never leaves the device. Offline nothing has ever been confirmed, so the fallback has to be
 * built here instead: the placeholder reserved for this tab, by its position.
 *
 * IMPORTANT: `lastSaved` must hold only titles a server has ACKNOWLEDGED. An offline save that
 * writes the derived display title into it turns that map into a second source of the duplicate -
 * which is precisely the bug this guards (see `persistOffline`).
 */
export const resolvePersistableTitle = ({
  tabId,
  derived,
  lastSaved,
  position,
  currentTitle,
}: {
  tabId: string;
  derived: Record<string, string>;
  lastSaved?: Record<string, string>;
  /** 1-based index of the tab, used for the placeholder the server expects. */
  position: number;
  currentTitle?: string;
}): string => {
  const unique = getUniquePersistableTitles(derived || {});
  if (unique[tabId]) return unique[tabId];

  // Only a confirmed title may be reused, and only if nothing else now carries it.
  const confirmed = lastSaved?.[tabId];
  if (confirmed && !isAmbiguousTitle(confirmed)) {
    const taken = Object.entries(lastSaved || {}).some(
      ([id, t]) => id !== tabId && t === confirmed
    );
    if (!taken) return confirmed;
  }

  // An unambiguous on-screen title is still better than a bare number.
  if (currentTitle && !isAmbiguousTitle(currentTitle)) {
    const clash = Object.values(derived || {}).filter((t) => t === currentTitle).length > 1;
    if (!clash) return currentTitle;
  }

  // The placeholder the online path uses: position in the strip, which is unique by definition.
  return String(position > 0 ? position : 1);
};

/**
 * A title `computeDerivedTitles` marked as shared between tabs. The warning marks are the
 * signal, and they are U+26A0 U+FE0F - written as escapes because this file is ASCII-only.
 */
export const isAmbiguousTitle = (title?: string): boolean =>
  !!title && title.includes('\u26a0\ufe0f');

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

  const currentTitleToId: Record<string, string> = {};
  const idToCurrentTitle: Record<string, string> = {};
  allCalcs.forEach((c) => {
    if (c.dbTitle) currentTitleToId[c.dbTitle] = c.id;
    idToCurrentTitle[c.id] = c.dbTitle || '';
  });

  const makeEntry = (id: string, title: string): TitleSaveStep => ({ calculatorId: id, newTitle: title });

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

  const cycleStartId = cursor && visited.has(cursor) && chain.includes(cursor) ? cursor : null;

  if (cycleStartId) {
    const cycleStart = chain.indexOf(cycleStartId);
    const cycleMembers = chain.slice(cycleStart);
    const prefix = chain.slice(0, cycleStart).reverse();

    const result: TitleSaveStep[] = [];
    const cycleReversed = [...cycleMembers].reverse();
    cycleReversed.slice(1).forEach((id) => result.push(makeEntry(id, `${TEMP_TITLE_PREFIX}${id}`)));
    cycleReversed.forEach((id) => result.push(makeEntry(id, newTitles[id])));
    prefix.forEach((id) => result.push(makeEntry(id, newTitles[id])));
    return result;
  }

  return [...chain].reverse().map((id) => makeEntry(id, newTitles[id]));
}
