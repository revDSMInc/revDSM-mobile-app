/**
 * report-job-connectivity.ts — what a long-running SERVER job should say when the signal drops.
 *
 * The case this exists for, from the field: a rep starts a Risk Report or a revRender at a door,
 * walks round the back of the house, and loses signal. Three things were on screen and all three
 * lied.
 *
 *   - The **revRender** bar kept climbing. Its progress is a `setInterval` that advances
 *     0→20→67→80% on elapsed time ALONE (`startMockProgress`), with no server contact, so it went
 *     right on filling while nothing was happening.
 *   - The **Risk Report** bar froze mid-sentence on its last server `step` — "Fetching historical
 *     data for 2023…" — naming work that nobody was doing, forever, because the poll's `catch`
 *     only logged and the 3s interval retried for as long as the screen was open.
 *   - A black **"Polling error: {"message":"Network Error"}"** toast, which is axios' own
 *     untranslated wording and not a sentence anyone should read.
 *
 * ⚠️ The distinction that drives every rule below: losing signal is NOT the job failing. The
 * generation runs on the SERVER. It was accepted, it has a jobId, and it is very probably still
 * going — the device has merely lost the ability to ask. Marking it `failed` would be a lie in the
 * opposite direction and, worse, would invite the rep to start it again: a second billed AI render,
 * or a duplicate report, for a job that was always going to finish. So the state is WAITING, and
 * the bar holds its last honest number until the device can ask again.
 *
 * ⚠️ Keyed off the ERROR, never off `isOnline()` — the same rule `utils/network-error.ts` records.
 * A poll that dies in a tunnel is the same event whatever the connectivity model believed when it
 * was sent, and the absence of an HTTP status is the honest signal. A 500 from the report service
 * is a real failure and must stay one.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md §6 — every consumer pulls in React Native).
 */

import { isNetworkError } from './network-error';

/** What the card should say and do about a job that is mid-flight. */
export interface JobWaitState {
  /** True once a poll has failed on transport and the job has not since been reached. */
  waiting: boolean;
  /** The line under the bar. Replaces the stale server `step` while waiting. */
  label: string;
  /** Should the mock progress timer keep advancing? Never, while waiting. */
  advance: boolean;
}

/**
 * The one colour a paused job is drawn in — amber, not red.
 *
 * ⚠️ Red would say "this failed", which is the opposite of true: the job is running on the server
 * and will finish. Amber says "held", and matches `OfflineBanner`'s own register. Declared here as
 * a plain hex rather than a Tailwind class because the pitch-book sheet renders over the dark
 * presentation theme, where utility colour pairs read wrong.
 */
export const WAITING_AMBER = '#B45309';

/** The line shown under a paused bar. One sentence, no axios wording, no blame. */
export const WAITING_LABEL = 'Paused — waiting for signal. This will finish on its own.';

/**
 * Should this poll rejection pause the job rather than fail it?
 *
 * A transport failure pauses. Anything the server actually answered — a 404 on the jobId, a 500
 * from the generator — is a real verdict and must fall through to the existing failure handling.
 */
export const isWaitingForSignal = (err: unknown): boolean => isNetworkError(err);

/**
 * The job's display state, given its last server `step` and whether it is currently unreachable.
 *
 * ⚠️ `step` is deliberately DROPPED while waiting. Holding "Fetching historical data for 2023…" on
 * screen for ten minutes is the specific thing reported, and it is worse than no label: it is a
 * live-sounding sentence about work that has stopped being observed.
 */
export const jobWaitState = (step: string | null | undefined, unreachable: boolean): JobWaitState =>
  unreachable
    ? { waiting: true, label: WAITING_LABEL, advance: false }
    : {
        waiting: false,
        label: (typeof step === 'string' && step.trim()) || 'Processing...',
        advance: true,
      };

/**
 * Should a poll rejection be announced to the rep at all?
 *
 * No — never, for a transport failure on a poll. A poll is a READ, `OfflineBanner` is already
 * saying "you are offline" app-wide, and the card itself now carries the paused label. A toast per
 * 3s tick (which is what "Polling error" was) is the worst possible version of that.
 */
export const shouldAnnouncePollFailure = (err: unknown): boolean => !isNetworkError(err);
