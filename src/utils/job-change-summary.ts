export const JOB_CHANGE_ADDENDUM = 'JOB_CHANGE_ADDENDUM';

export const EMPTY = '—';

export type AddendumAction = 'PROPOSED' | 'ACCEPTED' | 'DECLINED';

export interface JobChangeMeta {
  action: AddendumAction;
  draftId: string;
  leadId?: string;
  repName?: string | null;
  actionRequired?: string;
  eventKey?: string;
}

export function getJobChangeMeta(message: any): JobChangeMeta | null {
  const meta = message?.metadata;
  if (!meta || typeof meta !== 'object') return null;
  if (meta.type !== JOB_CHANGE_ADDENDUM) return null;

  const draftId = meta.draftId == null ? '' : String(meta.draftId).trim();
  if (!draftId) return null;

  const action = String(meta.action || '').toUpperCase();
  return {
    draftId,
    action: (action === 'ACCEPTED' || action === 'DECLINED' ? action : 'PROPOSED') as AddendumAction,
    leadId: meta.leadId ? String(meta.leadId) : undefined,
    repName: meta.repName ?? null,
    actionRequired: meta.actionRequired ? String(meta.actionRequired) : undefined,
    eventKey: meta.eventKey ? String(meta.eventKey) : undefined,
  };
}

export function isJobChangeAddendum(message: any): boolean {
  return getJobChangeMeta(message) !== null;
}

export function getJobChangeTitle(message: any): string {
  const candidates = [message?.message, message?.text];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.split('\n')[0].trim();
  }
  return 'Job changes';
}

export function formatChatTime(value: any): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const suffix = d.getHours() >= 12 ? 'PM' : 'AM';
  const hour12 = d.getHours() % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

function withThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMoneyValue(value: any): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return String(value);
  const fixed = Math.abs(n).toFixed(2);
  const [int, dec] = fixed.split('.');
  return `${n < 0 ? '-' : ''}$${withThousands(int)}.${dec}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

export function formatScheduleDate(value: any): string {
  if (value === null || value === undefined) return EMPTY;
  const s = String(value).trim();
  if (!s) return EMPTY;
  if (/^tbd$/i.test(s)) return 'TBD';

  const iso = ISO_DATE.exec(s);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1].slice(2)}`;

  const us = US_DATE.exec(s);
  if (us) {
    const year = us[3].length === 4 ? us[3].slice(2) : us[3].padStart(2, '0');
    return `${Number(us[1])}/${Number(us[2])}/${year}`;
  }
  return s;
}

const TIME_WINDOW_ALIASES: Record<string, string> = {
  morning: '8:00 AM - 12:00 PM',
  afternoon: '12:00 PM - 4:00 PM',
};

export function formatTimeWindow(value: any): string {
  if (value === null || value === undefined) return EMPTY;
  const s = String(value)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .trim();
  if (!s) return EMPTY;
  return TIME_WINDOW_ALIASES[s.toLowerCase()] || s;
}

export function formatScheduleValue(schedule: any): string {
  const parts = [formatScheduleDate(schedule?.date), formatTimeWindow(schedule?.timeWindow)].filter(
    (p) => p && p !== EMPTY
  );
  return parts.length ? parts.join(' · ') : EMPTY;
}

const AUTHORED_ID = /^(field|section|tab)_\d{10,}[\w-]*$/i;

export function cleanChangeFieldLabel(value: any): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const kept = s
    .split('·')
    .map((p) => p.trim())
    .filter((p) => p && !AUTHORED_ID.test(p));
  return kept.length ? kept.join(' · ') : 'Job Build';
}

function displayValue(value: any): string {
  if (value === null || value === undefined) return EMPTY;
  const s = String(value).trim();
  return s || EMPTY;
}

export interface SummaryRow {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface SummaryGroup {
  key: string;
  title: string;
  rows: SummaryRow[];
}

export interface JobChangeSummary {
  status: string;
  isAccepted: boolean;
  isDeclined: boolean;
  groups: SummaryGroup[];
  hasChanges: boolean;
}

const PRICING_FIELDS: { key: string; label: string; money: boolean }[] = [
  { key: 'originalContractPrice', label: 'Contract Price', money: true },
  { key: 'downPayment', label: 'Down Payment', money: true },
  { key: 'balance', label: 'Balance', money: true },
  { key: 'paymentMethod', label: 'Payment Method', money: false },
  { key: 'balancePaymentMethod', label: 'Balance Method', money: false },
];

function formatPricingValue(pricing: any, key: string, money: boolean): string {
  const raw = pricing?.[key];
  if (money) return formatMoneyValue(raw);

  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!s) return EMPTY;

  if (key === 'balancePaymentMethod') {
    const provider = String(pricing?.balancePaymentMethodProvider || '').trim();
    return provider ? `${provider} — ${s}` : s;
  }
  return s;
}

export function buildJobChangeSummary(data: any): JobChangeSummary {
  const current = data?.current || {};
  const proposed = data?.proposed || {};
  const status = String(data?.status || '').toLowerCase();

  const groups: SummaryGroup[] = [];

  const pricingRows = PRICING_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    from: formatPricingValue(current?.pricing, f.key, f.money),
    to: formatPricingValue(proposed?.pricing, f.key, f.money),
  })).filter((r) => r.from !== r.to);
  if (pricingRows.length) groups.push({ key: 'pricing', title: 'Pricing', rows: pricingRows });

  const proposedSchedule = proposed?.jobBuilder?.scheduleTime;
  if (proposedSchedule) {
    const from = formatScheduleValue(current?.jobBuilder?.scheduleTime);
    const to = formatScheduleValue(proposedSchedule);
    if (to !== EMPTY && to !== from) {
      groups.push({
        key: 'schedule',
        title: 'Schedule',
        rows: [{ key: 'installDate', label: 'Install Date', from, to }],
      });
    }
  }

  const buildSummary = Array.isArray(proposed?.buildChangeSummary) ? proposed.buildChangeSummary : [];
  buildSummary.forEach((group: any, gi: number) => {
    const changes = Array.isArray(group?.changes) ? group.changes : [];
    const rows = changes.map((ch: any, ci: number) => ({
      key: `${gi}-${ci}`,
      label: cleanChangeFieldLabel(ch?.field),
      from: displayValue(ch?.from),
      to: displayValue(ch?.to),
    }));
    if (!rows.length) return; // skip groups whose `changes` array is empty
    groups.push({
      key: `build-${gi}`,
      title: String(group?.vertical || group?.section || 'Job Build'),
      rows,
    });
  });

  return {
    status,
    isAccepted: status === 'accepted' || status === 'approved' || status === 'signed',
    isDeclined: status === 'declined',
    groups,
    hasChanges: groups.length > 0,
  };
}
