/**
 * Re-claiming the lead the rep is still standing on, after the app comes back to the foreground.
 *
 * ⚠️ THE BUG THIS EXISTS TO PREVENT (two halves, one of them already fixed server-side).
 *
 * Half one, fixed by the backend: backgrounding or killing the app drops the socket, and a lead
 * whose rep has vanished must not stay "ON SITE" on the ops board for ever - so a socket
 * disconnect now PAUSES the work server-side.
 *
 * Half two, this file: that pause fires on a plain background too. A rep who checks a text and
 * returns five seconds later is standing at the same door, on the same lead, with the app showing
 * the lead open - and the server has them paused. The app must re-assert the session on
 * foreground, or the board is wrong for as long as they stay on that lead.
 *
 * ⚠️ The resume is NOT the same event as a check-in. `workLead` re-claims the lead; the activity
 * log entry is `lead_resume`, not `lead_check_in` - the rep never left, and logging a second
 * check-in would double-count the visit.
 *
 * Pure so it can be tested: the caller owns `AppState`, the clock and the API (CLAUDE.md §6).
 */

export type AppStateLike = 'active' | 'background' | 'inactive' | string;

/**
 * Did the app just come back to the FOREGROUND?
 *
 * ⚠️ iOS sends `inactive` constantly - the app switcher, a notification shade, a permission
 * sheet, an incoming call banner. Treating every `inactive → active` as a return would fire a
 * resume on each of those. Only a real `background → active` counts.
 */
export const isForegroundReturn = (
  previous: AppStateLike | null | undefined,
  next: AppStateLike
): boolean => next === 'active' && previous === 'background';

/** The smallest gap worth a round trip: below this the socket almost certainly never dropped. */
export const RESUME_MIN_BACKGROUND_MS = 1_500;

export interface ResumeDecisionInput {
  /** The lead the app still believes is open (from MMKV), if any. */
  sessionLeadId?: string | null;
  /** Is the rep still looking at that same lead? */
  visibleLeadId?: string | null;
  online: boolean;
  /** True for a client-generated id: there is no server record to re-claim yet. */
  isOfflineLead: boolean;
  backgroundedForMs: number;
}

export type ResumeDecision = 'resume' | 'skip-no-session' | 'skip-offline' | 'skip-too-brief' | 'skip-left-lead';

/**
 * Should the app re-claim the lead now?
 *
 * ⚠️ `skip-left-lead` is the one that matters for correctness. If the rep backgrounded the app
 * on lead A and came back having navigated away - or the session was ended while they were gone -
 * re-asserting A would put a rep ON SITE at a door they are not at. Only re-claim the lead that
 * is still on screen.
 */
export const resumeDecision = ({
  sessionLeadId,
  visibleLeadId,
  online,
  isOfflineLead,
  backgroundedForMs,
}: ResumeDecisionInput): ResumeDecision => {
  const id = String(sessionLeadId || '');
  if (!id) return 'skip-no-session';
  if (String(visibleLeadId || '') !== id) return 'skip-left-lead';
  if (backgroundedForMs < RESUME_MIN_BACKGROUND_MS) return 'skip-too-brief';
  // An offline lead has no server record to re-claim; the queued work carries the check-in.
  if (isOfflineLead) return 'skip-offline';
  if (!online) return 'skip-offline';
  return 'resume';
};

export const shouldResume = (input: ResumeDecisionInput): boolean =>
  resumeDecision(input) === 'resume';
