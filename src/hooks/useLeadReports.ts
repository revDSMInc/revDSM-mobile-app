import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Storage } from '../utils/storage';
import { LeadService } from '../services/api/leads';
import { FlashMessage } from '../config/message';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import { downloadPdfToDevice } from '../utils/download-utils';
import { ENV } from '../config/env';
import { useAuth } from './useAuth';
import { logEvent } from '../services/api/LoggerService';


export interface RiskJob {
  jobId: string;
  progress: number;
  status: string;
  step: string;
  error?: string | null;
}


// Shared global state for active risk jobs across hook instances to keep them perfectly synced in real-time
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
  const existingRunIdsRef = useRef<Set<string>>(new Set());
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

  // Synchronize state across all instances of this hook using a listener pattern
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

    // Register this instance's refetch callback
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

  // Resolve secure S3 URLs for generated reports
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
      console.error('[Reports] S3 Resolve Error:', err);
    }
  };

  useEffect(() => {
    if (leadId) {
      refreshSecureUrls();
    }
  }, [lead]);

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
          };
          updateRiskJob(updatedJob);

          if (data.status === 'completed' || data.progress === 100) {
            console.log('[Risk] Job completed, final sync...');
            updateRiskJob(null);

            // Log successful report generation
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
            
            // Invalidate React Query cache to update other screens (MapDetail, LeadCenter, etc.)
            queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
            queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
            queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
            
            // Poll/retry refetch a few times to ensure the server has finalized and linked the report
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

            // Log report generation error
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
        console.error('[Risk] Status check failed:', err);
      }
      return false;
    },
    [leadId, refetch, updateRiskJob]
  );

  // Coordinated Risk Report Polling Effect: only one polling interval runs per leadId/jobId
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

  // Initial check for existing rev render jobs
  useEffect(() => {
    const initJobs = () => {
      const savedRev = Storage.getItem(`rev_render_jobs_${leadId}`);
      if (savedRev) {
        setRevRenderJobs(JSON.parse(savedRev));
      }
    };
    if (leadId) initJobs();
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

      // Log report generation start error
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

  const handleDownloadRiskReport = async (url: string) => {
    try {
      await downloadPdfToDevice(url, `RiskReport_${lead?.leadId || 'lead'}`);
    } catch (err) {
      // Error handled in utility
    }
  };

  const handleDownloadReport = async (url: string, type: string) => {
    try {
      await downloadPdfToDevice(url, `${type}_${lead?.leadId || 'lead'}`);
    } catch (err) {
      // Error handled in utility
    }
  };

  const handleResetRiskReport = async (reportId: string) => {
    try {
      FlashMessage.info('Resetting report...', 'Processing');
      await LeadService.resetWeatherReport(reportId);
      updateRiskJob(null);
      
      // Invalidate React Query cache
      queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
      
      triggerGlobalRefetch(leadId);
      FlashMessage.success('Success', 'Report reset successfully');
    } catch (err) {
      FlashMessage.error('Error', 'Failed to reset report');
    }
  };

  const handleStartRevRenders = async (payloads: any[]) => {
    const total = payloads.length;
    const initialJobs = payloads.map((p, i) => ({ id: i, status: 'pending', payload: p, progress: 0 }));
    setRevRenderJobs(initialJobs);
    Storage.setItem(`rev_render_jobs_${lead?._id || lead?.id}`, JSON.stringify(initialJobs));

    try {
      existingRunIdsRef.current.clear();
      if (leadId) {
        const res = await LeadService.getRevRenderRuns(leadId);
        const runs = res.data?.runs || res.data?.data?.runs || [];
        runs.forEach((r: any) => {
          const id = r.runId || r._id || r.id;
          if (id) existingRunIdsRef.current.add(id);
        });
      }
    } catch (e) {
      console.warn('[Reports] Failed to fetch pre-gen runs:', e);
    }

    FlashMessage.info(`Starting ${total} render generation(s)...`, 'RevRender');


    let completedCount = 0;

    const updateJobStateAndPersistence = (updater: (prev: any[]) => any[]) => {
      setRevRenderJobs(prev => {
        const next = updater(prev);
        Storage.setItem(`rev_render_jobs_${lead?._id || lead?.id}`, JSON.stringify(next));
        return next;
      });
    };

    const runRender = async (job: any, index: number) => {
      let mockTimer: any = null;
      let isCompleted = false;

      const startMockProgress = () => {
        let elapsed = 0;
        mockTimer = setInterval(() => {
          if (isCompleted) {
            clearInterval(mockTimer);
            return;
          }
          elapsed += 1;
          let nextProgress = 0;
          if (elapsed >= 15) {
            nextProgress = 80;
          } else if (elapsed >= 6) {
            nextProgress = 67;
          } else if (elapsed >= 2) {
            nextProgress = 20;
          }

          if (nextProgress > 0) {
            updateJobStateAndPersistence(prev => {
              const next = [...prev];
              if (next[index] && next[index].status === 'running' && (next[index].progress || 0) < nextProgress) {
                next[index].progress = nextProgress;
              }
              return next;
            });
          }
        }, 1000);
      };

      try {
        updateJobStateAndPersistence(prev => {
          const next = [...prev];
          next[index].status = 'running';
          next[index].progress = 0;
          return next;
        });
        
        startMockProgress();

        const res = await LeadService.generateRevRender(job.payload);
        const resData = res.data;
        const batchId = resData?.batch?.batchId ||
                        resData?.batchId ||
                        resData?.id ||
                        resData?.data?.batchId ||
                        resData?.data?.batch?.batchId ||
                        resData?.batch?.id;

        // A single payload's batch can render MORE than one image; capture the count
        // so the Tools card shows one "AI Rendering" placeholder PER render (not one
        // per job). Set as early as the create response exposes it.
        const initialTotal = Number(
          resData?.batch?.total ?? resData?.data?.batch?.total ?? resData?.total ?? 0
        ) || 0;
        if (initialTotal > 1) {
          updateJobStateAndPersistence(prev => {
            const next = [...prev];
            if (next[index]) next[index].total = initialTotal;
            return next;
          });
        }

        if (!batchId) {
          isCompleted = true;
          if (mockTimer) clearInterval(mockTimer);
          completedCount++;
          updateJobStateAndPersistence(prev => {
            const next = [...prev];
            next[index].status = 'completed';
            next[index].progress = 100;
            return next;
          });
          if (completedCount === total) {
            finalizeQueue();
          }
          return;
        }

        let isDone = false;

        while (!isDone) {
          await new Promise<void>(resolve => setTimeout(() => resolve(), 3000));
          try {
            const statusRes = await LeadService.getRevRenderBatchStatus(batchId);
            const batch = statusRes.data?.batch || statusRes.data;
            const batchStatus = batch?.status;
            const batchTotal = batch?.total || 1;

            // Keep the job's render count in sync so the Tools card shows one
            // placeholder per render while the batch is still generating.
            if (batchTotal > 1) {
              updateJobStateAndPersistence(prev => {
                const next = [...prev];
                if (next[index] && (Number(next[index].total) || 1) !== batchTotal) {
                  next[index].total = batchTotal;
                }
                return next;
              });
            }

            if (batchStatus === 'completed' || batchStatus === 'succeeded' || batchStatus === 'done') {
              isDone = true;
              isCompleted = true;
              if (mockTimer) clearInterval(mockTimer);
              completedCount++;
              updateJobStateAndPersistence(prev => {
                const next = [...prev];
                next[index].status = 'completed';
                next[index].progress = 100;
                return next;
              });
            } else if (batchStatus === 'failed' || batchStatus === 'cancelled') {
              isDone = true;
              isCompleted = true;
              if (mockTimer) clearInterval(mockTimer);
              throw new Error(batch?.message || 'Rendering failed or was cancelled');
            } else {
              if (batchTotal > 1) {
                const succeeded = batch?.succeeded || 0;
                const failed = batch?.failed || 0;
                const completedJobs = succeeded + failed;
                const newProgress = Math.round((completedJobs / batchTotal) * 100);
                
                updateJobStateAndPersistence(prev => {
                  const next = [...prev];
                  if (next[index] && next[index].status === 'running') {
                    next[index].progress = Math.max(next[index].progress || 0, newProgress >= 100 ? 99 : newProgress);
                  }
                  return next;
                });
              }
            }
          } catch (pollErr: any) {
            // Re-throw deliberate failures (failed/cancelled status) so the outer catch handles them
            if (isDone) throw pollErr;
            console.error('Polling error:', pollErr);
          }
        }

        if (completedCount === total) {
          finalizeQueue();
        }
      } catch (err: any) {
        isCompleted = true;
        if (mockTimer) clearInterval(mockTimer);
        completedCount++;
        console.error('RevRender Job Error:', err);
        
        let errorMsg = 'Generation failed';
        try {
          const errorBody = typeof err?.error === 'string' ? JSON.parse(err.error) : err?.error;
          if (errorBody?.error?.code === 503 || errorBody?.code === 503) {
            errorMsg = 'AI Model is currently busy. Please try again in a few minutes.';
          }
        } catch (e) {
          errorMsg = err?.message || 'AI service unavailable';
        }

        updateJobStateAndPersistence(prev => {
          const next = [...prev];
          next[index].status = 'failed';
          next[index].error = errorMsg;
          return next;
        });

        FlashMessage.error('Error', `${errorMsg} (Job ${index + 1})`);

        if (completedCount === total) {
          finalizeQueue();
        }
      }
    };

    const finalizeQueue = async () => {
      FlashMessage.info('RevRender Batch finished', 'Check results in Tools tab');
      setRevRenderJobs([]);
      Storage.removeItem(`rev_render_jobs_${lead?._id || lead?.id}`);

      queryClient.invalidateQueries({ queryKey: ['revrender-runs', lead?._id || lead?.id] });
      refetch();
    };


    payloads.forEach((_, i) => runRender(initialJobs[i], i));
  };

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
  };
};
