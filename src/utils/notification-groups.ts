/**
 * Notification Center presentation model — the pure layer.
 *
 * Turns the flat history list into what the redesign renders: DAY SECTIONS, and
 * within each one CARD PER NOTIFICATION.
 *
 * ⚠️ ONE ROW IN, ONE CARD OUT. Nothing is merged, collapsed or counted together.
 * An earlier pass grouped adjacent notifications about the same lead into a
 * shared card and folded repeats behind a "+N more update on this lead"
 * disclosure; that was reversed on request — a rep wants to see each message,
 * each issued lead and each reaction as its own notification. Read
 * `buildNotificationSections` as a mapping, not a grouping, and do not
 * reintroduce a bucketing pass here.
 *
 * Deliberately has NO react-native imports, for the reason
 * `utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist: the screen
 * pulls in React Native and is untestable under jest here, and every rule in this
 * file fails SILENTLY when it is wrong — a row filed under the wrong day, or a
 * mongo id rendered as a lead tag, looks like a rendering quirk rather than an
 * error.
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md §5. Design: `notify-ui.txt`.
 */

export interface NotificationLike {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  isUnread: boolean;
  eventType: string;
  payload: Record<string, any>;
}

/** One notification, ready to paint. Exactly one history row stands behind it. */
export interface NotificationItem<T extends NotificationLike = NotificationLike> {
  key: string;
  /** The row itself — the one whose route a tap follows, and the one it marks read. */
  row: T;
  title: string;
  message: string;
  /** Human lead label for the chip, or `''` when the payload names none. */
  tag: string;
  time: string;
  isUnread: boolean;
}

