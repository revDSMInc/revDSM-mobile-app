export function getDealCenterDataValue(dealCenterData: any = {}, ref: string) {
  if (!ref) return undefined;

  const raw = dealCenterData[ref];
  if (raw === undefined || raw === null || raw === '') return undefined;
  return raw;
}

export function hasDealCenterDataValue(dealCenterData: any = {}, ref: string) {
  return getDealCenterDataValue(dealCenterData, ref) !== undefined;
}

export function toDealCenterNumber(dealCenterData: any = {}, ref: string) {
  const raw = getDealCenterDataValue(dealCenterData, ref);
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

export function sumDealCenterRefs(dealCenterData: any = {}, refs: string[] = [], aggregate = 'sum') {
  const keys = (refs || []).filter(Boolean);
  if (!keys.length) return 0;

  const nums = keys.map((ref) => toDealCenterNumber(dealCenterData, ref));

  if (aggregate === 'max') {
    return Math.max(0, ...nums);
  }

  return nums.reduce((sum, n) => sum + n, 0);
}

export function anyDealCenterRefHasData(dealCenterData: any = {}, refs: string[] = []) {
  return (refs || []).some((ref) => hasDealCenterDataValue(dealCenterData, ref));
}
