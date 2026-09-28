/**
 * Sales-map pin rules (REVUIUX-439). Every job returned by `POST /job/v1/find` is a
 * company pin, from one of two sources:
 *   - a CSV upload (`source: 'csv'`)     → `pinCategory: 'uploaded'` (historical install)
 *   - a lead marked Sale (`source: 'sale'`) → `'pendingInstall'` until the installer
 *     completes it, then `'installed'`.
 *
 * Kept pure (no React Native) so it can be tested under jest — `LeadMap`,
 * `MapJobCard`, `MapDetail` and the Zone Canvasser pins all pull in RN / Mapbox.
 */

export type PinCategory = 'uploaded' | 'pendingInstall' | 'installed';
export type PinStatusFilter = 'all' | 'pendingInstall' | 'installed';

export const PIN_CATEGORIES: PinCategory[] = ['uploaded', 'installed', 'pendingInstall'];

/**
 * Ticket: "change the pending-install pin from purple to yellow, and make the installed
 * pin the same colour as the uploaded pin (green)." Reverses the earlier spring-mint
 * decision on `installed` — see the "Installed pin colour" follow-up in
 * `docs/claude/maps-zone-canvasser.md` for why that one was picked, and why it no longer
 * applies now that the two are meant to read as one colour.
 *
 * ⚠️ `installed` and `uploaded` are now the SAME value on purpose — both the hex here and
 * the marker PNGs (`marker-installed*.png` was recoloured to `#4CBB17` pixel-for-pixel,
 * not re-pointed at `marker-green*.png`, so the two categories keep independent asset
 * files that happen to render identically — easier to tell apart in a future diff).
 */
export const PIN_CATEGORY_META: Record<PinCategory, { label: string; color: string }> = {
  uploaded: { label: 'Uploaded', color: '#4CBB17' },
  installed: { label: 'Installed', color: '#4CBB17' },
  pendingInstall: { label: 'Pending Install', color: '#FFD400' },
};

/**
 * Stacking order of overlapping pins (higher = drawn on top), keyed by the GeoJSON
 * `category` each map puts on its features. `default` is LeadMap's name for an
 * uploaded pin.
 *
 * ⚠️ Without it every pin shares one SymbolLayer with `iconAllowOverlap`, and Mapbox
 * then stacks overlapping pins by screen Y — so the handful of purple pending-install
 * pins sat INSIDE the dense green clusters of ~2,500 uploaded pins and were painted
 * over: the legend said 18, the map showed none. The rarer, actionable pins must win.
 */
export const PIN_DRAW_ORDER: Record<string, number> = {
  default: 0,
  uploaded: 0,
  installed: 1,
  pendingInstall: 2,
  favorite: 3,
  searched: 4,
};

/** Mapbox `symbolSortKey` expression for `PIN_DRAW_ORDER` (ascending = drawn first). */
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

/**
 * The pin's category. A job from an older backend (no `pinCategory`) is an uploaded
 * pin, which is exactly how it was drawn before.
 */
export const getPinCategory = (job: any): PinCategory => {
  const c = job?.pinCategory;
  return c === 'pendingInstall' || c === 'installed' ? c : 'uploaded';
};

/**
 * Web parity: pending = `pinCategory === 'pendingInstall'`; installed = anything else,
 * because uploaded pins are historical installs.
 */
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

/**
 * Legend row for the Sales Map's pin-colour legend key.
 *
 * ⚠️ `key` is a legend-row id, NOT necessarily a `PinCategory` — `installed` here covers
 * BOTH `uploaded` and `installed` pins, see `legendRows` below.
 */
export interface LegendRow {
  key: string;
  label: string;
  color: string;
  count: number;
}

/**
 * Ticket: "remove the Uploaded title, merge the pins into the Installed title, because
 * both pins are the same — installed and uploaded [pins]." Uploaded and installed pins
 * are now colour- and shape-identical on the map (the two design-match follow-ups above
 * in `docs/claude/maps-zone-canvasser.md`), so a legend that still split them into two
 * rows was explaining a distinction the rep can no longer see: one pin style, two counts.
 *
 * Returns exactly the two rows the legend now shows — `installed` merges `uploaded` +
 * `installed`, `pendingInstall` is unchanged.
 *
 * ⚠️ This merges the LEGEND DISPLAY ONLY. `PinCategory` itself stays three-valued —
 * `getPinCategory` / `countPinCategories` / the GeoJSON `category` / `PIN_DRAW_ORDER` are
 * all untouched, and none of them read this function. The merge is safe precisely because
 * nothing else needed to change: the status filter (`MapFiltersModal`) already treats
 * "installed" as `!== pendingInstall` — i.e. uploaded OR installed — per the ⚠️ in the
 * REVUIUX-439 section above, so the legend is the only place still presenting them as two
 * separate things.
 */
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

