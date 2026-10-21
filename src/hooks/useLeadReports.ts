import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Storage } from '../utils/storage';
import { renderTargetLeadId } from '../utils/revrender-attribution';
import { isNetworkError } from '../utils/network-error';
import { onReconnect } from '../services/connectivity';
import {
  dismissRevRender,
  getRevRenderJobs,
  onRevRenderFinished,
  resumeRevRenderJobs,
  retryRevRender,
  startRevRenders,
  subscribeRevRenderJobs,
} from '../services/revRenderJobs';
import { LeadService } from '../services/api/leads';
import { FlashMessage } from '../config/message';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import { downloadPdfToDevice } from '../utils/download-utils';
import { reportDisplayName } from '../utils/report-name';
import { ENV } from '../config/env';
import { useAuth } from './useAuth';
import { logEvent } from '../services/api/LoggerService';
import {
  isWaitingForSignal,
  shouldAnnouncePollFailure,
} from '../utils/report-job-connectivity';


export interface RiskJob {
  jobId: string;
  progress: number;
  status: string;
  step: string;
  error?: string | null;
  /** Set when a poll died on transport: the server job is very likely still running. */
  waiting?: boolean;
}


const activeRiskJobs: Record<string, RiskJob | null> = {};
const riskJobListeners: Record<string, Set<(job: RiskJob | null) => void>> = {};
const activePolls = new Set<string>();
const globalRefetchListeners: Record<string, Set<() => void>> = {};

const updateSharedRiskJob = (leadId: string, job: RiskJob | null) => {
  activeRiskJobs[leadId] = job;
  if (job) {
    Storage.setItem(`risk_job_${leadId}`, JSON.stringify(job));
  } else {
    Storage.removeItem(`risk_job_${leadId}`);
  }
  
  if (riskJobListeners[leadId]) {
    riskJobListeners[leadId].forEach((listener) => listener(job));
  }
};

const triggerGlobalRefetch = (leadId: string) => {
  if (globalRefetchListeners[leadId]) {
    globalRefetchListeners[leadId].forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.warn('[Reports] Shared refetch failed:', e);
      }
    });
  }
};

