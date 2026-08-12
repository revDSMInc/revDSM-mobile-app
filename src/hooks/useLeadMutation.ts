import { useMutation, useQueryClient } from '@tanstack/react-query';
import ReactNativeBlobUtil from 'react-native-blob-util';
import FileViewer from 'react-native-file-viewer';
import { Storage } from '../utils/storage';
import { FlashMessage } from '../config/message';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { Platform } from 'react-native';

export const useCreateLeadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await LeadService.createLead(data);
      return res.data;
    },
    onSuccess: () => {
      // Invalidate leads queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
};

// `useUpdateLeadOutcomeMutation` was REMOVED (2026-08-12): it wrapped the deprecated
// lead-scoped `PUT lead/v1/{leadId}/outcome` and had no call sites anywhere in the app.

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
    mutationFn: (leadId: string) => LeadService.resetLead(leadId),
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
      console.log('Starting Digital Consent Mutation with BlobUtil:', data);
      const token = Storage.getItem('accessToken');
      const url = `${ENV.API_URL}user/consent/v1/mobile/create`
        .replace(/\/\//g, '/')
        .replace('https:/', 'https://');

      const normalizedData = data.payload ? { ...data.payload } : { ...data };

      const body: any[] = [];
      Object.keys(normalizedData).forEach((key) => {
        if ((key === 'file' || key === 'signature') && normalizedData[key]?.uri) {
          const cleanPath = normalizedData[key].uri.replace('file://', '');
          body.push({
            name: key,
            filename: normalizedData[key].name || 'signature.svg',
            type: normalizedData[key].type || 'image/svg+xml',
            data: ReactNativeBlobUtil.wrap(cleanPath),
          });
        } else {
          body.push({ name: key, data: String(normalizedData[key]) });
        }
      });

      const fetchConfig = {
        fileCache: true,
        appendExt: 'pdf',
        timeout: 120000,
        path: `${ReactNativeBlobUtil.fs.dirs.CacheDir}/consent_${Date.now()}.pdf`,
      };

      const res = await ReactNativeBlobUtil.config(fetchConfig).fetch(
        'POST',
        url,
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
          Accept: 'application/pdf',
        },
        body
      );

      const pdfPath = res.path() || fetchConfig.path;
      const status = res.info().status;

      if (status >= 400) {
        const errorText = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'utf8');
        await ReactNativeBlobUtil.fs.unlink(pdfPath);
        try {
          const parsed = JSON.parse(errorText);
          throw new Error(parsed.message || parsed.error || `Server Error: ${status}`);
        } catch (e) {
          throw new Error(`Server Error (${status}): ${errorText.substring(0, 100)}`);
        }
      }

      const content = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'base64');
      if (!content.startsWith('JVBERi')) {
        await ReactNativeBlobUtil.fs.unlink(pdfPath);
        throw new Error('Generated file is not a valid PDF.');
      }
      return pdfPath;
    },
    onSuccess: async (pdfPath: string) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      // FlashMessage.success('Success', 'Digital document generated.');
      // We will now handle the PDF path in the UI instead of auto-opening here
    },
    onError: (err: any) => {
      console.error('Digital Consent Mutation Error:', err);
      if (err.config) {
        console.log('Failed Request Config:', {
          url: err.config.url,
          method: err.config.method,
          headers: err.config.headers,
        });
      }
      FlashMessage.error('Error', err?.message || 'Failed to submit consent');
    },
  });
};

export const useSubmitRoofWaiverMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, payload }: { leadId: string; payload: any }) => {
      console.log('Starting Roof Waiver Mutation with BlobUtil:', payload);
      const token = Storage.getItem('accessToken');
      const url = `${ENV.API_URL}/lead/v1/${leadId}/mobile/waiver-form`
        .replace(/\/\//g, '/')
        .replace('https:/', 'https://');

      const body: any[] = [];
      Object.keys(payload).forEach((key) => {
        if ((key === 'file' || key === 'signature') && payload[key]?.uri) {
          const cleanPath = payload[key].uri.replace('file://', '');
          body.push({
            name: key,
            filename: payload[key].name || 'signature.svg',
            type: payload[key].type || 'image/svg+xml',
            data: ReactNativeBlobUtil.wrap(cleanPath),
          });
        } else {
          body.push({ name: key, data: String(payload[key]) });
        }
      });

      const fetchConfig = {
        fileCache: true,
        appendExt: 'pdf',
        timeout: 120000,
        path: `${ReactNativeBlobUtil.fs.dirs.CacheDir}/waiver_${Date.now()}.pdf`,
      };

      const res = await ReactNativeBlobUtil.config(fetchConfig).fetch(
        'POST',
        url,
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
          Accept: 'application/pdf',
        },
        body
      );

      const pdfPath = res.path() || fetchConfig.path;
      const status = res.info().status;

      if (status >= 400) {
        const errorText = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'utf8');
        await ReactNativeBlobUtil.fs.unlink(pdfPath);
        try {
          const parsed = JSON.parse(errorText);
          throw new Error(parsed.message || parsed.error || `Server Error: ${status}`);
        } catch (e) {
          throw new Error(`Server Error (${status}): ${errorText.substring(0, 100)}`);
        }
      }

      const content = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'base64');
      if (!content.startsWith('JVBERi')) {
        await ReactNativeBlobUtil.fs.unlink(pdfPath);
        throw new Error('Generated file is not a valid PDF.');
      }
      return pdfPath;
    },
    onSuccess: (pdfPath: string) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      // FlashMessage.success('Success', 'Waiver document generated.');
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
      const formData = new FormData();
      formData.append('leadId', leadId);
      formData.append('reportType', reportType);
      formData.append('file', {
        uri:
          Platform.OS === 'android'
            ? pdfPath.startsWith('file://')
              ? pdfPath
              : `file://${pdfPath}`
            : pdfPath,
        name: `${reportType}.pdf`,
        type: 'application/pdf',
      } as any);

      return LeadService.uploadGeneratedReport(formData);
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
    mutationFn: ({ leadId, formData }: { leadId: string; formData: FormData }) =>
      LeadService.uploadImages(leadId, formData),
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
