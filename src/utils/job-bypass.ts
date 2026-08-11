/**
 * Manager-applied bypasses — the overrides that let a crew into a job the app's own gates
 * would refuse.
 *
 * A manager who knows a gate is wrong for a particular job files an override on it, and
 * the app must then let the crew in. Two flags can be set:
 *
 *   - `gpsBypass`  — filed when the location can't be judged. Reasons seen in the field:
 *     a multi-unit property the radius can't resolve to a unit, or an address whose stored
 *     coordinates are simply wrong while the installer is standing at the right house.
 *   - `earlyStart` — filed when the schedule shouldn't hold, e.g. weather moving an
 *     install up.
 *
 * **Either one open the job completely** — see `isJobBypassActive`, which is what every
 * installer gate reads. The two flags record WHY the override was filed, for the log and
 * for whoever reviews it; they do not each unlock a separate half of the check.
 *
 * **One payload, two spellings.** Installer rows (`installer/v1/my-jobs`) carry the object
 * as `installerBypass`; the sales lead payloads carry the same fields as `bypass`. Both are
 * read here so no gate has to know which endpoint its record came from, and so the rule
 * itself is defined once — `location-util.ts`'s lead-shaped helpers delegate to these.
 *
 * ⚠️ **Test the FLAGS, never the object.** An override that has been reviewed and switched
 * off arrives as the same object with both flags false, and it must gate exactly like a job
 * that never had one. Presence is not permission.
 */

import type { InstallerBypass } from '../config/types/installer';

/** The override object, whichever name this payload gives it. */
const bypassOf = (record: any): InstallerBypass | undefined =>
  record?.installerBypass ?? record?.bypass ?? undefined;

/**
 * A GPS override is on file.
 *
 * `=== true` rather than truthiness: the field arrives from JSON and an absent override is
 * `undefined`, but a string `"false"` — which some encodings of this object have produced
 * — must not unlock a job either.
 *
 * Use `isJobBypassActive` to decide whether a job opens. This one names WHICH override is
 * in force, which is what the activity log records.
 */
export const isGpsBypassActive = (record: any): boolean => bypassOf(record)?.gpsBypass === true;

/** An early-start override is on file. Same note as above — for logging, not for gating. */
export const isEarlyStartBypassActive = (record: any): boolean =>
  bypassOf(record)?.earlyStart === true;

/**
 * **The gate question: may this job be opened regardless of where the crew is and what
 * time it is?**
 *
 * True when EITHER flag is set. Both are ways of saying the same thing — that the office
 * has looked at this job and decided the automatic checks are getting it wrong — so either
 * one lifts every restriction on opening it: the geofence, the arrival window and the
 * scheduled date.
 *
 * The alternative, mapping each flag to the one gate its name suggests, reads tidier and is
 * wrong in the field. The two reasons in hand make that plain: an override filed as
 * "address incorrect in system" is about the coordinates, but the crew it unblocks is a
 * crew standing at a job whose stored position is wrong — leaving the schedule gate armed
 * only means a second refusal for a different stated reason, and another call to the
 * office. Managers file ONE override to get ONE crew into ONE job.
 *
 * ⚠️ This is the whole client-side check-in rule for a bypassed job. The backend still
 * applies its own on the check-in request, and it stays the authority: a 403 there is
 * honoured (`screens/Installer/index.tsx`) whatever this returns.
 */
export const isJobBypassActive = (record: any): boolean =>
  isGpsBypassActive(record) || isEarlyStartBypassActive(record);

/**
 * The manager's stated reason, for the activity log.
 *
 * Null unless the matching flag is actually on: a reason left behind by an override that
 * has since been switched off would be recorded as the justification for a check-in it
 * did not authorise.
 */
export const gpsBypassReason = (record: any): string | null =>
  isGpsBypassActive(record) ? bypassOf(record)?.gpsBypassReason || null : null;

export const earlyStartBypassReason = (record: any): string | null =>
  isEarlyStartBypassActive(record) ? bypassOf(record)?.earlyStartReason || null : null;
