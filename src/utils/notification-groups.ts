/**
 * Notification Center presentation model — the pure layer.
 *
 * Turns the flat history list into what the redesign renders: day sections, one
 * CARD per run of adjacent notifications about the same thing, and within a card
 * one ITEM per event family with the older repeats collapsed behind a
 * "+N more update on this lead" / "Show breakdown" disclosure.
 *
 * Deliberately has NO react-native imports, for the reason
 * `utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist: the screen
 * pulls in React Native and is untestable under jest here, and every rule in this
 * file fails SILENTLY when it is wrong — a row filed under the wrong day, a
 * mongo id rendered as a lead tag, or two unrelated notifications merged into one
 * card all look like a rendering quirk rather than an error.
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

/** One visible row. `ids` is every notification it stands for, newest first. */
export interface NotificationItem<T extends NotificationLike = NotificationLike> {
  key: string;
  /** The newest row — the one whose route a tap follows. */
  row: T;
  ids: string[];
  title: string;
  message: string;
  /** Human lead label for the chip, or `''` when the payload names none. */
  tag: string;
  time: string;
  isUnread: boolean;
  /** Collapsed repeats, newest first. Empty when there is nothing to disclose. */
  stack: { label: string; time: string }[];
  /** Disclosure copy, e.g. `+2 more updates on this lead` / `Show breakdown`. */
  moreLabel: string;
  lessLabel: string;
}

export interface NotificationCard<T extends NotificationLike = NotificationLike> {
  key: string;
  items: NotificationItem<T>[];
}

export interface NotificationSection<T extends NotificationLike = NotificationLike> {
  key: string;
  /** `Today` / `Yesterday` / `3 days ago` / `Aug 21`. */
  label: string;
  /** The calendar date beside it, e.g. `Sep 7`. `''` once the label IS a date. */
  date: string;
  data: NotificationCard<T>[];
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

// ─── Grouping ────────────────────────────────────────────────────────────────

/** Events that name no lead and aggregate into a single "N new leads" row. */
const ISSUED_EVENTS = new Set(['lead-issued']);
const CHAT_EVENTS = new Set([
  'chat-message',
  'chat-reply',
  'chat-file-upload',
  'chat-tagged',
]);

/**
 * Which card a row belongs to — the design's "one card per thing".
 *
 * ⚠️ A row with no resolvable identity gets a key of its OWN id, so it can never
 * be merged into a neighbour. Merging two unrelated notifications into one card
 * tells the rep they concern the same lead, which is worse than an extra card.
 */
function cardKeyOf(row: NotificationLike): string {
  const type = str(row.eventType);
  if (ISSUED_EVENTS.has(type)) return 'issued';

  if (CHAT_EVENTS.has(type)) {
    const chatId = str(row.payload?.chatId);
    if (chatId) return `chat:${chatId}`;
  }

  const leadId = str(row.payload?.leadId);
  if (leadId) return `lead:${leadId}`;

  const tag = leadTagOf(row.payload);
  if (tag) return `tag:${tag}`;

  return `row:${row.id}`;
}

/**
 * Which repeats collapse together inside a card.
 *
 * ⚠️ `addendum-signed` is sent for a DECLINE as well as an accept, so the outcome
 * is part of the key — collapsing an approval and a refusal into one row would
 * hide the refusal behind the approval's title, which reads identically.
 */
function stackKeyOf(row: NotificationLike): string {
  const type = str(row.eventType);
  if (type === 'addendum-signed') {
    return `${type}|${str(row.payload?.outcome).toLowerCase()}`;
  }
  return type || 'other';
}

/** A batch's size. Absent means one — never zero, which would erase the row. */
function issuedCount(row: NotificationLike): number {
  const raw = row.payload?.count;
  const n = typeof raw === 'number' ? raw : Number(str(raw));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function buildItem<T extends NotificationLike>(rows: T[]): NotificationItem<T> {
  const head = rows[0];
  const rest = rows.slice(1);
  const isIssued = ISSUED_EVENTS.has(str(head.eventType));

  let title = head.title;
  let message = head.message;
  let moreLabel = '';

  if (rest.length) {
    if (isIssued) {
      const total = rows.reduce((sum, r) => sum + issuedCount(r), 0);
      title = `${total} new leads issued to you`;
      message = `Added to your queue in ${rows.length} batches.`;
      moreLabel = 'Show breakdown';
    } else {
      moreLabel = `+${rest.length} more ${plural(
        rest.length,
        'update',
        'updates'
      )} on this lead`;
    }
  }

  return {
    key: head.id || `${cardKeyOf(head)}:${stackKeyOf(head)}`,
    row: head,
    ids: rows.map((r) => r.id).filter(Boolean),
    title: title || head.title,
    message,
    tag: leadTagOf(head.payload),
    time: formatClockTime(head.createdAt),
    // A card is unread if ANY row behind it is: the disclosure hides rows, and a
    // hidden unread would otherwise leave the badge counting something the rep
    // has no way to see.
    isUnread: rows.some((r) => r.isUnread),
    stack: rest.map((r) => ({
      label: isIssued
        ? `${issuedCount(r)} ${plural(issuedCount(r), 'lead', 'leads')} issued`
        : r.title || str(r.eventType),
      time: formatClockTime(r.createdAt),
    })),
    moreLabel,
    lessLabel: isIssued ? 'Hide breakdown' : 'Show less',
  };
}

/**
 * The whole presentation model.
 *
 * Rows arrive newest-first and that order is preserved throughout — days, cards
 * within a day, and items within a card all keep it, so nothing on screen moves
 * relative to the list the API returned.
 */
export function buildNotificationSections<T extends NotificationLike>(
  rows: T[],
  today: string
): NotificationSection<T>[] {
  const sections: NotificationSection<T>[] = [];
  if (!Array.isArray(rows) || rows.length === 0) return sections;

  // 1. Day buckets, in arrival order.
  const days: { key: string; rows: T[] }[] = [];
  for (const row of rows) {
    if (!row) continue;
    const key = dayKeyOf(row.createdAt) || 'undated';
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, rows: [row] });
  }

  for (const day of days) {
    // 2. Cards — RUNS of adjacent rows sharing a card key, not a global group-by.
    //    Web's own list works this way and it is what keeps a card readable as
    //    "this happened, then this" rather than pulling an hours-old row up next
    //    to a fresh one.
    const cards: { key: string; rows: T[] }[] = [];
    for (const row of day.rows) {
      const key = cardKeyOf(row);
      const last = cards[cards.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else cards.push({ key, rows: [row] });
    }

    const built: NotificationCard<T>[] = cards.map((card) => {
      // 3. Items — repeats of one event family collapse into the newest.
      const buckets: { key: string; rows: T[] }[] = [];
      for (const row of card.rows) {
        const key = stackKeyOf(row);
        const found = buckets.find((b) => b.key === key);
        if (found) found.rows.push(row);
        else buckets.push({ key, rows: [row] });
      }
      return {
        key: `${day.key}|${card.key}|${card.rows[0]?.id || ''}`,
        items: buckets.map((b) => buildItem(b.rows)),
      };
    });

    const { label, date } =
      day.key === 'undated'
        ? { label: 'Earlier', date: '' }
        : formatDayLabel(day.key, today);

    sections.push({ key: day.key, label, date, data: built });
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
