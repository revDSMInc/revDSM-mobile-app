/**
 * Job-change addendum chat messages — detection + the before/after summary.
 *
 * Spec: `SALES-APP-ADDENDUM-CHAT.md` (2026-08-12). Mirrors the web
 * `src/components/chat-module/job-change-summary.js`.
 *
 * ⚠️ Deliberately PURE — no React, no react-native, no date library. The card and
 * the modal both pull in RN (and therefore can't be exercised under jest in this
 * repo), so every rule that can be got wrong lives here instead.
 */

export const JOB_CHANGE_ADDENDUM = 'JOB_CHANGE_ADDENDUM';

/** What an empty / missing value renders as. */
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

// ── detection (§3.1) ─────────────────────────────────────────────────────────

/**
 * The addendum metadata on a chat message, or `null` for every other message.
 *
 * ⚠️ Gate on this, NEVER on the message text — the copy is server-authored and
 * changes without notice. `metadata` is `null` on ordinary messages, so this
 * cannot false-positive, and an unrecognised `metadata.type` (e.g.
 * `INSTALLER_JOB_STATUS_REQUEST`) returns `null` so future event types fall
 * through to normal bubble rendering rather than rendering as a broken card.
 */
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

/**
 * The card title. The line is already fully rendered server-side — use it
 * verbatim rather than composing one from `repName`, which may be null.
 * Split on newlines defensively; the card is a single row.
 */
export function getJobChangeTitle(message: any): string {
  const candidates = [message?.message, message?.text];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.split('\n')[0].trim();
  }
  return 'Job changes';
}

/** `11:35 AM`. Hand-rolled rather than `toLocaleTimeString` so it cannot depend on Intl. */
export function formatChatTime(value: any): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const suffix = d.getHours() >= 12 ? 'PM' : 'AM';
  const hour12 = d.getHours() % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

// ── value formatting (§4.2) ──────────────────────────────────────────────────

function withThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `15500` → `$15,500.00`. Hand-rolled separators — see `formatChatTime` for why. */
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

/**
 * RULE 2 — parse ISO dates as TEXT, never through a `Date`.
 *
 * ⚠️ `proposed.scheduleTime.date` carries a timezone offset
 * (`2026-08-03T05:00:00+05:00`). Building a local `Date` from that shifts the
 * calendar day for anyone in another timezone — and this is a date a customer
 * signs. Read the `YYYY-MM-DD` prefix off the front of the string instead.
 */
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

/**
 * RULE 3 — normalise the window before comparing.
 *
 * One side of a draft may hold `"Morning"` where the other holds the literal
 * `"8:00 AM - 12:00 PM"` for the same slot; unicode dashes and doubled spaces
 * also occur. Both sides map onto the same canonical string, so an unchanged
 * window can never report as an edit.
 */
export function formatTimeWindow(value: any): string {
  if (value === null || value === undefined) return EMPTY;
  const s = String(value)
    // ⚠️ Written as ESCAPE SEQUENCES, not literal dash characters: U+2010–U+2015
    // and U+2212 are visually indistinguishable from `-` in a diff, so a literal
    // class here is unreviewable and trivially broken by an editor normalising it.
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .trim();
  if (!s) return EMPTY;
  return TIME_WINDOW_ALIASES[s.toLowerCase()] || s;
}

/** The combined schedule row value: `8/3/26 · 8:00 AM - 12:00 PM`. */
export function formatScheduleValue(schedule: any): string {
  const parts = [formatScheduleDate(schedule?.date), formatTimeWindow(schedule?.timeWindow)].filter(
    (p) => p && p !== EMPTY
  );
  return parts.length ? parts.join(' · ') : EMPTY;
}

const AUTHORED_ID = /^(field|section|tab)_\d{10,}[\w-]*$/i;

/**
 * RULE 4 — strip raw authored ids out of a build-change label.
 *
 * Older drafts carry labels like `"Gutters · field_1781585688652_fwjf5"`, which
 * is meaningless to a rep. Drop any `·` segment that is a bare authored id; if
 * that empties the label, fall back to `"Job Build"` rather than showing an id.
 */
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

// ── the summary ──────────────────────────────────────────────────────────────

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
  /** Approved ⇒ PDF, always (§4.2). The changes list is suppressed in this case. */
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

  // Balance Method reads as `GreenSky — 2521`: the bare plan key is unreadable
  // on its own. The provider is taken from the SAME side of the draft, so a
  // provider change shows up as a change.
  if (key === 'balancePaymentMethod') {
    const provider = String(pricing?.balancePaymentMethodProvider || '').trim();
    return provider ? `${provider} — ${s}` : s;
  }
  return s;
}

/**
 * The rendered before/after, containing ONLY rows that actually changed.
 *
 * RULE 1 — every comparison below is made on the FORMATTED values, never the raw
 * ones. The two sides of a draft are written by different screens, so the same
 * install date can be stored as `"7/21/26"` on one side and
 * `"2026-07-21T00:00:00+05:00"` on the other. Comparing raw would report a
 * change the rep never made.
 */
export function buildJobChangeSummary(data: any): JobChangeSummary {
  const current = data?.current || {};
  const proposed = data?.proposed || {};
  const status = String(data?.status || '').toLowerCase();

  const groups: SummaryGroup[] = [];

  // 1. Pricing
  const pricingRows = PRICING_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    from: formatPricingValue(current?.pricing, f.key, f.money),
    to: formatPricingValue(proposed?.pricing, f.key, f.money),
  })).filter((r) => r.from !== r.to);
  if (pricingRows.length) groups.push({ key: 'pricing', title: 'Pricing', rows: pricingRows });

  // 2. Schedule — one combined row.
  // Guarded on the proposed side actually carrying a schedule: a pricing-only
  // addendum leaves it absent, and an absent schedule is "unchanged", not a
  // change to `—`.
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

  // 3. Job build — one group per vertical. `buildChangeSummary` is legitimately
  // `null` on legacy addendums; those show pricing and schedule only.
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
