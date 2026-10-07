import api, { hasSession } from './index';
import { AxiosResponse } from 'axios';
import type {
  ContractDetails,
  InstallerJob,
  InstallerJobsResult,
  InstallProgress,
  InstallerResultSubmission,
  DiscrepancyReport,
  JobStatus,
  JobNote,
  JobPacket,
  InstallerImageDescriptor,
  InstallerImageDeletePayload,
  InstallerImagePhase,
  InstallerDeletePhase,
  InstallerImageUploadResult,
  InstallerJobPatch,
  InstallerCheckInPayload,
  InstallerStoredImage,
  InstallerStoredRecords,
  InstallerUploadFile,
  StatusReasonPayload,
  StatusRequestPayload,
} from '../../config/types/installer';
import { stripUnsupportedFields } from '../../utils/installer-step-data';
import { extractCocScanFields } from '../../utils/installer-coc-scan';
import { extractCocPdf } from '../../utils/installer-coc-pdf';
import { normalizeProductDetails } from '../../utils/installer-product-scope';
import { ENV } from '../../config/env';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

const fullUrl = (path: string): string => {
  const base = ENV.API_URL.endsWith('/') ? ENV.API_URL.slice(0, -1) : ENV.API_URL;
  return `${base}/${path}`;
};

const traceRequest = (label: string, method: string, path: string, body: unknown): void => {
  if (!isDev) return;
  console.log(
    `\n[Installer] ── ${label} ──\n${method.toUpperCase()} ${fullUrl(path)}\n${JSON.stringify(
      body,
      null,
      2
    )}\n`
  );
};

const traceResponse = (label: string, body: unknown): void => {
  if (!isDev) return;
  console.log(`[Installer] ── ${label} · response ──\n${JSON.stringify(body, null, 2)}\n`);
};

export const InstallerEndpoints = {
  myJobs: 'installer/v1/my-jobs',
  job: (jobId: string) => `installer/v1/jobs/${jobId}`,
  progress: (jobId: string) => `installer/v1/jobs/${jobId}/progress`,
  result: (jobId: string) => `installer/v1/jobs/${jobId}/result`,
  discrepancy: (jobId: string) => `installer/v1/jobs/${jobId}/discrepancy`,
  images: (jobId: string) => `installer/v1/${jobId}/images`,
  update: (jobId: string) => `installer/v1/update/${jobId}`,
  work: (jobId: string) => `installer/v1/${jobId}/work`,
  reset: (jobId: string) => `installer/v1/${jobId}/reset`,
  statusRequests: (jobId: string) => `installer/v1/${jobId}/status-requests`,
};

const IMAGE_UPLOAD_METHOD: 'put' | 'post' = 'put';

export const INSTALLER_USE_MOCKS = true;

const mockDelay = <T,>(data: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));

export type JobPeriod = 'all' | 'tomorrow';

const RESULTED_STATUSES = [
  'completed',
  'resulted',
  'cancelled',
  'canceled',
  'closed',
  'cantdowork',
  'nothit',
];

const toAmount = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeContract = (raw: any): ContractDetails | undefined => {
  if (!raw) return undefined;
  const method = (v: unknown) => (v ? String(v).toUpperCase() : undefined);

  const contract: ContractDetails = {
    contractPrice: toAmount(raw.originalContractPrice ?? raw.contractPrice),
    downPayment: toAmount(raw.downPayment),
    downPaymentMethod: method(raw.downPaymentMethod),
    remainingBalance: toAmount(raw.balance ?? raw.remainingBalance),
    balanceMethod: method(raw.balancePaymentMethod ?? raw.balanceMethod),
    loanAuth: raw.loanAuth || undefined,
  };

  return Object.values(contract).some((v) => v !== undefined) ? contract : undefined;
};

const normalizeJobNotes = (raw: any): JobNote[] | undefined => {
  if (raw === null || raw === undefined || raw === '') return undefined;

  const toNote = (n: any, i: number): JobNote | null => {
    if (n === null || n === undefined) return null;
    if (typeof n === 'string') {
      const body = n.trim();
      return body
        ? { id: `note-${i}`, author: 'Rep', at: 'at job build', body, pinned: false }
        : null;
    }
    const body = String(n.body ?? n.text ?? n.note ?? n.message ?? '').trim();
    if (!body) return null;
    return {
      id: String(n.id ?? n._id ?? `note-${i}`),
      author: n.author ?? n.authorName ?? n.role ?? 'Note',
      at: n.at ?? n.createdAt ?? '',
      body,
      pinned: Boolean(n.pinned ?? n.isPinned),
    };
  };

  const list = Array.isArray(raw) ? raw : [raw];
  const notes = list.map(toNote).filter(Boolean) as JobNote[];
  return notes.length ? notes : undefined;
};

