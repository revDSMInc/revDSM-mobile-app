import { useMemo, useRef } from 'react';
import { useAuth } from './useAuth';
import * as InstallerLog from '../utils/activity-log/installer-log';

/**
 * Every installer log helper, keyed by the event it records.
 *
 * The underlying functions in `utils/activity-log/installer-log.ts` all take the
 * signed-in `user` first; this map exists so the hook can strip that argument once
 * instead of every screen repeating `user`.
 */
const LOGGERS = {
  // Dashboard
  dashboardViewed: InstallerLog.logInstallerDashboardViewed,
  periodChanged: InstallerLog.logInstallerPeriodChanged,
  jobsRefreshed: InstallerLog.logInstallerJobsRefreshed,

  // Job session — check in / pause / resume
  jobStarted: InstallerLog.logInstallerJobStarted,
  jobStartFailed: InstallerLog.logInstallerJobStartFailed,
  jobOpened: InstallerLog.logInstallerJobOpened,
  jobPaused: InstallerLog.logInstallerJobPaused,
  jobCompleted: InstallerLog.logInstallerJobCompleted,
  jobReset: InstallerLog.logInstallerJobReset,
  customerContact: InstallerLog.logInstallerCustomerContact,
  addressOpened: InstallerLog.logInstallerAddressOpened,
  packetViewed: InstallerLog.logInstallerPacketViewed,
  opsChatOpened: InstallerLog.logInstallerOpsChatOpened,

  // Timeline steps
  stepOpened: InstallerLog.logInstallStepOpened,
  stepClosed: InstallerLog.logInstallStepClosed,
  stepCompleted: InstallerLog.logInstallStepCompleted,

  // Photos. Uploads that go to S3 are logged by `useInstallerPhotoUpload` once the
  // s3url is known; `photoAdded` is for captures that are never uploaded (CoC pages
  // have no backend field), and removals always originate from a screen.
  photoAdded: InstallerLog.logInstallerPhotoUploaded,
  photoRemoved: InstallerLog.logInstallerPhotoRemoved,

  // Material
  materialSkipped: InstallerLog.logMaterialSkipped,

  // Pre-existing conditions
  pecAnswered: InstallerLog.logPecAnswered,
  pecAreaToggled: InstallerLog.logPecAreaToggled,
  pecNoteEntered: InstallerLog.logPecNoteEntered,
  pecConfirmed: InstallerLog.logPecConfirmed,

  // Photo matching
  photoSectionChanged: InstallerLog.logPhotoSectionChanged,
  photoPhaseCompleted: InstallerLog.logPhotoPhaseCompleted,

  // Scope & discrepancies
  scopeConfirmed: InstallerLog.logScopeConfirmed,
  scopeUndone: InstallerLog.logScopeUndone,
  scopeResolved: InstallerLog.logScopeResolved,
  scopeCompleted: InstallerLog.logScopeCompleted,
  discrepancyOpened: InstallerLog.logDiscrepancyOpened,
  discrepancyReported: InstallerLog.logDiscrepancyReported,

  // Certificate of Completion
  cocCompleted: InstallerLog.logCocCompleted,

  // Result
  resultOpened: InstallerLog.logInstallerResultOpened,
  resultSubmitted: InstallerLog.logInstallerResultSubmitted,
  resultFailed: InstallerLog.logInstallerResultFailed,
} as const;

type Loggers = typeof LOGGERS;

/** The same map with the leading `user` argument removed. */
export type InstallerActivityLog = {
  [K in keyof Loggers]: Loggers[K] extends (user: any, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

/**
 * Installer activity logging, bound to the signed-in user.
 *
 * ```ts
 * const log = useInstallerActivityLog();
 * log.stepOpened('pec', 'active');
 * ```
 *
 * The returned object is referentially stable for the life of the component (the
 * user is read through a ref), so it is safe in `useEffect` dependency arrays and
 * as a prop to memoized children.
 *
 * Job context — jobId / leadId / customer / address — is resolved from the job the
 * installer opened (`persistActiveInstallerJob`), so nothing needs threading here.
 */
export function useInstallerActivityLog(): InstallerActivityLog {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  return useMemo(() => {
    const bound = {} as Record<string, (...args: any[]) => any>;
    (Object.keys(LOGGERS) as (keyof Loggers)[]).forEach((key) => {
      const fn = LOGGERS[key] as (user: any, ...args: any[]) => any;
      bound[key] = (...args: any[]) => fn(userRef.current, ...args);
    });
    return bound as InstallerActivityLog;
  }, []);
}