/**
 * The yellow pending-install pin that belongs to `lead`, or `null`.
 *
 * Used when the Sales Map is opened FROM a lead (Lead Center -> Map): a lead that has just
 * been sold should open the map on its own pin, not only on the rep's GPS fix.
 *
 * A pin is linked to its lead by id OR by job number — a sold job's own `jobNumber` IS the
 * lead number (`SG-XXXXXX` for a self-generated lead; `displayJobNumber` is the separate
 * installer `T…` number, so it is compared against the lead's number too). Only a
 * `pendingInstall` pin with usable coordinates counts: an uploaded / installed pin with the
 * same number is history, and a pin with no location cannot be framed.
 */
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

/** A sold job's own `jobNumber` is the lead number; `displayJobNumber` is the one to show. */
export const getDisplayJobNumber = (job: any): string => {
  const n = job?.displayJobNumber || job?.jobNumber;
  return n == null || n === '' ? '' : String(n);
};

/** True when `search` matches either the displayed or the raw job number. */
export const jobNumberMatches = (job: any, search: string, exact = false): boolean => {
  const s = String(search ?? '').toLowerCase().trim();
  if (!s) return false;
  return [job?.displayJobNumber, job?.jobNumber].some((n) => {
    if (n == null || n === '') return false;
    const v = String(n).toLowerCase().trim();
    return exact ? v === s : v.includes(s);
  });
};

/** Rep label — `repDisplayName` is never empty for a known rep, even one with no account. */
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

/**
 * The API field is `products` (string or array); the card used to read `product`,
 * which does not exist, so it always showed N/A.
 */
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

/**
 * `MM/dd/yyyy`, or `null` for a missing / invalid value — a null date must never be
 * formatted (it prints 1/1/1970). A calendar date (`YYYY-MM-DD`, or that at UTC
 * midnight) is read as TEXT, because `new Date()` shifts it to the previous day in
 * US timezones. A real timestamp is shown in local time.
 */
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

/**
 * The card / list date line.
 *   - pending install: "Install scheduled {date}", else just "Sold {date}".
 *   - otherwise: the install date, falling back to the lead / created date as before.
 *
 * ⚠️ Ticket: "still status is on the card — pending install — I want to remove the
 * status from the card." Used to append `· pending install` to the sold date (and,
 * with no sale date either, return the bare word "Pending install" as the whole line).
 * The pin's status is now shown by its COLOUR alone (the pin itself, the legend, the
 * on-map `INS` / `PI` toggles — all `PIN_CATEGORY_META`) — this text line is a DATE, and
 * saying the status a second time in words was the thing asked to go. Do not re-add it;
 * a status BADGE was also tried on the card and separately reverted for the same reason
 * (`docs/claude/maps-zone-canvasser.md`).
 */
export const getPinDateLabel = (job: any): string => {
  if (getPinCategory(job) === 'pendingInstall') {
    const scheduled = formatPinDate(job?.scheduledInstallDate);
    if (scheduled) return `Install scheduled ${scheduled}`;
    const sold = formatPinDate(job?.saleDate);
    // No sale date either — genuinely no date to show (a pending-install pin implies a
    // sale happened, so this is effectively unreachable on real data). Empty rather than
    // falling back to a bare status word, per the same ticket.
    return sold ? `Sold ${sold}` : '';
  }
  return (
    formatPinDate(job?.installationDate) ||
    formatPinDate(job?.leadDate) ||
    formatPinDate(job?.createdAt) ||
    'N/A'
  );
};

/**
 * The date a pin is sorted and date-range filtered by. A pending job has no install
 * date, so it is dated by its sale date (the backend's `dateFilter` does the same)
 * instead of dropping to `createdAt`.
 */
export const getPinSortDate = (job: any): any =>
  job?.installationDate || job?.saleDate || job?.createdAt || 0;
