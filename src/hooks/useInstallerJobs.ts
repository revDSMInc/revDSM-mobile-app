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
 * Moves a job through the workflow — `PUT installer/v1/update-job-status/{id}`.
 *
 * Resolves with the full job, so callers can navigate straight into the detail
 * screen with the payload the API just returned rather than refetching.
 */
export function useUpdateJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: JobStatus }) =>
      InstallerService.updateJobStatus(jobId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: installerKeys.all });
    },
  });
}

export function useSubmitInstallerResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (submission: InstallerResultSubmission) =>
      InstallerService.submitResult(submission),
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
