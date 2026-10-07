import { useMemo, useRef } from 'react';
import { useAuth } from './useAuth';
import * as InstallerLog from '../utils/activity-log/installer-log';

const LOGGERS = {
  dashboardViewed: InstallerLog.logInstallerDashboardViewed,
  periodChanged: InstallerLog.logInstallerPeriodChanged,
  jobsRefreshed: InstallerLog.logInstallerJobsRefreshed,

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

  stepOpened: InstallerLog.logInstallStepOpened,
  stepClosed: InstallerLog.logInstallStepClosed,
  stepCompleted: InstallerLog.logInstallStepCompleted,

  photoAdded: InstallerLog.logInstallerPhotoUploaded,
  photoRemoved: InstallerLog.logInstallerPhotoRemoved,

  materialSkipped: InstallerLog.logMaterialSkipped,

  pecAnswered: InstallerLog.logPecAnswered,
  pecAreaToggled: InstallerLog.logPecAreaToggled,
  pecNoteEntered: InstallerLog.logPecNoteEntered,
  pecConfirmed: InstallerLog.logPecConfirmed,

  photoSectionChanged: InstallerLog.logPhotoSectionChanged,
  photoPhaseCompleted: InstallerLog.logPhotoPhaseCompleted,

  scopeConfirmed: InstallerLog.logScopeConfirmed,
  scopeUndone: InstallerLog.logScopeUndone,
  scopeResolved: InstallerLog.logScopeResolved,
  scopeCompleted: InstallerLog.logScopeCompleted,
  discrepancyOpened: InstallerLog.logDiscrepancyOpened,
  discrepancyReported: InstallerLog.logDiscrepancyReported,

  cocCompleted: InstallerLog.logCocCompleted,
  cocSigned: InstallerLog.logCocSigned,
  cocFormOpened: InstallerLog.logCocFormOpened,
  cocFormDismissed: InstallerLog.logCocFormDismissed,
  cocPaperFallback: InstallerLog.logCocPaperFallback,
  cocScanned: InstallerLog.logCocScanned,
  cocConfirmationToggled: InstallerLog.logCocConfirmationToggled,
  cocRelationshipSelected: InstallerLog.logCocRelationshipSelected,
  cocSignaturePadOpened: InstallerLog.logCocSignaturePadOpened,
  cocSignatureSaved: InstallerLog.logCocSignatureSaved,
  cocSignatureCleared: InstallerLog.logCocSignatureCleared,
  cocSignaturePadCancelled: InstallerLog.logCocSignaturePadCancelled,

  resultOpened: InstallerLog.logInstallerResultOpened,
  resultSubmitted: InstallerLog.logInstallerResultSubmitted,
  resultFailed: InstallerLog.logInstallerResultFailed,
} as const;

type Loggers = typeof LOGGERS;

export type InstallerActivityLog = {
  [K in keyof Loggers]: Loggers[K] extends (user: any, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

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
