import { useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { LeadService } from '../services/api/leads';
import { FlashMessage } from '../config/message';
import { downloadPdfToDevice } from '../utils/download-utils';
import { newestReport, reportDisplayName } from '../utils/report-name';
import { useAuth } from './useAuth';
import { logEvent } from '../services/api/LoggerService';
import { isOnline } from '../services/connectivity';
import { offlineBlockFor } from '../utils/offline-capability';
import { useQueuedConsentForms } from './useQueuedConsentForms';

/**
 * ⚠️ The list of what cannot work offline MOVED to `utils/offline-capability.ts`, and it moved
 * because this hook stopped being the only place that needed it. Chat, the Job Tracker, Referral
 * and the addendum wizard all ask the same question now; two copies of the answer would let one
 * surface promise what another refuses, on the same phone, in front of the same customer.
 *
 * The tool ids and the wording are unchanged — see that file for why each entry is there, and for
 * the rule that anything with a device-side path (the consent and waiver FORMS above all) must
 * never be listed.
 */

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

/**
 * What to say when a signed form is still on the device. ⚠️ Never "submitted": the PDF is rendered
 * by the server, so until the upload lands there is no document to open.
 */
const queuedFormMessage = (): string =>
  isOnline()
    ? 'Saved on your device and uploading now. The PDF will be viewable once it is filed.'
    : 'Saved on your device. It will be filed — and viewable — once you are back online.';

const FILED_NOT_LOADED = 'Filed from this device. Pull down to refresh to view the PDF.';

export const useLeadCenterModals = (
  lead: any,
  initialTool?: string,
  secureUrls: Record<string, string> = {},
  riskJob: any = null,
  handlers: any = {}
) => {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  // A consent or waiver signed at a door counts as filed — see the note in `ToolsSection`, which
  // reads the same hook so the card and this guard can never disagree about it.
  const queuedForms = useQueuedConsentForms(lead);

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
      // One guard at the top, so no branch below can forget it.
      const blocked = offlineBlockFor(toolId, isOnline());
      if (blocked) {
        FlashMessage.info(blocked.title, blocked.message);
        return;
      }

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

      // Title/filename for the risk report. When the url comes from a just-finished job there
      // is no record for it yet in `existing` (it is the FIRST match, possibly an older
      // report), so use the newest non-reset one; otherwise the record the url came from.
      const riskTitle = (existing: any, fromJob: boolean) => {
        if (!fromJob) return reportDisplayName(existing, 'Risk Report');
        const risk = [
          ...(lead?.generatedReports || []),
          ...(lead?.outcomeData?.generatedReports || []),
          ...(lead?.leadData?.generatedReports || []),
          ...(lead?.outcome?.generatedReports || []),
        ].filter((r: any) => r?.reportName?.toLowerCase().includes('risk') && !r.isReset);
        return reportDisplayName(newestReport(risk), 'Risk Report');
      };

      if (toolId === 'consent') {
        // ⚠️ The QUEUED form is checked first and short-circuits, because there is no document to
        // open at all yet — the server renders the PDF from the submitted form, so until the queue
        // drains there is nothing to view. Falling through would re-open a blank form for a
        // customer who has already signed one.
        if (queuedForms.consentPending) {
          FlashMessage.info('Consent is signed', queuedFormMessage());
          return;
        }
        const existing = findReport('consent_form');
        if (!existing && queuedForms.consent) {
          // Uploaded from this device, but the lead in hand predates the refetch.
          FlashMessage.info('Consent is on file', FILED_NOT_LOADED);
          return;
        }
        if (existing && !isOnline()) {
          // The consent IS on file — which is what gates presenting a quote — so say so rather
          // than opening a viewer onto an expired link and letting it read as "not signed".
          FlashMessage.info(
            'Consent is on file',
            'Signed and filed. Viewing the PDF needs a connection.'
          );
        } else if (existing) {
          handleOpenPdf(secureUrls[existing.reportPath] || existing.fileUrl, 'Consent Form');
        } else {
          toggleModal('showConsentModal', true);
          if (user?._id || user?.id) {
            logEvent('view', {
              user_id: user?._id || user?.id,
              created_by: user?._id || user?.id,
              module_type: 'consent_form',
              meta: { action: 'consent portal opened' },
            });
          }
        }
      } else if (toolId === 'waiver') {
        if (queuedForms.waiverPending) {
          FlashMessage.info('Waiver is signed', queuedFormMessage());
          return;
        }
        const existing = findReport('waiver_form');
        if (!existing && queuedForms.waiver) {
          FlashMessage.info('Waiver is on file', FILED_NOT_LOADED);
          return;
        }
        if (existing && !isOnline()) {
          FlashMessage.info(
            'Waiver is on file',
            'Signed and filed. Viewing the PDF needs a connection.'
          );
        } else if (existing) {
          handleOpenPdf(secureUrls[existing.reportPath] || existing.fileUrl, 'Roof Waiver');
        } else {
          toggleModal('showWaiverModal', true);
          if (user?._id || user?.id) {
            logEvent('view', {
              user_id: user?._id || user?.id,
              created_by: user?._id || user?.id,
              module_type: 'roof_waiver_form',
              meta: { action: 'roof waiver portal opened' },
            });
          }
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
        handleOpenPdf(
          jobUrl || secureUrls[existing?.reportPath || ''] || existing?.fileUrl || extra,
          riskTitle(existing, !!jobUrl)
        );
      } else if (toolId === 'risk-download') {
        const existing = findReport('risk_report');
        const jobUrl =
          riskJob?.status === 'completed' || riskJob?.progress === 100
            ? LeadService.getRiskDownloadUrl(riskJob.jobId)
            : null;
        const targetUrl = jobUrl || secureUrls[existing?.reportPath || ''] || existing?.fileUrl || extra;
        downloadPdfToDevice(targetUrl, riskTitle(existing, !!jobUrl));
      } else if (toolId === 'risk-reset') {
        handlers.handleResetRiskReport?.(extra);
      } else if (toolId === 'revrender') {
        // Handled in screen directly via navigation for better stability
      } else if (toolId === 'pitchbook') {
        navigation.navigate('Pitchbook', { lead });
      }
    },
    [
      lead,
      secureUrls,
      riskJob,
      handleOpenPdf,
      toggleModal,
      handlers,
      navigation,
      queuedForms.consent,
      queuedForms.waiver,
      queuedForms.consentPending,
      queuedForms.waiverPending,
    ]
  );

  return {
    ...modals,
    pdfPreviewData,
    toggleModal,
    handleOpenPdf,
    onToolAction,
  };
};
