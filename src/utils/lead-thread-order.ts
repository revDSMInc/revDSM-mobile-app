export function parseLeadTimeMinutes(leadTime?: string | null): number | null {
  if (!leadTime || typeof leadTime !== 'string') return null;
  const text = leadTime.trim().toLowerCase();
  if (!text || text === 'n/a') return null;

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

function readIsoParts(value: any): { day: number; minutes: number | null } | null {
  if (typeof value !== 'string') return null;
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return null;
  const day = Number(`${date[1]}${date[2]}${date[3]}`);
  const time = value.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
  return { day, minutes: time ? Number(time[1]) * 60 + Number(time[2]) : null };
}

const MINUTES_PER_DAY = 1440;

export function leadThreadSortKey(chat: any): number {
  const lead = chat?.leadDetails || {};
  const scheduled = parseLeadTimeMinutes(lead.leadTime);

  const dayCandidates = scheduled !== null
    ? [lead.leadDate, lead.leadDatetime, lead.createdAt, chat?.createdAt]
    : [lead.leadDatetime, lead.createdAt, lead.leadDate, chat?.lastMessageAt, chat?.createdAt];

  for (const candidate of dayCandidates) {
    const parts = readIsoParts(candidate);
    if (!parts) continue;
    const minutes = scheduled !== null ? scheduled : parts.minutes;
    return parts.day * MINUTES_PER_DAY + (minutes ?? 0);
  }
  return Number.MAX_SAFE_INTEGER;
}

export function sortLeadThreadsByLeadTime<T>(chats: T[]): T[] {
  return [...chats].sort((a, b) => leadThreadSortKey(a) - leadThreadSortKey(b));
}
