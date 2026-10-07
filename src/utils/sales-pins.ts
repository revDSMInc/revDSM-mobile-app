export type PinCategory = 'uploaded' | 'pendingInstall' | 'installed';
export type PinStatusFilter = 'all' | 'pendingInstall' | 'installed';

export const PIN_CATEGORIES: PinCategory[] = ['uploaded', 'installed', 'pendingInstall'];

export const PIN_CATEGORY_META: Record<PinCategory, { label: string; color: string }> = {
  uploaded: { label: 'Uploaded', color: '#4CBB17' },
  installed: { label: 'Installed', color: '#4CBB17' },
  pendingInstall: { label: 'Pending Install', color: '#FFD400' },
};

export const PIN_DRAW_ORDER: Record<string, number> = {
  default: 0,
  uploaded: 0,
  installed: 1,
  pendingInstall: 2,
  favorite: 3,
  searched: 4,
};

export const pinSortKeyExpression = (): any => [
  'match',
  ['get', 'category'],
  ...Object.entries(PIN_DRAW_ORDER).flatMap(([category, rank]) => [category, rank]),
  0,
];

export const PIN_STATUS_FILTER_LABELS: Record<PinStatusFilter, string> = {
  all: 'All Jobs',
  pendingInstall: 'Pending Install',
  installed: 'Installed',
};

export const getPinCategory = (job: any): PinCategory => {
  const c = job?.pinCategory;
  return c === 'pendingInstall' || c === 'installed' ? c : 'uploaded';
};

export const matchesPinStatusFilter = (job: any, filter: PinStatusFilter | undefined | null): boolean => {
  if (!filter || filter === 'all') return true;
  const isPending = getPinCategory(job) === 'pendingInstall';
  return filter === 'pendingInstall' ? isPending : !isPending;
};

export const countPinCategories = (jobs: any[]): Record<PinCategory, number> => {
  const counts: Record<PinCategory, number> = { uploaded: 0, installed: 0, pendingInstall: 0 };
  for (const job of jobs || []) counts[getPinCategory(job)] += 1;
  return counts;
};

export interface LegendRow {
  key: string;
  label: string;
  color: string;
  count: number;
}

export const legendRows = (counts: Record<PinCategory, number>): LegendRow[] => [
  {
    key: 'installed',
    label: PIN_CATEGORY_META.installed.label,
    color: PIN_CATEGORY_META.installed.color,
    count: counts.uploaded + counts.installed,
  },
  {
    key: 'pendingInstall',
    label: PIN_CATEGORY_META.pendingInstall.label,
    color: PIN_CATEGORY_META.pendingInstall.color,
    count: counts.pendingInstall,
  },
];

const idText = (v: any): string => (v == null ? '' : String(v).trim());

export const findPendingInstallPinForLead = (jobs: any[] | null | undefined, lead: any): any | null => {
  if (!lead || !Array.isArray(jobs)) return null;
  const ids = [lead._id, lead.id, lead.leadId].map(idText).filter(Boolean);
  const numbers = [lead.jobNumber, lead.displayJobNumber].map(idText).filter(Boolean);
  if (!ids.length && !numbers.length) return null;

  return (
    jobs.find((job: any) => {
      if (getPinCategory(job) !== 'pendingInstall') return false;
      const coords = job?.location?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return false;
      const jobIds = [job._id, job.leadId].map(idText).filter(Boolean);
      const jobNumbers = [job.jobNumber, job.displayJobNumber].map(idText).filter(Boolean);
      return jobIds.some((v) => ids.includes(v)) || jobNumbers.some((v) => numbers.includes(v));
    }) || null
  );
};

export const getDisplayJobNumber = (job: any): string => {
  const n = job?.displayJobNumber || job?.jobNumber;
  return n == null || n === '' ? '' : String(n);
};

export const jobNumberMatches = (job: any, search: string, exact = false): boolean => {
  const s = String(search ?? '').toLowerCase().trim();
  if (!s) return false;
  return [job?.displayJobNumber, job?.jobNumber].some((n) => {
    if (n == null || n === '') return false;
    const v = String(n).toLowerCase().trim();
    return exact ? v === s : v.includes(s);
  });
};

export const getRepDisplayName = (job: any): string => {
  const rep = job?.salesRep;
  return (
    job?.repDisplayName ||
    job?.userName ||
    job?.salesRepName ||
    (rep && typeof rep === 'object' ? rep.fullName || rep.firstName : '') ||
    (typeof rep === 'string' ? rep : '') ||
    'Unknown'
  );
};

export const getProductsText = (job: any): string => {
  const raw = job?.products ?? job?.product;
  const list = (Array.isArray(raw) ? raw : [raw])
    .map((p) => (p && typeof p === 'object' ? p.name || p.label || p.title || '' : p))
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => String(p).trim());
  return list.join(', ');
};

export const getProductsCount = (job: any): number => {
  const raw = job?.products ?? job?.product;
  return Array.isArray(raw) ? raw.length : raw ? 1 : 0;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)?)?$/;

export const formatPinDate = (value: any): string | null => {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim());
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
};

export const getPinDateLabel = (job: any): string => {
  if (getPinCategory(job) === 'pendingInstall') {
    const scheduled = formatPinDate(job?.scheduledInstallDate);
    if (scheduled) return `Install scheduled ${scheduled}`;
    const sold = formatPinDate(job?.saleDate);
    return sold ? `Sold ${sold}` : '';
  }
  return (
    formatPinDate(job?.installationDate) ||
    formatPinDate(job?.leadDate) ||
    formatPinDate(job?.createdAt) ||
    'N/A'
  );
};

export const getPinSortDate = (job: any): any =>
  job?.installationDate || job?.saleDate || job?.createdAt || 0;

const EARTH_RADIUS_MILES = 3958.8;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

export interface Coords {
  latitude: number;
  longitude: number;
}

export const getJobCoords = (job: any): Coords | null => {
  const raw = job?.location?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const longitude = Number(raw[0]);
  const latitude = Number(raw[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
};

export const distanceInMiles = (from: Coords, to: Coords): number => {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const getJobDistanceMiles = (job: any, origin: Coords | null | undefined): number | null => {
  if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) return null;
  const coords = getJobCoords(job);
  if (!coords) return null;
  return distanceInMiles(origin, coords);
};

export const formatDistanceMiles = (miles: number | null | undefined): string => {
  if (miles === null || miles === undefined || !Number.isFinite(miles)) return '—';
  if (miles < 100) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
};

export const compareByDistance = (
  a: any,
  b: any,
  origin: Coords | null | undefined,
  descending = false,
): number => {
  const da = getJobDistanceMiles(a, origin);
  const db = getJobDistanceMiles(b, origin);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return descending ? db - da : da - db;
};
