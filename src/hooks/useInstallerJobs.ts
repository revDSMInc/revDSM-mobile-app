import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { InstallerService, type JobPeriod } from '../services/api/installer';
import type {
  InstallerJob,
  InstallerResultSubmission,
  StatusRequestPayload,
  DiscrepancyReport,
  JobStatus,
} from '../config/types/installer';

export const installerKeys = {
  all: ['installer'] as const,
  jobs: (period: JobPeriod) => ['installer', 'jobs', period] as const,
  job: (jobId: string) => ['installer', 'job', jobId] as const,
};

/**
 * Marks the installer's cached schedule stale WITHOUT refetching it.
 *
 * `my-jobs` belongs to the dashboard and must only be requested from there. A plain
 * invalidate would not respect that: the dashboard stays mounted underneath the detail
 * screen, so its query is still active and the invalidate fires the request immediately
 * — from inside the job, where nothing renders the list. `refetchType: 'none'` drops the
 * cache instead, and the dashboard's own `useFocusEffect` re-fetches when the installer
 * actually comes back to it.
 */
export const staleInstallerJobs = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: installerKeys.all, refetchType: 'none' });

/** Installer's schedule — `GET installer/v1/my-jobs?period=all|tomorrow`. */
export function useInstallerJobs(period: JobPeriod = 'all') {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: installerKeys.jobs(period),
    queryFn: () => InstallerService.getJobs(period),
    staleTime: 1000 * 60 * 5,
  });

  return {
    jobs: (data?.jobs ?? []) as InstallerJob[],
    summaryCounts: data?.summaryCounts,
    pagination: data?.pagination,
    loading: isLoading,
    isError,
    refreshing: isRefetching,
    refresh: refetch,
  };
}

export function useInstallerJob(jobId?: string) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: installerKeys.job(jobId ?? ''),
    queryFn: () => InstallerService.getJob(jobId!),
    enabled: !!jobId,
    staleTime: 1000 * 60 * 5,
  });

  return { job: data ?? null, loading: isLoading, refresh: refetch };
}

/**
 * Moves a job through the workflow — `PUT installer/v1/update/{id}` with `{ status }`.
 *
 * PUT, not PATCH: same path, but the verb is what separates a transition from a step
 * data write. May resolve with the job, but is not guaranteed to — the response payload
 * is not part of the contract. The working payload (contract, sold products, rep
 * photos) comes from check-in instead.
 */
export function useUpdateJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: JobStatus }) =>
      InstallerService.setJobStatus(jobId, status),
    onSuccess: () => {
      // Stale, not refetched — the caller navigates into the job right after this, so a
      // refetch here would put `my-jobs` on the detail screen. See `staleInstallerJobs`.
      staleInstallerJobs(queryClient);
    },
  });
}

/**
 * Results a job — Can't Do Work / Not Hit.
 *
 * `PUT installer/v1/update/{jobId}` with `{ status, statusReason }`, rather than the
 * provisional `jobs/{id}/result` endpoint: these two results ARE status transitions,
 * and this is the endpoint the backend actually serves. Reset is not one of them — it
 * has its own endpoint (`InstallerService.resetJob`).
 *
 * `reason` is a `StatusReasonPayload` (`{ reason: string, images?: StatusReasonImage[] }`).
 */
export function useSubmitInstallerResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status, reason }: InstallerResultSubmission) =>
      InstallerService.setJobStatus(jobId, status, reason),
    onSuccess: () => {
      // Only ever submitted from the detail screen, so the schedule is dropped rather
      // than re-requested from there. See `staleInstallerJobs`.
      staleInstallerJobs(queryClient);
    },
  });
}

/**
 * Files a "Can't Do Work" status request — `POST installer/v1/{jobId}/status-requests`.
 *
 * Separate from `useSubmitInstallerResult` because it is a different KIND of action:
 * that one transitions the job, this one asks ops to. Nothing is optimistically
 * applied to the job's status here — the request has to be reviewed first — but the
 * schedule is still marked stale so the list reflects whatever the server decides on
 * the next read.
 */
export function useSubmitStatusRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, request }: { jobId: string; request: StatusRequestPayload }) =>
      InstallerService.createStatusRequest(jobId, request),
    onSuccess: () => {
      staleInstallerJobs(queryClient);
    },
  });
}

export function useReportDiscrepancy(jobId: string) {
  return useMutation({
    mutationFn: (report: DiscrepancyReport) =>
      InstallerService.reportDiscrepancy(jobId, report),
  });
}