export const useLeadReports = (lead: any, refetch: () => void) => {
  const { user } = useAuth();
  const pastYearsRef = useRef<number>(3);
  const [secureUrls, setSecureUrls] = useState<Record<string, string>>({});
  const resolvedReportsRef = useRef<string>('');
  const [riskJob, setRiskJob] = useState<RiskJob | null>(null);

  const [revRenderJobs, setRevRenderJobs] = useState<any[]>([]);
  const queryClient = useQueryClient();

  const leadId = lead?._id || lead?.id;

  const updateRiskJob = useCallback((job: RiskJob | null) => {
    if (leadId) {
      updateSharedRiskJob(leadId, job);
    }
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;

    const currentShared = activeRiskJobs[leadId];
    if (currentShared !== undefined) {
      setRiskJob(currentShared);
    } else {
      const savedRisk = Storage.getItem(`risk_job_${leadId}`);
      if (savedRisk) {
        const parsed = JSON.parse(savedRisk);
        activeRiskJobs[leadId] = parsed;
        setRiskJob(parsed);
      } else {
        activeRiskJobs[leadId] = null;
        setRiskJob(null);
      }
    }

    if (!riskJobListeners[leadId]) {
      riskJobListeners[leadId] = new Set();
    }
    
    const listener = (updatedJob: RiskJob | null) => {
      setRiskJob(updatedJob);
    };
    
    riskJobListeners[leadId].add(listener);

    if (!globalRefetchListeners[leadId]) {
      globalRefetchListeners[leadId] = new Set();
    }
    const refetchListener = () => {
      refetch();
    };
    globalRefetchListeners[leadId].add(refetchListener);

    return () => {
      riskJobListeners[leadId]?.delete(listener);
      globalRefetchListeners[leadId]?.delete(refetchListener);
    };
  }, [leadId, refetch]);

  const refreshSecureUrls = async () => {
    const reports = [
      ...(lead?.generatedReports || []),
      ...(lead?.outcomeData?.generatedReports || []),
      ...(lead?.leadData?.generatedReports || []),
      ...(lead?.outcome?.generatedReports || []),
    ];
    console.log('[Reports] refreshSecureUrls triggered. Reports count:', reports?.length || 0);
    
    if (!reports || reports.length === 0) {
      if (Object.keys(secureUrls).length > 0) {
        setSecureUrls({});
      }
      return;
    }

    try {
      console.log('[Reports] Calling multiple secure URL API...');
      const filePaths = reports.map((r: any) => ({
        bucketName: r.bucketName || ENV.S3_BUCKET,
        filePath: r.reportPath,
      }));

      const res = await LeadService.getSecureUrls(filePaths);
      if (res.data?.data) {
        const urlMap: Record<string, string> = {};
        res.data.data.forEach((item: any) => {
          urlMap[item.filePath] = item.secureUrl || item.url;
        });
        console.log('[Reports] Successfully resolved', Object.keys(urlMap).length, 'URLs');
        setSecureUrls(urlMap);
      }
    } catch (err) {
      // ⚠️ `console.error` raises the red LogBox screen over the app - and losing signal (mid-revRender, in a tunnel) is not a
      // crash. A transport failure keeps the links already resolved and quietly retries on reconnect (effect below); only a
      // real server answer is worth a warning.
      if (isNetworkError(err)) {
        refreshOnReconnectRef.current = true;
      } else {
        console.warn('[Reports] S3 Resolve failed:', (err as any)?.message || err);
      }
    }
  };

  useEffect(() => {
    if (leadId) {
      refreshSecureUrls();
    }
  }, [lead]);

  // A refresh that died on transport runs again when the signal returns.
  const refreshOnReconnectRef = useRef(false);
  const refreshSecureUrlsRef = useRef(refreshSecureUrls);
  refreshSecureUrlsRef.current = refreshSecureUrls;
  useEffect(
    () =>
      onReconnect(() => {
        if (!refreshOnReconnectRef.current) return;
        refreshOnReconnectRef.current = false;
        void refreshSecureUrlsRef.current();
      }),
    []
  );

  const pollRiskStatus = useCallback(
    async (jobId: string) => {
      try {
        console.log('[Risk] Polling status for jobId:', jobId);
        const res = await LeadService.getJobStatus(jobId);
        const data = res.data?.data;
        if (data) {
          console.log(`[Risk] Progress: ${data.progress}%, Status: ${data.status}`);
          const updatedJob = {
            jobId: data.jobId,
            progress: data.progress,
            status: data.status,
            step: data.step,
            error: data.error || null,
            // Reached the server: whatever `waiting` said before, it is stale now.
            waiting: false,
          };
          updateRiskJob(updatedJob);

          if (data.status === 'completed' || data.progress === 100) {
            console.log('[Risk] Job completed, final sync...');
            updateRiskJob(null);

            const address = lead?.fullAddress || lead?.address || '';
            const street = address?.split(',')[0] || '';
            if (user?._id || user?.id) {
              logEvent('create', {
                user_id: user?._id || user?.id,
                module_type: 'risk_report',
                created_by: user?._id || user?.id,
                meta: {
                  leadId: leadId,
                  reportId: street,
                  formattedAddress: address,
                  pastRangeType: pastYearsRef.current,
                  filename: `${street}-Risk-Report.pdf`,
                },
              });
            }
            
            queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
            queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
            queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
            
            let attempts = 0;
            const maxAttempts = 4;
            const refetchWithRetry = async () => {
              console.log(`[Risk] Refetching lead reports (attempt ${attempts + 1})...`);
              triggerGlobalRefetch(leadId);
              attempts++;
              if (attempts < maxAttempts) {
                setTimeout(refetchWithRetry, 1500);
              }
            };
            setTimeout(refetchWithRetry, 1000);
            return true;
          }

          if (data.status === 'failed') {
            console.warn('[Risk] Job failed:', data.error);
            updateRiskJob(null);

            const address = lead?.fullAddress || lead?.address || '';
            const street = address?.split(',')[0] || '';
            if (user?._id || user?.id) {
              logEvent('create', {
                user_id: user?._id || user?.id,
                module_type: 'risk_report',
                created_by: user?._id || user?.id,
                meta: {
                  reportId: street,
                  formattedAddress: address,
                  pastRangeType: pastYearsRef.current,
                  error: data.error || 'Job failed',
                },
              });
            }

            FlashMessage.error('Report generation timed out or failed. Please try again.', 'Risk Report Failed');
            return true;
          }
        }
      } catch (err) {
        // ⚠️ Losing signal is NOT the report failing — it is generated on the SERVER and is very
        // probably still going. Flag the card as waiting (which replaces the frozen server `step`
        // with an honest line and stops the bar reading as live work) and keep polling: the first
        // tick after reconnect clears it. Returning `false` deliberately keeps the interval alive.
        if (isWaitingForSignal(err)) {
          updateRiskJob({
            ...(activeRiskJobs[leadId] || { jobId, progress: 0, status: 'running', step: '' }),
            waiting: true,
          });
        } else {
          console.error('[Risk] Status check failed:', err);
        }
      }
      return false;
    },
    [leadId, refetch, updateRiskJob]
  );

  useEffect(() => {
    let interval: any;
    const jobId = riskJob?.jobId;

    if (
      jobId &&
      (riskJob.status === 'running' || riskJob.status === 'pending') &&
      jobId !== 'temp' &&
      leadId
    ) {
      const pollKey = `${leadId}_${jobId}`;
      if (!activePolls.has(pollKey)) {
        activePolls.add(pollKey);
        interval = setInterval(async () => {
          const finished = await pollRiskStatus(jobId);
          if (finished) {
            activePolls.delete(pollKey);
            clearInterval(interval);
          }
        }, 3000);
      }
    }

    return () => {
      if (interval) {
        clearInterval(interval);
        if (leadId && jobId) {
          activePolls.delete(`${leadId}_${jobId}`);
        }
      }
    };
  }, [riskJob?.jobId, riskJob?.status, pollRiskStatus, leadId]);

  // The revRender queue lives in `services/revRenderJobs.ts` (module level, persisted), so it outlives this screen: mounting only
  // SUBSCRIBES, and resumes the poll of any render that already has a batchId (restart / leaving and coming back).
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (!leadId) return;
    const sync = () => setRevRenderJobs(getRevRenderJobs(leadId));
    sync();
    const offJobs = subscribeRevRenderJobs(leadId, sync);
    // ⚠️ `refetch` belongs to THIS hook's lead; the manager only signals the lead the renders were filed under.
    const offDone = onRevRenderFinished(leadId, () => refetchRef.current());
    resumeRevRenderJobs(leadId);
    return () => {
      offJobs();
      offDone();
    };
  }, [leadId]);

  const handleStartRiskReport = async (pastYears: number) => {
    pastYearsRef.current = pastYears;
    try {
      updateRiskJob({ jobId: 'temp', progress: 0, status: 'pending', step: 'Starting...' });
      FlashMessage.info('Starting Risk Report generation...', 'Processing');

      const res = await LeadService.generateWeatherReport(leadId, pastYears);
      const jobId = res.data?.data?.jobId;
      if (jobId) {
        console.log('[Risk] Received jobId:', jobId);
        const newJob = { jobId, progress: 0, status: 'pending', step: 'Initializing...' };
        updateRiskJob(newJob);
        pollRiskStatus(jobId);
      } else {
        updateRiskJob(null);
      }
    } catch (err: any) {
      console.error('[Risk] Failed to start generation:', err);
      updateRiskJob(null);
      FlashMessage.error('Error', 'Failed to start report generation');

      const address = lead?.fullAddress || lead?.address || '';
      const street = address?.split(',')[0] || '';
      if (user?._id || user?.id) {
        logEvent('create', {
          user_id: user?._id || user?.id,
          module_type: 'risk_report',
          created_by: user?._id || user?.id,
          meta: {
            reportId: street,
            formattedAddress: address,
            pastRangeType: pastYears,
            error: err?.message || 'Failed to start report generation',
          },
        });
      }
    }
  };

  const handleDownloadRiskReport = async (url: string, report?: any) => {
    try {
      await downloadPdfToDevice(
        url,
        report ? reportDisplayName(report, 'Risk Report') : `RiskReport_${lead?.leadId || 'lead'}`
      );
    } catch (err) {
    }
  };

  const handleDownloadReport = async (url: string, type: string) => {
    try {
      await downloadPdfToDevice(url, `${type}_${lead?.leadId || 'lead'}`);
    } catch (err) {
    }
  };

  const handleResetRiskReport = async (reportId: string) => {
    try {
      FlashMessage.info('Resetting report...', 'Processing');
      await LeadService.resetWeatherReport(reportId);
      updateRiskJob(null);
      
      queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
      
      triggerGlobalRefetch(leadId);
      FlashMessage.success('Success', 'Report reset successfully');
    } catch (err) {
      FlashMessage.error('Error', 'Failed to reset report');
    }
  };

  /**
   * `targetLeadId` is the lead the RENDERS belong to, which is not always this hook's lead.
   *
   * ⚠️ REPORTED BY A CLIENT: "revRender generated in another lead." `onGenerate` / `onGenerateAll` travel to the RevRender screen as
   * NAVIGATION PARAMS, i.e. closures over the lead of whichever Lead Center pushed it. RevRender already sends the right id
   * (`{ payloads, leadId, jobId }`): resolve it ONCE here (`renderTargetLeadId`) and file everything under it.
   *
   * Resolves when every submit has been answered or has failed (NOT when the renders finish) - see `services/revRenderJobs.ts`.
   */
  const handleStartRevRenders = (payloads: any[], targetLeadId?: string) =>
    startRevRenders(renderTargetLeadId(targetLeadId, leadId), payloads);

  const handleRetryRevRender = (jobId: string | number) => retryRevRender(leadId, jobId);
  const handleDismissRevRender = (jobId: string | number) => dismissRevRender(leadId, jobId);

  return {
    secureUrls,
    refreshSecureUrls,
    riskJob,
    handleStartRiskReport,
    handleDownloadRiskReport,
    handleDownloadReport,
    handleResetRiskReport,
    revRenderJobs,
    handleStartRevRenders,
    handleRetryRevRender,
    handleDismissRevRender,
  };
};
