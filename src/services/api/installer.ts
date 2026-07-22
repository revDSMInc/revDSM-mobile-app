import api from './index';
import { AxiosResponse } from 'axios';
import type {
  ContractDetails,
  InstallerJob,
  InstallerJobsResult,
  InstallProgress,
  InstallerResultSubmission,
  DiscrepancyReport,
  JobStatus,
} from '../../config/types/installer';
import { MOCK_INSTALLER_JOBS, MOCK_INSTALLER_JOBS_TOMORROW } from './installer.mock';

/**
 * Installer endpoints.
 *
 * `myJobs` is live. The rest are provisional — those parts of the backend are not
 * built yet. Each is named after the operation the UI needs so the shape is settled
 * ahead of integration; confirm the final paths before flipping INSTALLER_USE_MOCKS off.
 */
export const InstallerEndpoints = {
  myJobs: 'installer/v1/my-jobs',
  updateJobStatus: (jobId: string) => `installer/v1/update-job-status/${jobId}`,
  job: (jobId: string) => `installer/v1/jobs/${jobId}`,
  progress: (jobId: string) => `installer/v1/jobs/${jobId}/progress`,
  result: (jobId: string) => `installer/v1/jobs/${jobId}/result`,
  discrepancy: (jobId: string) => `installer/v1/jobs/${jobId}/discrepancy`,
};

/**
 * Placeholder-data switch for the endpoints that are still unbuilt (job detail,
 * progress, result, discrepancy). The job list is NOT gated by this — `getJobs`
 * always calls the live `my-jobs` endpoint.
 */
export const INSTALLER_USE_MOCKS = true;

/** Simulates network latency so loading states are exercised during design review. */
const mockDelay = <T,>(data: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));

export type JobPeriod = 'today' | 'tomorrow';

/** Statuses the API uses for a job that is over — no more field work expected. */
const RESULTED_STATUSES = ['completed', 'resulted', 'cancelled', 'canceled', 'closed'];

/** Money arrives as a string ("400") and as "" when unset. */
const toAmount = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** `contractDetails` (API) → `ContractDetails` (app). Undefined when nothing is set. */
const normalizeContract = (raw: any): ContractDetails | undefined => {
  if (!raw) return undefined;
  const method = (v: unknown) => (v ? String(v).toUpperCase() : undefined);

  const contract: ContractDetails = {
    contractPrice: toAmount(raw.originalContractPrice ?? raw.contractPrice),
    downPayment: toAmount(raw.downPayment),
    downPaymentMethod: method(raw.downPaymentMethod),
    remainingBalance: toAmount(raw.balance ?? raw.remainingBalance),
    balanceMethod: method(raw.balancePaymentMethod ?? raw.balanceMethod),
    loanAuth: raw.loanAuth || undefined,
  };

  return Object.values(contract).some((v) => v !== undefined) ? contract : undefined;
};

/**
 * Maps a `my-jobs` row onto the app's `InstallerJob` shape.
 *
 * The API row is flat (`arrivalWindow` / `date` / `address` / `customerName`) while
 * the rest of the installer module speaks the lead model (`leadTime` / `leadDate` /
 * `fullAddress` / `customerDetails`), so the translation lives here rather than in
 * every consumer. Raw fields are carried through as well for screens that want them.
 */
export const normalizeInstallerJob = (raw: any): InstallerJob => {
  const status: string = raw?.status ?? '';
  const displayId: string | undefined =
    raw?.leadDisplayId && raw.leadDisplayId !== 'N/A' ? raw.leadDisplayId : undefined;
  const name: string = (raw?.customerName ?? '').trim();
  const [firstName, ...rest] = name ? name.split(/\s+/) : [];

  return {
    _id: raw?._id ?? raw?.id ?? '',
    leadId: raw?.leadId,
    leadDisplayId: displayId,
    jobNumber: raw?.jobNumber,
    leadTime: raw?.arrivalWindow || raw?.time || undefined,
    leadDate: raw?.date,
    fullAddress: raw?.address,
    customerId: raw?.customerId,
    customerName: name || undefined,
    customerDetails: {
      firstName,
      lastName: rest.join(' ') || undefined,
      phone: raw?.customerPhone,
      email: raw?.customerEmail,
    },
    location: raw?.location,
    status,
    workflowState: raw?.workflowState,
    companyName: raw?.companyName,
    resulted: RESULTED_STATUSES.includes(status.toLowerCase()),
    // Only present on the start-job response, not on the list.
    contract: normalizeContract(raw?.contractDetails),
    preInstallPhotos: raw?.preInstallPhotos,
  };
};

/**
 * Layers a freshly-fetched job over the one already in hand, ignoring keys the new
 * payload didn't supply. The list and start-job responses carry different subsets of
 * a job, so a blind spread would blank out fields the caller still needs.
 */
export const mergeInstallerJob = (base: InstallerJob, patch: InstallerJob): InstallerJob => {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Partial<InstallerJob>;
  return { ...base, ...defined };
};

export const InstallerService = {
  /** Jobs assigned to the signed-in installer for a given day. */
  getJobs: async (period: JobPeriod = 'today'): Promise<InstallerJobsResult> => {
    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.myJobs, {
      params: { period },
    });
    const payload = res.data?.data ?? res.data ?? {};
    const rows: any[] = Array.isArray(payload) ? payload : payload?.jobs ?? [];

    return {
      jobs: rows.map(normalizeInstallerJob),
      pagination: payload?.pagination,
      summaryCounts: payload?.summaryCounts,
    };
  },

  /**
   * Moves a job through the workflow and returns the full job back.
   *
   * Starting a job (`inProgress`) is how the installer gets the working payload —
   * the response is the only place `contractDetails` and the rep's `preInstallPhotos`
   * come from, so the caller should hold the screen until it resolves.
   */
  updateJobStatus: async (jobId: string, status: JobStatus): Promise<InstallerJob> => {
    const res: AxiosResponse<any> = await api.put(
      InstallerEndpoints.updateJobStatus(jobId),
      { status }
    );
    return normalizeInstallerJob(res.data?.data ?? res.data);
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
