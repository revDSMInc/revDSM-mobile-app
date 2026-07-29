import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InstallerService, type JobPeriod } from '../services/api/installer';
import type {
  InstallerJob,
  InstallerResultSubmission,
  DiscrepancyReport,
  JobStatus,
} from '../config/types/installer';

export const installerKeys = {
  all: ['installer'] as const,
  jobs: (period: JobPeriod) => ['installer', 'jobs', period] as const,
  job: (jobId: string) => ['installer', 'job', jobId] as const,
};

/** Installer's schedule for a given day — `GET installer/v1/my-jobs?period=…`. */
export function useInstallerJobs(period: JobPeriod = 'today') {
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
      queryClient.invalidateQueries({ queryKey: installerKeys.all });
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
 */
export function useSubmitInstallerResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status, reason }: InstallerResultSubmission) =>
      InstallerService.setJobStatus(jobId, status, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: installerKeys.all });
    },
  });
}

export function useReportDiscrepancy(jobId: string) {
  return useMutation({
    mutationFn: (report: DiscrepancyReport) =>
      InstallerService.reportDiscrepancy(jobId, report),
  });
}
