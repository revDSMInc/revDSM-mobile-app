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

export const staleInstallerJobs = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: installerKeys.all, refetchType: 'none' });

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

export function useUpdateJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: JobStatus }) =>
      InstallerService.setJobStatus(jobId, status),
    onSuccess: () => {
      staleInstallerJobs(queryClient);
    },
  });
}

export function useSubmitInstallerResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, status, reason }: InstallerResultSubmission) =>
      InstallerService.setJobStatus(jobId, status, reason),
    onSuccess: () => {
      staleInstallerJobs(queryClient);
    },
  });
}

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