const normalizeSubmissionPdf = (raw: any, job: any): JobPacket | undefined => {
  const url: string | undefined = raw?.url || raw?.s3url;
  if (!url) return undefined;

  const reference = job?.leadDisplayId && job.leadDisplayId !== 'N/A'
    ? job.leadDisplayId
    : job?.jobNumber;

  return {
    fileName: reference
      ? `Job_Submission_${reference}.pdf`
      : url.split('/').pop() || 'Job_Submission.pdf',
    s3url: url,
    bucketName: raw?.bucketName,
  };
};

const STORED_RECORD_KEYS = [
  'installerPickupPhotos',
  'installerReturnPhotos',
  'installerCocPhotos',
  'installerPreInstallPhotos',
  'installerPostInstallPhotos',
  'preExistingConditions',
  'jobScopeVerification',
  'materialReturnNothingToReturn',
  'coc',
];

const normalizeStoredRecords = (raw: any): InstallerStoredRecords | undefined => {
  if (!raw || !STORED_RECORD_KEYS.some((key) => raw[key] !== undefined)) return undefined;

  return {
    pickupPhotos: toStoredImages(raw.installerPickupPhotos),
    returnPhotos: toStoredImages(raw.installerReturnPhotos),
    cocPhotos: toStoredImages(raw.installerCocPhotos),
    preInstallPhotos: toStoredImages(raw.installerPreInstallPhotos),
    postInstallPhotos: toStoredImages(raw.installerPostInstallPhotos),
    preExistingConditions: raw.preExistingConditions ?? undefined,
    jobScopeVerification: raw.jobScopeVerification ?? undefined,
    materialReturnNothingToReturn:
      typeof raw.materialReturnNothingToReturn === 'boolean'
        ? raw.materialReturnNothingToReturn
        : undefined,
    coc: raw.coc ?? undefined,
  };
};

export const normalizeInstallerJob = (raw: any): InstallerJob => {
  const status: string = raw?.status ?? '';
  const displayId: string | undefined =
    raw?.leadDisplayId && raw.leadDisplayId !== 'N/A' ? raw.leadDisplayId : undefined;
  const name: string = (raw?.customerName ?? '').trim();
  const [firstName, ...rest] = name ? name.split(/\s+/) : [];

  return {
    _id: raw?._id ?? raw?.id ?? '',
    leadId: raw?.leadId,
    leadDisplayId: displayId,
    jobNumber: raw?.jobNumber,
    leadTime: raw?.arrivalWindow || raw?.time || undefined,
    leadDate: raw?.date,
    fullAddress: raw?.address,
    customerId: raw?.customerId,
    customerName: name || undefined,
    customerDetails: {
      firstName,
      lastName: rest.join(' ') || undefined,
      phone: raw?.customerPhone,
      email: raw?.customerEmail,
    },
    location: raw?.location,
    status,
    workflowState: raw?.workflowState,
    installerBypass: raw?.installerBypass ?? raw?.bypass ?? undefined,
    companyName: raw?.companyName,
    resulted: RESULTED_STATUSES.includes(status.toLowerCase()),
    notes: normalizeJobNotes(raw?.note ?? raw?.notes),
    contract: normalizeContract(raw?.contractDetails),
    preInstallPhotos: raw?.preInstallPhotos,
    stored: normalizeStoredRecords(raw),
    products: normalizeProductDetails(raw?.productDetails),
    packet: normalizeSubmissionPdf(raw?.submissionPdf, raw),
    cocPacket: extractCocPdf(raw) ?? undefined,
  };
};

export const mergeInstallerJob = (base: InstallerJob, patch: InstallerJob): InstallerJob => {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Partial<InstallerJob>;
  return { ...base, ...defined };
};

const PHASE_ARRAY_KEY: Record<InstallerImagePhase, string> = {
  pickup: 'installerPickupPhotos',
  preExisting: 'installerPreExistingPhotos',
  pre: 'installerPreInstallPhotos',
  post: 'installerPostInstallPhotos',
  return: 'installerReturnPhotos',
  coc: 'installerCocPhotos',
  cocPaperFallback: 'installerCocPhotos',
  result: 'installerResultPhotos',
};

const toStoredImages = (raw: any): InstallerStoredImage[] =>
  Array.isArray(raw) ? (raw.filter((x) => x && x.s3url) as InstallerStoredImage[]) : [];

