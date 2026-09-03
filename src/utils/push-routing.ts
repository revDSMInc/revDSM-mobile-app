/**
 * Push notification routing — the pure layer.
 *
 * Maps an FCM `data` payload to a destination, and decides what may be shown.
 * Deliberately has NO react-native imports: this repo cannot render-test, and a
 * wrong route or a mis-read flag is silent in review. Same reasoning as
 * `utils/addendum-drafts.ts` and `utils/inspection-photos.ts`.
 *
 * Contract: NOTIFICATIONS-MOBILE-API.md (branch revDSMUIUX-97).
 *
 * ⚠️ THREE RULES FROM THAT CONTRACT, all of which bite:
 *
 *   1. EVERY VALUE IS A STRING. FCM rejects a message whose `data` holds a
 *      non-string, so the backend coerces the whole payload immediately before
 *      sending (`PushHandler.toFcmDataPayload`). `data.isDynamic === true` is
 *      therefore ALWAYS false — use `pushBool`.
 *
 *   2. NULL VALUES ARE DROPPED, NOT STRINGIFIED. An optional key is ABSENT, not
 *      `null`. `leadId`, `reason`, `issuedLeadId` and `appointmentId` are all
 *      missing in some payloads; reading one as required throws.
 *
 *   3. AN UNKNOWN eventType MUST RETURN null, NEVER THROW. That is what lets a
 *      backend deploy ship ahead of a client release.
 *
 * ⚠️ The notification HISTORY api returns the SAME notification with TYPED
 * values (`true`, `3`, `null`) rather than strings. `pushBool` / `pushNum` are
 * for the PUSH path only — see `services/api/notifications.ts`.
 */

/** The nine rep-facing events. Not a union of everything the backend can send. */
export type PushEventType =
  | 'chat-message'
  | 'chat-reply'
  | 'chat-file-upload'
  | 'chat-tagged'
  | 'lead-issued'
  | 'appointment-issued'
  | 'addendum-signed'
  | 'agreement-signed'
  | 'lead-cancelled';

/** Rule 1: the payload is a flat string map, and rule 2 makes every key optional. */
export type PushData = Record<string, string | undefined>;

export type PushRoute =
  | { kind: 'chat'; chatId: string; leadId?: string; chatType: 'lead' | 'channel' }
  | { kind: 'lead'; leadId: string; tab?: 'job_docs' | 'tools' }
  /**
   * Straight into the dynamic Job Builder, on its Summary step.
   *
   * Only `agreement-signed` resolves here, and the reason is the order of the real
   * flow: the customer signing the agreement is what UNBLOCKS submitting the job,
   * so at the moment this notification fires the build is always still open. The
   * rep's next action is "Complete Job", and Job Docs is a detour.
   *
   * ⚠️ `addendum-signed` deliberately does NOT resolve here. An addendum is raised
   * against an ALREADY-submitted deal, so there is no job left to complete.
   *
   * ⚠️ The Job Builder is NOT a route — it is a step inside `DynamicDealCenter`,
   * which assembles the nine props it needs from four hooks. The caller therefore
   * navigates to `DynamicDealCenter` with `openJobBuilder`, never to the builder
   * itself; anything that skipped it would mount an empty summary.
   *
   * ⚠️ Requires a DYNAMIC lead with a resolvable calculator. The caller falls back
   * to `{ kind: 'lead', tab: 'job_docs' }` when either is missing — a legacy lead
   * has no dynamic builder to open.
   */
  | {
      kind: 'jobBuilder';
      leadId: string;
      /**
       * From the push's own `isDynamic`, when it sent one.
       *
       * ⚠️ `undefined` is a THIRD state, not a false — the in-person sign flow
       * (`/pdf-reports/v1/agreement/:leadId/sign`) sends neither `isDynamic` nor
       * `count`, so the key is simply absent. Callers must fall back to the lead
       * record rather than reading an absent flag as "not dynamic".
       */
      isDynamic?: boolean;
    }
  | { kind: 'leadList' }
  | null;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Rule 1. Never write `data.someFlag === true` against a push payload.
 * `agreement-signed` carries `isDynamic` as the string "true" / "false".
 */
export const pushBool = (v: unknown): boolean => str(v).toLowerCase() === 'true';

/**
 * Rule 1 again — `count` arrives as "3", and is absent entirely on the flows
 * that do not aggregate. Returns undefined rather than NaN or 0, so "absent"
 * and "zero" stay distinguishable.
 */
