import { useMutation, useQueryClient } from '@tanstack/react-query';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import { Storage } from '../utils/storage';
import { FlashMessage } from '../config/message';
import { LeadService } from '../services/api/leads';
import { isSuccessfulCreate } from '../utils/offline-lead-queue';
import { ENV } from '../config/env';
import { Platform } from 'react-native';
import { submitConsentForm, finalizeConsentUpload } from '../services/api/consent-forms';
import { markConsentFiled, clearConsentFiled } from '../services/consentFiledStore';

export const useCreateLeadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await LeadService.createLead(data);
      const body = res.data;
      // ⚠️ This backend can answer `{ code: 400, message: "..." }` as the BODY. If it ever arrives with an HTTP 2xx, axios does not
      // reject it, and the form would say "Lead created successfully" for a lead the server REFUSED (the offline queue's drain
      // already guards the same shape with `isSuccessfulCreate`). Reject it here, shaped like `normalizeApiError`'s rejection, so
      // the form's classification and message handling see exactly what an HTTP 4xx would have given them.
      if (!isSuccessfulCreate(body)) {
        const bodyCode = typeof body?.code === 'number' && body.code >= 400 ? body.code : undefined;
        throw {
          ...(body && typeof body === 'object' ? body : {}),
          message: (body && typeof body === 'object' && body.message) || 'Failed to create lead',
          httpStatus: bodyCode ?? (res.status >= 400 ? res.status : 400),
        };
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
};

export const useSubmitJobBuilderMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, payload }: { leadId: string; payload: any }) => {
      const res = await LeadService.submitJobBuilder(leadId, payload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['job-builder', variables.leadId] });
    },
  });
};

export const useWorkLeadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      userId,
      status = null,
    }: {
      leadId: string;
      userId: string;
      status?: string | null;
    }) => LeadService.workLead(leadId, userId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', res.data?.message || 'Work status updated');
    },
    onError: (err: any) => {
      FlashMessage.error('Error', err?.message || 'Failed to update work status');
    },
  });
};

export const useArchiveLeadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, isArchive }: { leadId: string; isArchive: boolean }) =>
      LeadService.archiveLead(leadId, isArchive),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', res.data?.message || 'Lead archiving updated');
    },
    onError: (err: any) => {
      FlashMessage.error('Error', err?.message || 'Failed to archive lead');
    },
  });
};

export const useDeleteLeadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => LeadService.deleteLead(leadId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', res.data?.message || 'Lead deleted');
    },
    onError: (err: any) => {
      FlashMessage.error('Error', err?.message || 'Failed to delete lead');
    },
  });
};

export const useResetLeadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const res = await LeadService.resetLead(leadId);
      // ⚠️ A reset is the ONE thing allowed to clear the local "already filed" record. Without
      // this the rep could never re-collect consent on a deliberately reset lead - the log would
      // outlive the thing it describes. A failed read must still never clear it.
      clearConsentFiled(leadId, 'consent');
      clearConsentFiled(leadId, 'waiver');
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', res.data?.message || 'Lead data has been reset');
    },
    onError: (err: any) => {
      FlashMessage.error('Error', err?.message || 'Failed to reset lead data');
    },
  });
};

export const useSubmitDigitalConsentMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const payload = data?.payload ? { ...data.payload } : { ...data };
      const leadId = String(data?.leadId || payload?.leadId || '');
      const pdfPath = await submitConsentForm({ kind: 'consent', leadId, payload });
      // ⚠️ Record it HERE, on this device, the moment the server accepts it. "Already filed"
      // used to be read only from `lead.generatedReports` - server data - so going offline with
      // a cached lead taken before the submission offered the blank form again and let the rep
      // take a SECOND signature for the same consent.
      markConsentFiled(leadId, 'consent');
      return pdfPath;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: any) => {
      console.error('Digital Consent Mutation Error:', err);
      FlashMessage.error('Error', err?.message || 'Failed to submit consent');
    },
  });
};

export const useSubmitRoofWaiverMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, payload }: { leadId: string; payload: any }) => {
      const pdfPath = await submitConsentForm({ kind: 'waiver', leadId, payload });
      markConsentFiled(leadId, 'waiver');
      return pdfPath;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: any) => {
      console.error('Roof Waiver Mutation Error:', err);
      FlashMessage.error('Error', err?.message || 'Failed to submit waiver');
    },
  });
};
export const useUploadPaperConsentOCRMutation = () => {
  return useMutation({
    mutationFn: async (file: any) => {
      console.log('Starting OCR Mutation with BlobUtil:', file);
      const token = Storage.getItem('accessToken');
      const url = `${ENV.API_URL}api/v1/consent-form/upload`
        .replace(/\/\//g, '/')
        .replace('https:/', 'https://');

      const cleanPath = file.uri.replace('file://', '');
      const body = [
        {
          name: 'file',
          filename: file.name || 'document.jpg',
          type: file.type || 'image/jpeg',
          data: ReactNativeBlobUtil.wrap(cleanPath),
        },
      ];

      const res = await ReactNativeBlobUtil.config({ timeout: 120000 }).fetch(
        'POST',
        url,
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        body
      );

      const resData = JSON.parse(res.data);
      return resData;
    },
    onSuccess: (data: any) => {
      console.log('OCR Result:', data);
      FlashMessage.success('Success', 'Paper form scanned');
    },
    onError: (err: any) => {
      console.error('OCR Mutation Error:', err);
      FlashMessage.error('Error', err?.message || 'Failed to scan paper document');
    },
  });
};

export const useFinalizeConsentUploadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      leadId,
      pdfPath,
      reportType = 'consent_form',
    }: {
      leadId: string;
      pdfPath: string;
      reportType?: string;
    }) => {
      return finalizeConsentUpload({
        leadId,
        pdfPath,
        kind: reportType === 'waiver_form' ? 'waiver' : 'consent',
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      const isWaiver = variables.reportType === 'waiver_form';
      const docName = isWaiver ? 'Roof waiver' : 'Consent form';
      FlashMessage.success('Success', `${docName} successfully uploaded`);
    },
    onError: (err: any) =>
      FlashMessage.error('Error', err?.message || 'Failed to archive document'),
  });
};

export const useUploadReportMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) => LeadService.uploadGeneratedReport(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', 'Report generated and uploaded');
    },
    onError: (err: any) => FlashMessage.error('Error', err?.message || 'Failed to upload report'),
  });
};

export const useGenerateRevRenderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) => LeadService.generateRevRender(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', 'RevRender generated');
    },
    onError: (err: any) => FlashMessage.error('Error', err?.message || 'Failed to generate render'),
  });
};

export const useUploadImagesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      formData,
      idempotencyKey,
    }: {
      leadId: string;
      formData: FormData;
      /**
       * ⚠️ Optional, but pass it wherever there is a stable per-image id. Without it an upload
       * that times out after the server stored the photo is re-sent as a duplicate - the bug
       * that turned 4 photos into 9. See `utils/upload-idempotency.ts`.
       */
      idempotencyKey?: string | null;
    }) => LeadService.uploadImages(leadId, formData, idempotencyKey),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', variables.leadId] });
      FlashMessage.success('Saved', 'Photo uploaded successfully');
    },
    onError: (err: any) => FlashMessage.error('Error', err?.message || 'Failed to upload photo'),
  });
};

export const useDeleteImageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, payload }: { leadId: string; payload: any }) =>
      LeadService.deleteImage(leadId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', variables.leadId] });
      FlashMessage.success('Deleted', 'Photo removed successfully');
    },
    onError: (err: any) => FlashMessage.error('Error', err?.message || 'Failed to delete photo'),
  });
};

export const useUpdateLeadImagePositionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, payload }: { leadId: string; payload: any }) =>
      LeadService.updateImagePosition(leadId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', variables.leadId] });
      FlashMessage.success('Saved', 'Photo repositioned successfully');
    },
    onError: (err: any) => FlashMessage.error('Error', err?.message || 'Failed to move photo'),
  });
};
