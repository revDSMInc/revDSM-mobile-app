/**
 * Ordering rule for the Recent Leads list (`screens/ChatThreads`), applied INSIDE each
 * day section by `groupChatsByLeadDate`.
 *
 * Ticket: *"if the lead is Issued Lead and getting the time with lead, the lead should be
 * ordered according to time like 9am, 11am, 1pm, 3pm; if the lead is self-gen then display
 * according to date and time. Today / Yesterday categories stay as they are."*
 *
 * The list was sorted purely by `lastMessageAt || updatedAt || createdAt` (still the order
 * `useChatThreads` returns), so a day's issued leads came out in whatever order the backend
 * last touched them — the rep saw 3pm, 9am, 1pm, 11am under TODAY while every card's own
 * heading said otherwise. Chat recency is the wrong axis for a list whose rows are named
 * after an appointment time.
 *
 * Within a section the two lead kinds reduce to the same question — "what time of day is
 * this?" — so they interleave on one chronological axis rather than being split into blocks:
 *   • issued lead  → `leadTime` ("9am", "1:30 PM") against `leadDate`
 *   • self-gen     → `leadDatetime` / `createdAt`, which is when the rep created it
 *
 * ⚠️ Every date here is read as TEXT (the `YYYY-MM-DDTHH:MM` prefix), never through
 * `new Date()`. An offset ISO string shifts the calendar day either side of midnight, which
 * would file a lead under the wrong section header AND sort it against the wrong day — the
 * same rule the notification grouping follows (`utils/notification-groups.ts`).
 *
 * Pure (no RN imports) so it stays unit-testable: `__tests__/utils/lead-thread-order.test.ts`.
 */

/** Minutes since midnight, or `null` when the section should fall back to a timestamp. */
export function parseLeadTimeMinutes(leadTime?: string | null): number | null {
  if (!leadTime || typeof leadTime !== 'string') return null;
  const text = leadTime.trim().toLowerCase();
  // "N/A" is how an issued-lead payload spells "no appointment time"; `isSelfGeneratedLead`
  // in `utils/location-util.ts` treats the same value as the self-gen marker.
  if (!text || text === 'n/a') return null;

  // "9am", "9 AM", "1:30pm", "11:00 am", and the bare "14" a 24h payload can carry.
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];
  if (Number.isNaN(hours) || hours > 23 || minutes > 59) return null;

  if (meridiem === 'pm' && hours !== 12) hours += 12;
  else if (meridiem === 'am' && hours === 12) hours = 0; // 12am is midnight, not noon
  if (hours > 23) return null;

  return hours * 60 + minutes;
}

/** `{ day: 20260914, minutes: 785 | null }` read straight off the ISO text. */
function readIsoParts(value: any): { day: number; minutes: number | null } | null {
  if (typeof value !== 'string') return null;
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return null;
  const day = Number(`${date[1]}${date[2]}${date[3]}`);
  const time = value.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
  return { day, minutes: time ? Number(time[1]) * 60 + Number(time[2]) : null };
}

const MINUTES_PER_DAY = 1440;

/**
 * Sortable `YYYYMMDD * 1440 + minutes`. Rows whose date cannot be read at all sort last
 * within their section (they are the ones the section header itself had to guess at).
 */
export function leadThreadSortKey(chat: any): number {
  const lead = chat?.leadDetails || {};
  const scheduled = parseLeadTimeMinutes(lead.leadTime);

  // An issued lead's OWN appointment time wins over any timestamp on the record; that time
  // is what the card's heading prints, so it is what the rep is reading the list against.
  const dayCandidates = scheduled !== null
    ? [lead.leadDate, lead.leadDatetime, lead.createdAt, chat?.createdAt]
    : [lead.leadDatetime, lead.createdAt, lead.leadDate, chat?.lastMessageAt, chat?.createdAt];

  for (const candidate of dayCandidates) {
    const parts = readIsoParts(candidate);
    if (!parts) continue;
    const minutes = scheduled !== null ? scheduled : parts.minutes;
    // A date-only self-gen value ("2026-09-13") carries no clock; keep it at the head of its
    // own day rather than inventing a time for it.
    return parts.day * MINUTES_PER_DAY + (minutes ?? 0);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Chronological within the day — 9am, 11am, 1pm, 3pm — matching how the cards are named.
 *
 * ⚠️ Ascending on purpose, unlike the recency sort in `useChatThreads`. The section headers
 * (TODAY, YESTERDAY, …) stay newest-first; it is only the rows inside one day that read
 * forwards, like a schedule.
 *
 * Equal keys keep the incoming order, which is `useChatThreads`' most-recent-activity sort —
 * so two leads sharing a time slot still lead with the one that moved last. `Array.sort` is
 * stable (ES2019) in both Hermes and JSC, so this needs no explicit tiebreak.
 */
export function sortLeadThreadsByLeadTime<T>(chats: T[]): T[] {
  return [...chats].sort((a, b) => leadThreadSortKey(a) - leadThreadSortKey(b));
}
