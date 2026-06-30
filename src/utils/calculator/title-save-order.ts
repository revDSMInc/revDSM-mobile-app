const TEMP_PREFIX = '__tmp_';

interface ComputeTitleSaveOrderParams {
  allCalculators: any[];
  changedCalcId: string;
  changedCalcData: any;
  getTitles: (calculators: any[], getRetailPrice: (calc: any) => number) => Record<string, string>;
  getRetailPrice: (calc: any) => number;
}

export function computeTitleSaveOrder({
  allCalculators,
  changedCalcId,
  changedCalcData,
  getTitles,
  getRetailPrice,
}: ComputeTitleSaveOrderParams) {
  if (!allCalculators?.length || !changedCalcId) return [];

  // 1. Snapshot: replace the changed calc's data with the new values
  const snapshot = allCalculators.map((c) =>
    c._id === changedCalcId ? { ...c, ...changedCalcData } : c
  );

  // 2. Compute all new titles from the snapshot
  const newTitles = getTitles(snapshot, getRetailPrice);

  // 3. currentTitle (DB) → calcId
  const currentTitleToId: Record<string, string> = {};
  allCalculators.forEach((c) => {
    const t = c.title || c.name;
    if (t) currentTitleToId[t] = c._id;
  });

  // 4. calcId → currentTitle (DB)
  const idToCurrentTitle: Record<string, string> = {};
  allCalculators.forEach((c) => {
    idToCurrentTitle[c._id] = c.title || c.name || '';
  });

  // 5. calcId lookup
  const payloadById: Record<string, any> = {};
  allCalculators.forEach((c) => {
    payloadById[c._id] = c;
  });

  const calcById = { ...payloadById };
  calcById[changedCalcId] = { ...calcById[changedCalcId], ...changedCalcData };

  // Helper: build a save entry
  const makeEntry = (id: string, title: string) => {
    const base = id === changedCalcId ? calcById[id] : payloadById[id];
    return {
      calculatorId: id,
      appointmentId: base?.appointmentId,
      newTitle: title,
      data: { ...base, title },
    };
  };

  // 6. Follow the displacement chain from the changed calculator
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = changedCalcId;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const targetTitle = newTitles[cursor] as string;
    if (!targetTitle) break;

    chain.push(cursor);

    const displaced = currentTitleToId[targetTitle] as string | undefined;

    if (displaced && displaced !== cursor && newTitles[displaced] !== idToCurrentTitle[displaced]) {
      cursor = displaced;
    } else {
      break;
    }
  }

  // 7. Detect a cycle
  const cycleStartId = visited.has(cursor || '') && chain.includes(cursor || '') ? cursor : null;

  if (cycleStartId) {
    const cycleStart = chain.indexOf(cycleStartId);
    const cycleMembers = chain.slice(cycleStart);
    const prefix = chain.slice(0, cycleStart).reverse();

    const result: any[] = [];

    const cycleReversed = [...cycleMembers].reverse();
    cycleReversed.slice(1).forEach((id) => {
      result.push(makeEntry(id, `${TEMP_PREFIX}${id}`));
    });

    cycleReversed.forEach((id) => {
      result.push(makeEntry(id, newTitles[id]));
    });

    prefix.forEach((id) => {
      result.push(makeEntry(id, newTitles[id]));
    });

    return result;
  }

  // 8. LINEAR case
  return [...chain].reverse().map((id) => makeEntry(id, newTitles[id]));
}
