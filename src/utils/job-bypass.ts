import type { InstallerBypass } from '../config/types/installer';

const bypassOf = (record: any): InstallerBypass | undefined =>
  record?.installerBypass ?? record?.bypass ?? undefined;

export const isGpsBypassActive = (record: any): boolean => bypassOf(record)?.gpsBypass === true;

export const isEarlyStartBypassActive = (record: any): boolean =>
  bypassOf(record)?.earlyStart === true;

export const isJobBypassActive = (record: any): boolean =>
  isGpsBypassActive(record) || isEarlyStartBypassActive(record);

export const gpsBypassReason = (record: any): string | null =>
  isGpsBypassActive(record) ? bypassOf(record)?.gpsBypassReason || null : null;

export const earlyStartBypassReason = (record: any): string | null =>
  isEarlyStartBypassActive(record) ? bypassOf(record)?.earlyStartReason || null : null;
