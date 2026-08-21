/**
 * The installer's open work session — `PUT installer/v1/{jobId}/work`.
 *
 * Check-IN stamps `workStartedBy` from the bearer token; check-OUT clears it with
 * `{ workStartedBy: null }`. While it is set, the office sees that installer as being on
 * that job, so a session left open is a crew member who looks busy on a job they walked
 * away from hours ago.
 *
 * The screen unmounting is only ONE way that happens. This module exists because the
 * others do not go through the screen at all:
 *
 *  - **Logging out** — the token is cleared first, so a check-out fired from the screen's
 *    own cleanup goes up unauthenticated and is dropped.
 *  - **Backgrounding the app** — nothing unmounts; the session simply stops being worked.
 *  - **Killing the app** — no cleanup runs at all, so the session is closed on the next
 *    launch instead (`endStaleInstallerWorkSession`).
 *
 * So the job id is written to MMKV when the session opens. Every exit reads it back from
 * there rather than from React state, which is what makes those three cases reachable.
 */

import { Storage } from './storage';
import { InstallerService } from '../services/api/installer';

/** Where the open session's job id lives between screens — and across app launches. */
const ACTIVE_WORK_JOB_KEY = 'installer:activeWorkJob';

/** Why a session was closed. Logged, and useful when reading a device trace. */
export type WorkSessionEndReason =
  | 'left_job'
  | 'logout'
  | 'app_background'
  | 'stale_launch';

export const getActiveInstallerWorkJobId = (): string | undefined => {
  try {
    return Storage.getItem(ACTIVE_WORK_JOB_KEY) || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Records that a job now has an open work session.
 *
 * Called after a successful check-in. A storage failure is swallowed: it costs the
 * ability to close the session from outside the screen, and must never block the
 * installer from opening the job.
 */
export const beginInstallerWorkSession = (jobId?: string): void => {
  if (!jobId) return;
  try {
    Storage.setItem(ACTIVE_WORK_JOB_KEY, jobId);
  } catch {
    // no-op — see above.
  }
};

const clearActiveInstallerWorkJob = (): void => {
  try {
    Storage.removeItem(ACTIVE_WORK_JOB_KEY);
  } catch {
    // no-op
  }
};

/**
 * Closes the open session, whatever ended it.
 *
 * ⚠️ **The record is cleared BEFORE the request goes out**, deliberately. Two exits can
 * fire within a frame of each other — backgrounding the app while the screen is being
 * torn down, or a logout that unmounts the job screen — and the second must not send a
 * duplicate check-out for a session that is already closing. Clearing first makes the
 * second call a no-op.
 *
 * Never throws: a failed check-out is logged and swallowed. The session is the server's
 * to reconcile, and there is nothing the installer can do about it from here.
 *
 * Returns the job id it closed, so a caller can decide whether to reopen it.
 */
export const endInstallerWorkSession = async (
  reason: WorkSessionEndReason,
  jobId?: string
): Promise<string | undefined> => {
  const id = jobId || getActiveInstallerWorkJobId();
  if (!id) return undefined;

  clearActiveInstallerWorkJob();

  try {
    await InstallerService.endWork(id);
    console.log(`[InstallerWork] Checked out of ${id} (${reason}).`);
  } catch (err) {
    console.warn(`[InstallerWork] Check-out failed (${reason}):`, err);
  }
  return id;
};

/**
 * A session left open by an app that was killed rather than closed.
 *
 * Run once at startup, after the token has been restored — the record survives the
 * process, so anything still in it belongs to a job nobody is on any more.
 *
 * ⚠️ It must run AFTER auth is restored. Before that there is no bearer token, and
 * `InstallerService.endWork` skips a tokenless call rather than sending a 401.
 */
export const endStaleInstallerWorkSession = async (): Promise<void> => {
  if (!getActiveInstallerWorkJobId()) return;
  await endInstallerWorkSession('stale_launch');
};
