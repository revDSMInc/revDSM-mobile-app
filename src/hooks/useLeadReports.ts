import React, { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LeadService } from '../services/api/leads';
import { FlashMessage } from '../config/message';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import { downloadPdfToDevice } from '../utils/download-utils';

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

  // Resolve secure S3 URLs for generated reports
  useEffect(() => {
    const resolveUrls = async () => {
      const reports = lead?.generatedReports;
      if (!reports || reports.length === 0) return;

      const reportsKey = reports.map((r: any) => r.reportPath).join('|');
      if (resolvedReportsRef.current === reportsKey) return;

      try {
        const filePaths = reports.map((r: any) => ({
          bucketName: r.bucketName || 'np-revdsm-staging',
          filePath: r.reportPath,
        }));

        const res = await LeadService.getSecureUrls(filePaths);
        if (res.data?.data) {
          const urlMap: Record<string, string> = {};
          res.data.data.forEach((item: any) => {
            urlMap[item.filePath] = item.secureUrl || item.url;
          });
          setSecureUrls(urlMap);
          resolvedReportsRef.current = reportsKey;
        }
      } catch (err) {
        console.error('S3 Resolve Error:', err);
      }
    };
    resolveUrls();
  }, [lead?.generatedReports, lead?._id, lead?.id]);

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
            refetch();
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
    const initRiskJob = async () => {
      const savedJob = await AsyncStorage.getItem(`risk_job_${lead?._id || lead?.id}`);
      if (savedJob) {
        const job = JSON.parse(savedJob);
        setRiskJob(job);
      }
    };
    if (lead?._id || lead?.id) initRiskJob();
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

  return {
    secureUrls,
    riskJob,
    handleStartRiskReport,
    handleDownloadRiskReport,
    handleDownloadReport,
    handleResetRiskReport,
  };
};
