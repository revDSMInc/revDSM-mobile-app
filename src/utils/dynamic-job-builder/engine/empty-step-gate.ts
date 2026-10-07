export function stateHasContent(obj: any, lockedFieldIds?: Set<string>): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === 'number') return obj !== 0;
  if (typeof obj === 'boolean') return obj;
  if (typeof obj === 'string') {
    const t = obj.trim();
    if (t === '') return false;
    const num = Number(t);
    return Number.isNaN(num) ? true : num !== 0;
  }
  if (Array.isArray(obj)) return obj.some((v) => stateHasContent(v, lockedFieldIds));
  if (typeof obj === 'object') {
    return Object.entries(obj).some(([k, v]) => {
      if (k === 'colorValues' || k === '_combinationNumber' || k === '_addedInEdit' || k === '_storageVersion') {
        return false;
      }
      if (lockedFieldIds && lockedFieldIds.has(k)) return false;
      return stateHasContent(v, lockedFieldIds);
    });
  }
  return false;
}

export function collectLockedFieldIds(config: any): Set<string> {
  const set = new Set<string>();
  const walk = (fields: any[]) =>
    (fields || []).forEach((f: any) => {
      if (f?.id && (f.locked || f.type === 'locked' || f.type === 'lockedWithColor')) {
        set.add(f.id);
      }
      if (f?.fields) walk(f.fields);
    });
  (config?.verticals || []).forEach((v: any) =>
    (v.tabs || []).forEach((t: any) => {
      walk(t.fields);
      (t.sections || []).forEach((s: any) => walk(s.fields));
      if (t.combinations?.fields) walk(t.combinations.fields);
    })
  );
  return set;
}
