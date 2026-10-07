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
