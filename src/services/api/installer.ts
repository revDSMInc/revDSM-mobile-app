import api from './index';
import { AxiosResponse } from 'axios';
import type {
  InstallerJob,
  InstallProgress,
  InstallerResultSubmission,
  DiscrepancyReport,
} from '../../config/types/installer';
import { MOCK_INSTALLER_JOBS, MOCK_INSTALLER_JOBS_TOMORROW } from './installer.mock';

/**
 * Installer endpoints.
 *
 * These paths are provisional — the backend is not built yet. Each is named after
 * the operation the UI needs so the shape is settled ahead of integration; confirm
 * the final paths against the API before flipping INSTALLER_USE_MOCKS off.
 */
export const InstallerEndpoints = {
  jobs: 'installer/v1/jobs',
  job: (jobId: string) => `installer/v1/jobs/${jobId}`,
  progress: (jobId: string) => `installer/v1/jobs/${jobId}/progress`,
  result: (jobId: string) => `installer/v1/jobs/${jobId}/result`,
  discrepancy: (jobId: string) => `installer/v1/jobs/${jobId}/discrepancy`,
};

/**
 * Master switch for the placeholder data layer.
 *
 * While true, every method below resolves from `installer.mock.ts` instead of
 * hitting the network. Flip to false once the endpoints above are live — the
 * hooks and screens need no changes.
 */
export const INSTALLER_USE_MOCKS = true;

/** Simulates network latency so loading states are exercised during design review. */
const mockDelay = <T,>(data: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));

export type JobPeriod = 'today' | 'tomorrow';

export const InstallerService = {
  /** Jobs assigned to the signed-in installer for a given day. */
  getJobs: async (period: JobPeriod = 'today'): Promise<InstallerJob[]> => {
    if (INSTALLER_USE_MOCKS) {
      return mockDelay(
        period === 'today' ? MOCK_INSTALLER_JOBS : MOCK_INSTALLER_JOBS_TOMORROW
      );
    }
    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.jobs, {
      params: { period },
    });
    const payload = res.data?.data ?? res.data;
    return Array.isArray(payload) ? payload : payload?.jobs ?? [];
  },

  getJob: async (jobId: string): Promise<InstallerJob | null> => {
    if (INSTALLER_USE_MOCKS) {
      const all = [...MOCK_INSTALLER_JOBS, ...MOCK_INSTALLER_JOBS_TOMORROW];
      return mockDelay(all.find((j) => j._id === jobId) ?? null);
    }
    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.job(jobId));
    return res.data?.data ?? res.data ?? null;
  },

  /** Persists timeline progress. Local-only until the endpoint exists. */
  saveProgress: async (
    jobId: string,
    progress: Partial<InstallProgress>
  ): Promise<void> => {
    if (INSTALLER_USE_MOCKS) {
      await mockDelay(null, 120);
      return;
    }
    await api.put(InstallerEndpoints.progress(jobId), progress);
  },

  submitResult: async (submission: InstallerResultSubmission): Promise<void> => {
    if (INSTALLER_USE_MOCKS) {
      await mockDelay(null, 250);
      return;
    }
    await api.post(InstallerEndpoints.result(submission.jobId), {
      result: submission.result,
      reason: submission.reason,
    });
  },

  /** Routes a scope discrepancy to the Install Manager + originating rep. */
  reportDiscrepancy: async (
    jobId: string,
    report: DiscrepancyReport
  ): Promise<void> => {
    if (INSTALLER_USE_MOCKS) {
      await mockDelay(null, 250);
      return;
    }
    await api.post(InstallerEndpoints.discrepancy(jobId), report);
  },
};
