export interface NotificationLike {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  isUnread: boolean;
  eventType: string;
  payload: Record<string, any>;
}

export interface NotificationItem<T extends NotificationLike = NotificationLike> {
  key: string;
  row: T;
  title: string;
  message: string;
  tag: string;
  time: string;
  isUnread: boolean;
}

export interface NotificationSection<T extends NotificationLike = NotificationLike> {
  key: string;
  label: string;
  date: string;
  data: NotificationItem<T>[];
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function dayKeyOf(iso: string): string {
  const m = ISO.exec(str(iso));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export function todayKey(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  if (!fromKey || !toKey) return 0;
  const a = fromKey.split('-').map(Number);
  const b = toKey.split('-').map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return 0;
  const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
  return Math.round(ms / 86400000);
}

export function formatDayDate(dayKey: string): string {
  const parts = dayKey.split('-');
  if (parts.length !== 3) return '';
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!MONTHS[mo - 1] || !d) return '';
  return `${MONTHS[mo - 1]} ${d}`;
}

export function formatDayLabel(dayKey: string, today: string): { label: string; date: string } {
  const date = formatDayDate(dayKey);
  const diff = daysBetween(dayKey, today);
  if (diff <= 0) return { label: 'Today', date };
  if (diff === 1) return { label: 'Yesterday', date };
  if (diff < 7) return { label: `${diff} days ago`, date };
  return { label: date, date: '' };
}

export function formatClockTime(iso: string): string {
  const m = ISO.exec(str(iso));
  if (!m) return '';
  const hour = Number(m[4]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[5]} ${suffix}`;
}

const LEAD_TAG_KEYS = [
  'leadNumber',
  'humanLeadId',
  'leadIdentifier',
  'leadLabel',
  'leadId',
  'selfGenLeadId',
  'issuedLeadId',
  'leadCode',
];

const MONGO_ID = /^[0-9a-f]{24}$/i;
const NOT_A_TAG = new Set(['n/a', 'na', 'none', 'null', 'undefined', '-']);

export function leadTagOf(payload: Record<string, any> | undefined | null): string {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of LEAD_TAG_KEYS) {
    const raw = str(payload[key]);
    if (!raw) continue;
    if (MONGO_ID.test(raw)) continue;
    if (NOT_A_TAG.has(raw.toLowerCase())) continue;
    if (raw.length > 16) continue;
    return raw;
  }
  return '';
}

function buildItem<T extends NotificationLike>(row: T): NotificationItem<T> {
  return {
    key: row.id || `${row.eventType}|${row.createdAt}`,
    row,
    title: row.title,
    message: row.message,
    tag: leadTagOf(row.payload),
    time: formatClockTime(row.createdAt),
    isUnread: Boolean(row.isUnread),
  };
}

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
          { label: 'Earlier', date: '' }
        : formatDayLabel(key, today);
    sections.push({ key, label, date, data: [buildItem(row)] });
  }

  return sections;
}

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
