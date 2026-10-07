export type PushEventType =
  | 'chat-message'
  | 'chat-reply'
  | 'chat-file-upload'
  | 'chat-tagged'
  | 'chat-reaction'
  | 'lead-issued'
  | 'appointment-issued'
  | 'addendum-signed'
  | 'agreement-signed'
  | 'lead-cancelled';

export type PushData = Record<string, string | undefined>;

export type PushRoute =
  | { kind: 'chat'; chatId: string; leadId?: string; chatType: 'lead' | 'channel' }
  | { kind: 'lead'; leadId: string; tab?: 'job_docs' | 'tools' }
  | {
      kind: 'jobBuilder';
      leadId: string;
      isDynamic?: boolean;
    }
  | { kind: 'leadList' }
  | null;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const pushBool = (v: unknown): boolean => str(v).toLowerCase() === 'true';

export const pushNum = (v: unknown): number | undefined => {
  const raw = str(v);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

export const CHAT_EVENTS: ReadonlySet<string> = new Set<string>([
  'chat-message',
  'chat-reply',
  'chat-file-upload',
  'chat-tagged',
  'chat-reaction',
]);

export const NON_NOTIFICATION_EVENTS = new Set<string>(['go-back', 'lead']);

export function isRenderable(data: PushData | undefined | null): boolean {
  const type = str(data?.eventType);
  return Boolean(type) && !NON_NOTIFICATION_EVENTS.has(type);
}

export function resolvePushRoute(data: PushData | undefined | null): PushRoute {
  const type = str(data?.eventType);
  if (!type || NON_NOTIFICATION_EVENTS.has(type)) return null;

  const leadId = str(data?.leadId);

  if (CHAT_EVENTS.has(type)) {
    const chatId = str(data?.chatId);
    if (!chatId) return null;
    return {
      kind: 'chat',
      chatId,
      leadId: leadId || undefined,
      chatType: leadId ? 'lead' : 'channel',
    };
  }

  switch (type) {
    case 'lead-issued':
      return { kind: 'leadList' };

    case 'appointment-issued':
    case 'lead-cancelled':
      return leadId ? { kind: 'lead', leadId } : null;

    case 'agreement-signed':
      return leadId
        ? {
            kind: 'jobBuilder',
            leadId,
            isDynamic:
              data?.isDynamic === undefined ? undefined : pushBool(data?.isDynamic),
          }
        : null;

    case 'addendum-signed':
      return leadId ? { kind: 'lead', leadId, tab: 'job_docs' } : null;

    default:
      return null;
  }
}

export type AddendumOutcome = 'accepted' | 'declined' | 'unknown';

export function addendumOutcome(data: PushData | undefined | null): AddendumOutcome {
  const outcome = str(data?.outcome).toLowerCase();
  return outcome === 'accepted' || outcome === 'declined' ? outcome : 'unknown';
}

export function shouldSuppressForeground(
  data: PushData | undefined | null,
  currentRouteName: string | null,
  openChatId: string | null
): boolean {
  const route = resolvePushRoute(data);
  if (!route || route.kind !== 'chat') return false;
  if (currentRouteName !== 'ChatDetail') return false;
  return Boolean(openChatId) && String(openChatId) === String(route.chatId);
}

export const CHANNEL_MESSAGES = 'messages';
export const CHANNEL_LEADS = 'leads';
export const CHANNEL_SIGNATURES = 'signatures';

export function channelForEvent(data: PushData | undefined | null): string {
  const type = str(data?.eventType);
  if (CHAT_EVENTS.has(type)) return CHANNEL_MESSAGES;
  switch (type) {
    case 'lead-issued':
    case 'appointment-issued':
    case 'lead-cancelled':
      return CHANNEL_LEADS;
    case 'addendum-signed':
    case 'agreement-signed':
      return CHANNEL_SIGNATURES;
    default:
      return CHANNEL_MESSAGES;
  }
}

export function invalidationKeysFor(data: PushData | undefined | null): unknown[][] {
  const type = str(data?.eventType);
  const leadId = str(data?.leadId);
  const keys: unknown[][] = [];

  if (isRenderable(data)) {
    keys.push(['notification-unread']);
    keys.push(['notification-history']);
  }

  switch (type) {
    case 'addendum-signed':
      if (leadId) {
        keys.push(['lead-pending-addendums', leadId]);
        keys.push(['lead-job-builder-drafts', leadId]);
      }
      break;

    case 'agreement-signed':
      if (leadId) keys.push(['leadOutcome', leadId]);
      break;

    case 'lead-cancelled':
      if (leadId) {
        keys.push(['lead', leadId]);
        keys.push(['lead-job-builder-drafts', leadId]);
      }
      break;

    case 'lead-issued':
    case 'appointment-issued':
      keys.push(['leads']);
      if (leadId) keys.push(['lead-calc-status', leadId]);
      break;

    default:
      break;
  }

  return keys;
}