export const normalizeImageUploadResult = (
  body: any,
  phase: InstallerImagePhase
): InstallerImageUploadResult => {
  const data = body?.data ?? body ?? {};
  let appended = toStoredImages(data.appended);

  if (appended.length === 0) {
    const block = data[phase] && typeof data[phase] === 'object' ? data[phase] : null;
    const s3url = block?.s3url || data.s3url;
    if (s3url) {
      appended = [
        {
          _id: block?._id || '',
          s3url,
          bucketName: block?.bucketName || data.bucketName,
        } as InstallerStoredImage,
      ];
    }
  }

  let photos = toStoredImages(data[PHASE_ARRAY_KEY[phase]]);
  if (photos.length === 0) {
    const fallbackKey = Object.keys(data).find(
      (k) => k !== 'appended' && toStoredImages(data[k]).length > 0
    );
    if (fallbackKey) photos = toStoredImages(data[fallbackKey]);
  }

  return {
    jobId: data._id,
    leadId: data.leadId,
    phase: data.phase ?? phase,
    appended,
    photos: photos.length ? photos : appended,
    scan: phase === 'cocPaperFallback' ? extractCocScanFields(body) : null,
  };
};

const unsupportedFieldsFrom = (err: any): string[] => {
  const message = String(err?.message ?? '');
  const match = /unsupported patch fields?:\s*([^.]+)/i.exec(message);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
};