export const pushNum = (v: unknown): number | undefined => {
  const raw = str(v);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const CHAT_EVENTS = new Set<string>([
  'chat-message',
  'chat-reply',
  'chat-file-upload',
  'chat-tagged',
]);

/**
 * Values in the backend's vocabulary that are NOT rep notifications.
 *
 * ⚠️ `go-back` is a CONTROL event the backend deliberately never writes to
 * history — rendering it as a notification would show the rep a banner that
 * exists nowhere in the app. `lead` is a legacy value.
 */
export const NON_NOTIFICATION_EVENTS = new Set<string>(['go-back', 'lead']);

/** May this payload be displayed at all? Gate every display path on this. */
export function isRenderable(data: PushData | undefined | null): boolean {
  const type = str(data?.eventType);
  return Boolean(type) && !NON_NOTIFICATION_EVENTS.has(type);
}

/**
 * Where a notification should land when tapped.
 *
 * Returns null for anything unroutable — an unknown type, a control event, or a
 * known type missing the id it needs. The caller opens the app and changes
 * nothing, which is always better than guessing a destination.
 */
export function resolvePushRoute(data: PushData | undefined | null): PushRoute {
  const type = str(data?.eventType);
  if (!type || NON_NOTIFICATION_EVENTS.has(type)) return null;

  const leadId = str(data?.leadId);

  if (CHAT_EVENTS.has(type)) {
    const chatId = str(data?.chatId);
    if (!chatId) return null;
    // ⚠️ `leadId` is ABSENT on channel chats (threads not attached to a lead).
    // That absence IS the discriminator — there is no chatType field on the
    // payload, and chatId is the only id that can be relied on here.
    return {
      kind: 'chat',
      chatId,
      leadId: leadId || undefined,
      chatType: leadId ? 'lead' : 'channel',
    };
  }

  switch (type) {
    /**
     * ⚠️ NEVER carries a `leadId`. Three shapes:
     *   - single issue   → `issuedLeadId`, deep-linkable
     *   - bulk issue     → `count` only
     *   - route dispatch → `count` only, ONE push per rep rather than per route
     * The last two name no lead, so the list is the only honest destination.
     */
    case 'lead-issued': {
      const issued = str(data?.issuedLeadId);
      return issued ? { kind: 'lead', leadId: issued } : { kind: 'leadList' };
    }

    case 'appointment-issued':
    case 'lead-cancelled':
      return leadId ? { kind: 'lead', leadId } : null;

    // Both land on Contract Details, which lives in the Job Docs tab.
    /**
     * The agreement is signed, so the job can now be submitted — take the rep to
     * the builder's Summary rather than to the documents. See the `jobBuilder`
     * note on `PushRoute` for why this one event differs from the addendum.
     */
    case 'agreement-signed':
      return leadId
        ? {
            kind: 'jobBuilder',
            leadId,
            // Absent key stays undefined — see the note on the route type.
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

/**
 * ⚠️ `addendum-signed` is sent for a DECLINE as well as an accept, and the
 * title reads "Addendum signed" either way. `data.outcome` and the message body
 * are the only things that separate them — branch here, never on the title.
 *
 * Returns 'unknown' rather than assuming when the key is absent: refresh the
 * screen, but do not tell the rep which way it went.
 */
export function addendumOutcome(data: PushData | undefined | null): AddendumOutcome {
  const outcome = str(data?.outcome).toLowerCase();
  return outcome === 'accepted' || outcome === 'declined' ? outcome : 'unknown';
}

/**
 * Should an arriving push be swallowed because the rep is already looking at it?
 *
 * Only ever true for a chat the rep has open. A banner for the message they are
 * currently reading is the single most-complained-about push behaviour, and the
 * message itself already appears inline via the socket.
 */
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

/**
 * Which Android channel a notification belongs to.
 *
 * Three rather than one so a rep can silence chatter without also silencing a
 * lead assignment. Falls back to `messages` for an unrecognised type, which is
 * the channel the manifest names as the OS default.
 */
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

/**
 * React Query keys to invalidate when this event arrives, so the screen the rep
 * lands on is already correct rather than correcting itself under them.
 *
 * Kept here, beside the routing, because the two answer the same question — what
 * does this event affect — and splitting them is how they drift apart.
 */
export function invalidationKeysFor(data: PushData | undefined | null): unknown[][] {
  const type = str(data?.eventType);
  const leadId = str(data?.leadId);
  const keys: unknown[][] = [];

  // Every renderable event is also written to the notification history, so the
  // bell's count and the list are stale the moment one arrives. Prefix-only: the
  // keys carry the user id, which this module has no business knowing.
  if (isRenderable(data)) {
    keys.push(['notification-unread']);
    keys.push(['notification-history']);
  }

  switch (type) {
    case 'addendum-signed':
      if (leadId) {
        // Two independent surfaces read a draft's status. Refreshing only one
        // leaves them contradicting each other on the same screen.
        keys.push(['lead-pending-addendums', leadId]);
        keys.push(['lead-job-builder-drafts', leadId]);
      }
      break;

    case 'agreement-signed':
      if (leadId) keys.push(['leadOutcome', leadId]);
      break;

    case 'lead-cancelled':
      if (leadId) {
        // The lead record itself changed (`result` → cancelled), which is what
        // the JOB CANCELLED bar in DealBanners renders from.
        keys.push(['lead', leadId]);
        keys.push(['lead-job-builder-drafts', leadId]);
      }
      break;

    case 'lead-issued':
    case 'appointment-issued':
      // `useLeadsData` keys on ['leads', params]; the bare prefix invalidates
      // every filter variant, which is what a newly issued lead needs.
      keys.push(['leads']);
      // ⚠️ Prefix only for lead-calc-status too. Its keys carry appointmentId /
      // leadDate segments that can drift between copies of the same lead, so only
      // the lead id is dependable — the rule `markLeadRolloutsConfirmed` follows.
      if (leadId) keys.push(['lead-calc-status', leadId]);
      break;

    default:
      break;
  }

  return keys;
}