export interface NotificationSection<T extends NotificationLike = NotificationLike> {
  key: string;
  /** `Today` / `Yesterday` / `3 days ago` / `Aug 21`. */
  label: string;
  /** The calendar date beside it, e.g. `Sep 7`. `''` once the label IS a date. */
  date: string;
  data: NotificationItem<T>[];
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * ⚠️ Parsed as TEXT, never through `new Date(iso)`.
 *
 * Two reasons. The repo rule (`utils/job-change-summary.ts`) is that an offset
 * ISO string shifts the calendar day either side of midnight. The stronger one
 * here is CONSISTENCY: `formatClockTime` reads the same text prefix, so a row
 * filed under "Yesterday" can never print a time from today. Change one of these
 * and you must change the other.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** `YYYY-MM-DD` for a row's own timestamp, or `''` when it carries none. */
export function dayKeyOf(iso: string): string {
  const m = ISO.exec(str(iso));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** `YYYY-MM-DD` for the device's own clock — the caller's "today". */
export function todayKey(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Whole days between two `YYYY-MM-DD` keys.
 *
 * ⚠️ Built through `Date.UTC` on the parsed components rather than `new Date(key)`
 * so neither side can be shifted by the device's timezone — both are the same
 * fiction, so the difference between them is exact.
 */
export function daysBetween(fromKey: string, toKey: string): number {
  if (!fromKey || !toKey) return 0;
  const a = fromKey.split('-').map(Number);
  const b = toKey.split('-').map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return 0;
  const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
  return Math.round(ms / 86400000);
}

/** `Sep 7` — hand-rolled, so it cannot depend on Intl being in the JS engine. */
export function formatDayDate(dayKey: string): string {
  const parts = dayKey.split('-');
  if (parts.length !== 3) return '';
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!MONTHS[mo - 1] || !d) return '';
  return `${MONTHS[mo - 1]} ${d}`;
}

/**
 * The day-section heading.
 *
 * ⚠️ A NEGATIVE difference is clamped to Today rather than reported as a future
 * day. It is reachable without any clock being wrong: `createdAt` can be UTC
 * while the rep is behind it, so a notification raised late in the evening reads
 * as tomorrow's date. "Tomorrow" on a notification that has already arrived is a
 * worse answer than "Today".
 */
export function formatDayLabel(dayKey: string, today: string): { label: string; date: string } {
  const date = formatDayDate(dayKey);
  const diff = daysBetween(dayKey, today);
  if (diff <= 0) return { label: 'Today', date };
  if (diff === 1) return { label: 'Yesterday', date };
  if (diff < 7) return { label: `${diff} days ago`, date };
  // Past a week the relative phrasing stops meaning anything, so the date IS the
  // heading and the secondary slot is dropped rather than repeating it.
  return { label: date, date: '' };
}

/** `11:05 AM`. Same text parse as `dayKeyOf` — see the note on `ISO`. */
export function formatClockTime(iso: string): string {
  const m = ISO.exec(str(iso));
  if (!m) return '';
  const hour = Number(m[4]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[5]} ${suffix}`;
}

// ─── Lead tag ────────────────────────────────────────────────────────────────

/**
 * ⚠️ A fixed key list, the discipline `readDocumentGroup` sets — nothing is
 * guessed, and an unrecognised payload yields `''` so the chip is simply absent.
 *
 * `leadId` is IN the list and is safe there only because of the mongo-id guard
 * below: the push payload's `leadId` is a mongo id, while the lead RECORD's
 * `leadId` is the human number the design's chip shows (`41PCDLG`). Whichever the
 * backend sends, the right one renders and the wrong one never does.
 */
const LEAD_TAG_KEYS = [
  'leadNumber',
  'humanLeadId',
  'leadIdentifier',
  'leadLabel',
  'leadId',
  'selfGenLeadId',
  'issuedLeadId',
  // Last: a self-gen lead stores `leadId: "N/A"` and carries its identity here
  // instead (`leadCode: "SelfGen"` — the design's own third chip).
  'leadCode',
];

const MONGO_ID = /^[0-9a-f]{24}$/i;
const NOT_A_TAG = new Set(['n/a', 'na', 'none', 'null', 'undefined', '-']);

/**
 * The lead chip's text, or `''`.
 *
 * ⚠️ A 24-character hex id is REJECTED. It is a database key, not something a rep
 * can recognise, and printing one would fill the chip on every single row with
 * noise that looks deliberate.
 */
export function leadTagOf(payload: Record<string, any> | undefined | null): string {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of LEAD_TAG_KEYS) {
    const raw = str(payload[key]);
    if (!raw) continue;
    if (MONGO_ID.test(raw)) continue;
    if (NOT_A_TAG.has(raw.toLowerCase())) continue;
    // A label longer than this is a sentence or an id, not a chip.
    if (raw.length > 16) continue;
    return raw;
  }
  return '';
}

// ─── Building ────────────────────────────────────────────────────────────────

function buildItem<T extends NotificationLike>(row: T): NotificationItem<T> {
  return {
    // The history id, which is unique per notification and stable across a
    // refetch — so an expanded/pressed row cannot swap identity under the rep.
    key: row.id || `${row.eventType}|${row.createdAt}`,
    row,
    title: row.title,
    message: row.message,
    tag: leadTagOf(row.payload),
    time: formatClockTime(row.createdAt),
    isUnread: Boolean(row.isUnread),
  };
}

/**
 * The whole presentation model: day sections, each holding one item per row.
 *
 * Rows arrive newest-first and that order is preserved exactly — a section break
 * is the ONLY thing this function introduces, so nothing on screen moves relative
 * to the list the API returned.
 *
 * ⚠️ Rows are bucketed by day in ARRIVAL ORDER, not by sorting on the day key. A
 * list that is not perfectly ordered therefore yields two sections with the same
 * label rather than silently reordering the rep's notifications — the API returns
 * them newest-first, and rearranging them here would hide a paging bug instead of
 * showing it.
 */
export function buildNotificationSections<T extends NotificationLike>(
  rows: T[],
  today: string
): NotificationSection<T>[] {
  const sections: NotificationSection<T>[] = [];
  if (!Array.isArray(rows) || rows.length === 0) return sections;

  for (const row of rows) {
    if (!row) continue;
    const key = dayKeyOf(row.createdAt) || 'undated';
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.data.push(buildItem(row));
      continue;
    }
    const { label, date } =
      key === 'undated'
        ? // A row the backend sent without a usable timestamp. Filed at the end of
          // its own section rather than dropped: a notification the rep cannot see
          // is worse than one whose time is unknown.
          { label: 'Earlier', date: '' }
        : formatDayLabel(key, today);
    sections.push({ key, label, date, data: [buildItem(row)] });
  }

  return sections;
}

/**
 * The list's footer line.
 *
 * The design's copy is "You're viewing the last 3 days", and it is DERIVED from
 * the oldest row actually loaded rather than hardcoded — the app has no retention
 * window to quote, so a fixed number would be a claim nothing backs.
 */
export function endHintFor(rows: NotificationLike[], today: string): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  let oldest = '';
  for (const row of rows) {
    const key = dayKeyOf(row?.createdAt || '');
    if (!key) continue;
    if (!oldest || key < oldest) oldest = key;
  }
  if (!oldest) return '';
  const span = Math.max(0, daysBetween(oldest, today)) + 1;
  if (span <= 1) return "You're viewing today's notifications";
  return `You're viewing the last ${span} days`;
}
