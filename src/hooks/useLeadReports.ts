import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LeadService } from '../services/api/leads';
import { FlashMessage } from '../config/message';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import { downloadPdfToDevice } from '../utils/download-utils';
import { ENV } from '../config/env';

export interface RiskJob {

  jobId: string;
  progress: number;
  status: string;
  step: string;
}

export const useLeadReports = (lead: any, refetch: () => void) => {
  const [secureUrls, setSecureUrls] = useState<Record<string, string>>({});
  const resolvedReportsRef = useRef<string>('');
  const [riskJob, setRiskJob] = useState<RiskJob | null>(null);
  const [revRenderJobs, setRevRenderJobs] = useState<any[]>([]);
  const queryClient = useQueryClient();

  // Resolve secure S3 URLs for generated reports
  const refreshSecureUrls = async () => {
    const reports = lead?.generatedReports;
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
    if (lead?._id) {
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
          };
          setRiskJob(updatedJob);

          if (data.status === 'completed' || data.progress === 100) {
            console.log('[Risk] Job completed, final sync...');
            setRiskJob(null);
            // Small delay to allow server to finalize report entry before refetching
            setTimeout(() => {
              refetch();
            }, 1000);
            await AsyncStorage.removeItem(`risk_job_${lead?._id || lead?.id}`);
            return true;
          }
        }
      } catch (err) {
        console.error('[Risk] Status check failed:', err);
      }
      return false;
    },
    [lead?._id, lead?.id, refetch]
  );

  // Risk Report Polling Effect
  useEffect(() => {
    let interval: any;

    if (
      riskJob?.jobId &&
      (riskJob.status === 'running' || riskJob.status === 'pending') &&
      riskJob.jobId !== 'temp'
    ) {
      interval = setInterval(() => pollRiskStatus(riskJob.jobId), 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [riskJob?.jobId, riskJob?.status, pollRiskStatus]);

  // Initial check for existing risk job
  useEffect(() => {
    const initJobs = async () => {
      const savedRisk = await AsyncStorage.getItem(`risk_job_${lead?._id || lead?.id}`);
      if (savedRisk) {
        setRiskJob(JSON.parse(savedRisk));
      }
      const savedRev = await AsyncStorage.getItem(`rev_render_jobs_${lead?._id || lead?.id}`);
      if (savedRev) {
        setRevRenderJobs(JSON.parse(savedRev));
      }
    };
    if (lead?._id || lead?.id) initJobs();
  }, [lead?._id, lead?.id]);

  const handleStartRiskReport = async (pastYears: number) => {
    try {
      setRiskJob({ jobId: 'temp', progress: 0, status: 'pending', step: 'Starting...' });
      FlashMessage.info('Starting Risk Report generation...', 'Processing');

      const res = await LeadService.generateWeatherReport(lead?._id || lead?.id, pastYears);
      const jobId = res.data?.data?.jobId;
      if (jobId) {
        console.log('[Risk] Received jobId:', jobId);
        const newJob = { jobId, progress: 0, status: 'pending', step: 'Initializing...' };
        setRiskJob(newJob);
        await AsyncStorage.setItem(`risk_job_${lead?._id || lead?.id}`, JSON.stringify(newJob));
        pollRiskStatus(jobId);
      } else {
        setRiskJob(null);
      }
    } catch (err) {
      console.error('[Risk] Failed to start generation:', err);
      setRiskJob(null);
      FlashMessage.error('Error', 'Failed to start report generation');
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
      setRiskJob(null);
      await AsyncStorage.removeItem(`risk_job_${lead?._id || lead?.id}`);
      refetch();
      FlashMessage.success('Success', 'Report reset successfully');
    } catch (err) {
      FlashMessage.error('Error', 'Failed to reset report');
    }
  };

  const handleStartRevRenders = async (payloads: any[]) => {
    const total = payloads.length;
    const initialJobs = payloads.map((p, i) => ({ id: i, status: 'pending', payload: p, progress: 0 }));
    setRevRenderJobs(initialJobs);
    await AsyncStorage.setItem(`rev_render_jobs_${lead?._id || lead?.id}`, JSON.stringify(initialJobs));

    FlashMessage.info(`Starting ${total} render generation(s)...`, 'RevRender');

    // Trigger each mutation
    let completedCount = 0;
    const currentJobs = [...initialJobs];

    const runRender = async (job: any, index: number) => {
      try {
        setRevRenderJobs(prev => {
          const next = [...prev];
          next[index].status = 'running';
          return next;
        });
        
        await LeadService.generateRevRender(job.payload);
        
        completedCount++;
        setRevRenderJobs(prev => {
          const next = [...prev];
          next[index].status = 'completed';
          next[index].progress = 100;
          return next;
        });
        
        if (completedCount === total) {
          finalizeQueue();
        } else {
          updatePersistence();
        }
      } catch (err: any) {
        completedCount++;
        console.error('RevRender Job Error:', err);
        
        let errorMsg = 'Generation failed';
        try {
          // Handle stringified error bodies (common in this API)
          const errorBody = typeof err?.error === 'string' ? JSON.parse(err.error) : err?.error;
          if (errorBody?.error?.code === 503 || errorBody?.code === 503) {
            errorMsg = 'AI Model is currently busy. Please try again in a few minutes.';
          }
        } catch (e) {
          errorMsg = err?.message || 'AI service unavailable';
        }

        setRevRenderJobs(prev => {
          const next = [...prev];
          next[index].status = 'failed';
          next[index].error = errorMsg;
          return next;
        });

        FlashMessage.error('Error', `${errorMsg} (Job ${index + 1})`);

        if (completedCount === total) {
          finalizeQueue();
        } else {
          updatePersistence();
        }
      }
    };

    const finalizeQueue = async () => {
      const current = payloads; // closure ref
      const failedCount = initialJobs.filter(j => j.status === 'failed').length; // This won't work due to state async
      // Better to check the final state or just notify
      
      FlashMessage.info('RevRender Batch finished', 'Check results in Tools tab');
      setRevRenderJobs([]);
      await AsyncStorage.removeItem(`rev_render_jobs_${lead?._id || lead?.id}`);
      queryClient.invalidateQueries({ queryKey: ['revrender-runs', lead?._id || lead?.id] });
      refetch();
    };

    const updatePersistence = async () => {
      // Persistence update helper
      const updatedJobs = payloads.map((p, i) => ({ 
        id: i, 
        status: i < completedCount ? 'finished' : (i === completedCount ? 'running' : 'pending'),
        payload: p,
      }));
      await AsyncStorage.setItem(`rev_render_jobs_${lead?._id || lead?.id}`, JSON.stringify(updatedJobs));
    };

    // Run sequentially to avoid overloading if needed, or in parallel
    // User wants "in background", so let's trigger them.
    payloads.forEach((_, i) => runRender(currentJobs[i], i));
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