export const InstallerService = {
  getJobs: async (period: JobPeriod = 'all'): Promise<InstallerJobsResult> => {
    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.myJobs, {
      params: { period },
    });
    const payload = res.data?.data ?? res.data ?? {};
    const rows: any[] = Array.isArray(payload) ? payload : payload?.jobs ?? [];

    return {
      jobs: rows.map(normalizeInstallerJob),
      pagination: payload?.pagination,
      summaryCounts: payload?.summaryCounts,
    };
  },

  setJobStatus: async (
    jobId: string,
    status: JobStatus,
    statusReason?: StatusReasonPayload
  ): Promise<InstallerJob | null> => {
    const body = statusReason === undefined ? { status } : { status, statusReason };
    traceRequest('Job status', 'put', InstallerEndpoints.update(jobId), body);

    const res: AxiosResponse<any> = await api.put(InstallerEndpoints.update(jobId), body);
    traceResponse('Job status', res.data);
    const data = res.data?.data ?? res.data;
    return data?._id ? normalizeInstallerJob(data) : null;
  },

  createStatusRequest: async (
    jobId: string,
    request: StatusRequestPayload
  ): Promise<void> => {
    traceRequest(
      'Status request',
      'post',
      InstallerEndpoints.statusRequests(jobId),
      request
    );
    const res: AxiosResponse<any> = await api.post(
      InstallerEndpoints.statusRequests(jobId),
      request
    );
    traceResponse('Status request', res.data);
  },

  resetJob: async (jobId: string, statusReason: StatusReasonPayload): Promise<void> => {
    const body = { statusReason };
    traceRequest('Reset job', 'put', InstallerEndpoints.reset(jobId), body);

    const res: AxiosResponse<any> = await api.put(InstallerEndpoints.reset(jobId), body);
    traceResponse('Reset job', res.data);
  },

  startWork: async (
    jobId: string,
    checkIn?: InstallerCheckInPayload
  ): Promise<InstallerJob | null> => {
    traceRequest('Check in', 'put', InstallerEndpoints.work(jobId), checkIn);
    const res: AxiosResponse<any> = await api.put(
      InstallerEndpoints.work(jobId),
      checkIn
    );
    traceResponse('Check in', res.data);
    const data = res.data?.data ?? res.data;
    return data?._id || data?.leadId ? normalizeInstallerJob(data) : null;
  },

  endWork: async (jobId: string): Promise<void> => {
    if (!hasSession()) {
      console.warn('[Installer] Skipping check-out — no session to check out of.');
      return;
    }
    const body = { workStartedBy: null };
    traceRequest('Check out', 'put', InstallerEndpoints.work(jobId), body);
    await api.put(InstallerEndpoints.work(jobId), body);
  },

  getJob: async (jobId: string): Promise<InstallerJob | null> => {
    traceRequest('Job detail', 'get', InstallerEndpoints.job(jobId), undefined);

    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.job(jobId));
    traceResponse('Job detail', res.data);

    const data = res.data?.data ?? res.data;
    return data?._id ? normalizeInstallerJob(data) : null;
  },

  saveProgress: async (
    jobId: string,
    progress: Partial<InstallProgress>
  ): Promise<void> => {
    if (INSTALLER_USE_MOCKS) {
      await mockDelay(null, 120);
      return;
    }
    await api.put(InstallerEndpoints.progress(jobId), progress);
  },

  submitResult: async (submission: InstallerResultSubmission): Promise<void> => {
    if (INSTALLER_USE_MOCKS) {
      await mockDelay(null, 250);
      return;
    }
    await api.post(InstallerEndpoints.result(submission.jobId), {
      result: submission.result,
      reason: submission.reason,
    });
  },

  reportDiscrepancy: async (
    jobId: string,
    report: DiscrepancyReport
  ): Promise<void> => {
    if (INSTALLER_USE_MOCKS) {
      await mockDelay(null, 250);
      return;
    }
    await api.post(InstallerEndpoints.discrepancy(jobId), report);
  },

  uploadImages: async (
    jobId: string,
    phase: InstallerImagePhase,
    files: InstallerUploadFile[],
    descriptors: InstallerImageDescriptor[]
  ): Promise<InstallerImageUploadResult> => {
    const formData = new FormData();
    formData.append('phase', phase);
    files.forEach((file) => {
      formData.append('files', {
        uri: file.uri,
        name: file.name,
        type: file.type,
      } as any);
    });
    formData.append('images', JSON.stringify(descriptors));

    traceRequest('Images', IMAGE_UPLOAD_METHOD, InstallerEndpoints.images(jobId), {
      phase,
      files: files.map((f) => ({ name: f.name, type: f.type })),
      images: descriptors,
    });

    const res: AxiosResponse<any> = await api[IMAGE_UPLOAD_METHOD](
      InstallerEndpoints.images(jobId),
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      }
    );

    traceResponse('Images', res.data);
    return normalizeImageUploadResult(res.data, phase);
  },

  deleteImages: async (
    jobId: string,
    phase: InstallerDeletePhase,
    s3urls: string[]
  ): Promise<void> => {
    const keys = s3urls.filter(Boolean);
    if (keys.length === 0) {
      if (isDev) console.log(`[Installer] Delete images (${phase}) — nothing stored, skipped`);
      return;
    }

    const body: InstallerImageDeletePayload = { phase, s3urls: keys };
    traceRequest('Delete images', 'delete', InstallerEndpoints.images(jobId), body);

    const res: AxiosResponse<any> = await api.delete(InstallerEndpoints.images(jobId), {
      data: body,
    });
    traceResponse('Delete images', res.data);
  },

  updateJob: async (
    jobId: string,
    patch: InstallerJobPatch,
    options?: { status?: JobStatus }
  ): Promise<InstallerJob | null> => {
    const stepData = stripUnsupportedFields(patch);
    const { status } = options ?? {};

    if (Object.keys(stepData).length === 0 && !status) {
      if (isDev) console.log('[Installer] Step data — nothing patchable, request skipped');
      return null;
    }

    const send = async (fields: InstallerJobPatch): Promise<InstallerJob | null> => {
      const body = {
        ...(status ? { status } : {}),
        ...(Object.keys(fields).length ? { stepData: fields } : {}),
      };
      traceRequest('Step data', 'patch', InstallerEndpoints.update(jobId), body);

      try {
        const res: AxiosResponse<any> = await api.patch(InstallerEndpoints.update(jobId), body);
        traceResponse('Step data', res.data);
        const data = res.data?.data ?? res.data;
        return data ? normalizeInstallerJob(data) : null;
      } catch (err: any) {
        console.warn(
          `[Installer] Step data PATCH failed — ${err?.httpStatus ?? 'no response'} ` +
            `${fullUrl(InstallerEndpoints.update(jobId))}\n` +
            `  ${err?.message ?? ''}`
        );
        throw err;
      }
    };

    try {
      return await send(stepData);
    } catch (err) {
      const rejected = unsupportedFieldsFrom(err).filter((f) => f in stepData);
      if (rejected.length === 0) throw err;

      const retry = { ...stepData };
      rejected.forEach((field) => delete (retry as any)[field]);
      console.warn(
        `[Installer] Server rejected ${rejected.join(', ')} — retrying without ` +
          `${Object.keys(retry).length ? Object.keys(retry).join(', ') : 'nothing left to send'}`
      );
      if (Object.keys(retry).length === 0 && !status) return null;
      return send(retry);
    }
  },

  completeJob: async (
    jobId: string,
    finalPatch?: InstallerJobPatch
  ): Promise<InstallerJob | null> => {
    if (isDev) {
      console.log(
        `\n[Installer] ══════════ COMPLETE JOB ${jobId} ══════════\n` +
          `  PATCH ${fullUrl(InstallerEndpoints.update(jobId))} ` +
          `(status: completed + all steps)\n`
      );
    }

    const job = await InstallerService.updateJob(jobId, finalPatch ?? {}, {
      status: 'completed',
    });
    if (isDev) console.log('[Installer] ══════════ COMPLETE JOB done ══════════\n');
    return job;
  },
};
