import { useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { LeadService } from '../services/api/leads';
import { FlashMessage } from '../config/message';
import { downloadPdfToDevice } from '../utils/download-utils';

interface ModalState {
  showJobBuilder: boolean;
  showInspectionGrid: boolean;
  showConsentModal: boolean;
  showPaperFallback: boolean;
  showWaiverModal: boolean;
  showInspectionModal: boolean;
  showRiskModal: boolean;
  showPdfModal: boolean;
}

export const useLeadCenterModals = (
  lead: any,
  initialTool?: string,
  secureUrls: Record<string, string> = {},
  riskJob: any = null,
  handlers: any = {}
) => {
  const navigation = useNavigation<any>();

  const [modals, setModals] = useState<ModalState>({
    showJobBuilder: initialTool === 'job_builder',
    showInspectionGrid: false,
    showConsentModal: false,
    showPaperFallback: false,
    showWaiverModal: false,
    showInspectionModal: false,
    showRiskModal: false,
    showPdfModal: false,
  });

  const [pdfPreviewData, setPdfPreviewData] = useState({ url: '', title: '' });

  const toggleModal = useCallback((modalName: keyof ModalState, visible: boolean) => {
    setModals((prev) => ({ ...prev, [modalName]: visible }));
  }, []);

  const handleOpenPdf = useCallback(
    async (url: string, title?: string) => {
      if (!url) {
        FlashMessage.error('Error', 'No document URL found');
        return;
      }
      setPdfPreviewData({ url, title: title || 'Document Preview' });
      toggleModal('showPdfModal', true);
    },
    [toggleModal]
  );

  const onToolAction = useCallback(
    (toolId: string, extra?: any) => {
      const findReport = (type: string) => {
        const keyword = type.split('_')[0].toLowerCase(); // 'consent', 'waiver', 'risk'
        const reports = [
          ...(lead?.generatedReports || []),
          ...(lead?.outcomeData?.generatedReports || []),
          ...(lead?.leadData?.generatedReports || []),
          ...(lead?.outcome?.generatedReports || []),
        ];

        return reports.find(
          (r: any) =>
            (r.reportType === type ||
              r.reportName?.toLowerCase().includes(keyword) ||
              r.reportPath?.toLowerCase().includes(keyword)) &&
            !r.isReset
        );
      };

      if (toolId === 'consent') {
        const existing = findReport('consent_form');
        if (existing) {
          handleOpenPdf(secureUrls[existing.reportPath] || existing.fileUrl);
        } else {
          toggleModal('showConsentModal', true);
        }
      } else if (toolId === 'waiver') {
        const existing = findReport('waiver_form');
        if (existing) {
          handleOpenPdf(secureUrls[existing.reportPath] || existing.fileUrl);
        } else {
          toggleModal('showWaiverModal', true);
        }
      } else if (toolId === 'consent-download') {
        handleOpenPdf(extra, 'Consent Form');
      } else if (toolId === 'waiver-download') {
        handleOpenPdf(extra, 'Roof Waiver');
      } else if (toolId === 'inspection') {
        toggleModal('showInspectionModal', true);
      } else if (toolId === 'inspection-preview') {
        handleOpenPdf(extra, 'Inspection Report');
      } else if (toolId === 'inspection-download') {
        handleOpenPdf(extra, 'Inspection Report');
      } else if (toolId === 'risk') {
        toggleModal('showRiskModal', true);
      } else if (toolId === 'risk-generate') {
        handlers.handleStartRiskReport?.(extra);
      } else if (toolId === 'risk-preview') {
        const existing = findReport('risk_report');
        const jobUrl =
          riskJob?.status === 'completed' || riskJob?.progress === 100
            ? LeadService.getRiskDownloadUrl(riskJob.jobId)
            : null;
        handleOpenPdf(jobUrl || secureUrls[existing?.reportPath || ''] || extra, 'Risk Report');
      } else if (toolId === 'risk-download') {
        const existing = findReport('risk_report');
        const jobUrl =
          riskJob?.status === 'completed' || riskJob?.progress === 100
            ? LeadService.getRiskDownloadUrl(riskJob.jobId)
            : null;
        const targetUrl = jobUrl || secureUrls[existing?.reportPath || ''] || extra;
        downloadPdfToDevice(targetUrl, 'Risk Report');
      } else if (toolId === 'risk-reset') {
        handlers.handleResetRiskReport?.(extra);
      } else if (toolId === 'revrender') {
        // Handled in screen directly via navigation for better stability
      } else if (toolId === 'pitchbook') {
        navigation.navigate('Pitchbook', { lead });
      }
    },
    [lead, secureUrls, riskJob, handleOpenPdf, toggleModal, handlers, navigation]
  );

  return {
    ...modals,
    pdfPreviewData,
    toggleModal,
    handleOpenPdf,
    onToolAction,
  };
};
