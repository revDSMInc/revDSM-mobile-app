import { isStepPending, type OfflineLeadWork } from '../../../utils/offline-lead-work';

export const extractCalculatorOutcome = (body: any): any =>
  body?.data?.outcome ?? body?.outcome ?? body?.data ?? body;

export const extractSavedJobBuildState = (outcome: any): any =>
  outcome?.jobBuilder?.dynamicJobState ?? outcome?.dynamicJobState ?? outcome?.jobBuilder ?? null;

export const hasSavedJobBuild = (outcome: any): boolean => {
  const saved = extractSavedJobBuildState(outcome);
  return !!saved && typeof saved === 'object';
};

export const offlineSavedJobBuildState = (work: OfflineLeadWork | null | undefined): any => {
  const outcome = (work as any)?.outcome;
  if (!outcome || typeof outcome !== 'object') return null;
  const saved = extractSavedJobBuildState(outcome);
  return saved && typeof saved === 'object' ? saved : null;
};

export type JobBuildSource =
  | 'device'
  | 'server';

export const resolveJobBuildSource = (input: {
  work?: OfflineLeadWork | null;
  offline?: boolean;
}): JobBuildSource => {
  const work = input.work;
  if (!work || !offlineSavedJobBuildState(work)) return 'server';
  if (isStepPending(work, 'outcome')) return 'device';
  return input.offline ? 'device' : 'server';
};
