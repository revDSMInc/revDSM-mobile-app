/**
 * offline-capability.ts — the ONE list of what a rep cannot do with no signal, and what to say.
 *
 * Most of this app works at a door: leads, the Deal Center, the Job Builder, the agreement, the
 * consent form, the pitch books, the Investment Center. What is listed here is the remainder — the
 * handful of features that are genuinely IMPOSSIBLE offline, because the thing they produce is
 * produced somewhere else.
 *
 * ⚠️ This is not a to-do list. A risk report is assembled from a weather-history service, an
 * inspection report and the two form PDFs are rendered by the backend, a revRender is an AI
 * generation, and a chat is a conversation with a person who is not here. None of that becomes
 * possible with more client code.
 *
 * What IS a defect, and what this file exists to fix, is the FAILURE MODE. Every one of these used
 * to die the same anonymous way — the request threw, a `catch` swallowed it, and the rep was left
 * with a spinner that never resolved, an empty list that read as "you have nothing", or a button
 * that did nothing at all. Each screen then reported it differently, or not at all. A rep in front
 * of a customer taps that a second time.
 *
 * ⚠️ Pure and RN-free on purpose, for the reason `utils/consent-forms.ts` and
 * `utils/offline-deal-center.ts` are: every consumer pulls in React Native and is untestable under
 * jest here, and the thing that goes wrong is not a crash — it is one surface promising what
 * another refuses, or a feature that DOES work offline being blocked by a stray registry entry.
 *
 * ⚠️ The app already says "you are offline", once, in `OfflineBanner`. Nothing here repeats that;
 * every message below says what THIS feature specifically cannot do, which is the part the banner
 * cannot know.
 */

/** Why the feature cannot run here. Kept distinct because the honest message differs. */
export type OfflineReason =
  /** The artefact is produced by a server; the device has no equivalent and cannot fake one. */
  | 'server-generated'
  /** The document EXISTS and is filed — only its pre-signed link has expired. */
  | 'expired-link'
  /** A live exchange with someone who is not on this device. */
  | 'realtime'
  /** A write onto a record only the server holds, which nothing local can stand in for. */
  | 'server-record';

export interface OfflineNotice {
  reason: OfflineReason;
  /** Flash title, or an empty-state heading. */
  title: string;
  /** What cannot happen, and — where there is one — what still can. */
  message: string;
}

/**
 * ⚠️ Read this before adding an entry: an id in here BLOCKS the feature offline. Anything with a
 * device-side path — the consent and waiver FORMS, the Deal Center, the Job Builder, the offline
 * agreement — must never be listed, and blocking one would take away exactly what a rep most needs
 * at a door with no signal. Add an entry only when the feature cannot produce its result at all.
 */
export const OFFLINE_FEATURES: Record<string, OfflineNotice> = {
  // ─── Lead Center ▸ Tools ────────────────────────────────────────────────────
  'risk-generate': {
    reason: 'server-generated',
    title: 'Needs a connection',
    message:
      'A risk report is built from weather history on the server, so it needs a connection. Your other tools still work.',
  },
  inspection: {
    reason: 'server-generated',
    title: 'Needs a connection',
    message: 'The inspection report is generated on the server, so it needs a connection.',
  },
  revrender: {
    reason: 'server-generated',
    title: 'Needs a connection',
    message:
      'revRender generates the image on the server, so it needs a connection. Renders you generated earlier are still here.',
  },

  // ─── Opening a document that is already filed ───────────────────────────────
  //
  // ⚠️ A different failure from the three above, and worth keeping straight: the document exists.
  // Only the pre-signed link has expired. Saying "not available" would read as "not filed", which
  // on a consent form is the difference between presenting a quote and not.
  'consent-download': EXPIRED_LINK(),
  'waiver-download': EXPIRED_LINK(),
  'inspection-preview': EXPIRED_LINK(),
  'inspection-download': EXPIRED_LINK(),
  'risk-preview': EXPIRED_LINK(),
  'risk-download': EXPIRED_LINK(),

  // ─── Talking to someone who is not here ─────────────────────────────────────
  chat: {
    reason: 'realtime',
    title: 'Messages need a connection',
    message:
      'Ops chat is live, so it needs a connection. Nothing you send now would reach them — try again once you have signal.',
  },
  'chat-send': {
    reason: 'realtime',
    title: 'Messages need a connection',
    message: 'This message cannot be sent offline. It is not saved — send it again once you have signal.',
  },
  notifications: {
    reason: 'realtime',
    title: 'Notifications need a connection',
    message: 'New notifications arrive from the server. You will see them the moment you reconnect.',
  },

  // ─── Writes onto a record only the server holds ─────────────────────────────
  referral: {
    reason: 'server-record',
    title: 'Needs a connection',
    message: 'A referral is filed on the server, so it needs a connection. Take their details and send it once you are back online.',
  },
  'job-tracker-write': {
    reason: 'server-record',
    title: 'Needs a connection',
    message: 'Job Tracker changes are saved on the server, so they need a connection.',
  },
  addendum: {
    reason: 'server-record',
    title: 'Needs a connection',
    message:
      'An addendum is raised on the server and texts the customer a signing link, so it needs a connection.',
  },
};

/** The shared expired-link notice. Declared as a function so each entry gets its own object. */
function EXPIRED_LINK(): OfflineNotice {
  return {
    reason: 'expired-link',
    title: 'Needs a connection',
    message:
      'This document is on file, but opening it needs a connection — its download link has expired.',
  };
}

/**
 * The notice for a feature, or `null` when it works offline.
 *
 * ⚠️ `null` is the answer for everything not listed, and that direction is deliberate: an unknown
 * id must fall through to the feature's normal behaviour, never to a block. A registry that fails
 * closed would disable a working feature the day someone renames an id — silently, and only for
 * reps with no signal, which is the population least able to report it.
 */
export const offlineNoticeFor = (featureId: unknown): OfflineNotice | null => {
  const id = typeof featureId === 'string' ? featureId.trim() : '';
  return (id && OFFLINE_FEATURES[id]) || null;
};

/** Is this feature blocked right now? `online` is passed in so the rule stays pure. */
export const isBlockedOffline = (featureId: unknown, online: boolean): boolean =>
  !online && !!offlineNoticeFor(featureId);

/**
 * The notice to show, or `null` to proceed — the single expression every call site uses.
 *
 * Keeping the online test INSIDE this helper is what stops a caller checking connectivity and the
 * registry in the wrong order, which reads as a feature that is blocked even on full signal.
 */
export const offlineBlockFor = (featureId: unknown, online: boolean): OfflineNotice | null =>
  online ? null : offlineNoticeFor(featureId);
