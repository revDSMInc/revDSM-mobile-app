import api from './index';
import { AxiosResponse } from 'axios';
import type {
  ContractDetails,
  InstallerJob,
  InstallerJobsResult,
  InstallProgress,
  InstallerResultSubmission,
  DiscrepancyReport,
  JobStatus,
  SoldProduct,
  JobNote,
  JobPacket,
  InstallerImageDescriptor,
  InstallerImagePhase,
  InstallerImageUploadResult,
  InstallerJobPatch,
  InstallerStoredImage,
  InstallerUploadFile,
} from '../../config/types/installer';
import { MOCK_INSTALLER_JOBS, MOCK_INSTALLER_JOBS_TOMORROW } from './installer.mock';
import { stripUnsupportedFields } from '../../utils/installer-step-data';
import { ENV } from '../../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Request tracing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prints the exact body an installer write endpoint is about to send.
 *
 * The two PATCH/PUT calls here fail on *shape*, not on data — the server answers a
 * bad body with `400 Unsupported patch fields` and a list — so a summary is useless;
 * what's needed is the literal JSON. Dev-only, because these payloads carry customer
 * detail that has no business in a production log.
 */
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

/**
 * Installer endpoints.
 *
 * `myJobs` is live. The rest are provisional — those parts of the backend are not
 * built yet. Each is named after the operation the UI needs so the shape is settled
 * ahead of integration; confirm the final paths before flipping INSTALLER_USE_MOCKS off.
 */
export const InstallerEndpoints = {
  myJobs: 'installer/v1/my-jobs',
  updateJobStatus: (jobId: string) => `installer/v1/update-job-status/${jobId}`,
  job: (jobId: string) => `installer/v1/jobs/${jobId}`,
  progress: (jobId: string) => `installer/v1/jobs/${jobId}/progress`,
  result: (jobId: string) => `installer/v1/jobs/${jobId}/result`,
  discrepancy: (jobId: string) => `installer/v1/jobs/${jobId}/discrepancy`,
  /** Multipart image upload — `phase` + `files` + `images` (JSON). Live. */
  images: (jobId: string) => `installer/v1/${jobId}/images`,
  /** Step data — flat body, allow-listed fields only (`INSTALLER_PATCH_FIELDS`). Live. */
  update: (jobId: string) => `installer/v1/${jobId}`,
};

/**
 * HTTP verb for the image upload.
 *
 * ⚠️ The endpoint appends to a collection; the sibling sales endpoint
 * (`PUT demo/v1/leads/{leadId}/images`) is a PUT, so that is what this uses. If the
 * backend registered it as POST instead, flip this one constant — nothing else in
 * the app hard-codes the verb.
 */
const IMAGE_UPLOAD_METHOD: 'put' | 'post' = 'put';

/**
 * Placeholder-data switch for the endpoints that are still unbuilt (job detail,
 * progress, result, discrepancy). The job list is NOT gated by this — `getJobs`
 * always calls the live `my-jobs` endpoint.
 */
export const INSTALLER_USE_MOCKS = true;

/** Simulates network latency so loading states are exercised during design review. */
const mockDelay = <T,>(data: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));

export type JobPeriod = 'today' | 'tomorrow';

/** Statuses the API uses for a job that is over — no more field work expected. */
const RESULTED_STATUSES = ['completed', 'resulted', 'cancelled', 'canceled', 'closed'];

/** Money arrives as a string ("400") and as "" when unset. */
const toAmount = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** `contractDetails` (API) → `ContractDetails` (app). Undefined when nothing is set. */
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

/**
 * Auto-generated schema ids leak through as field/section labels (e.g.
 * "section_1781585651515", "selection_ycsmh"). They carry no meaning to the
 * installer, so a label matching this pattern is dropped and only the value shown.
 */
const AUTO_LABEL = /^(section_|field_|selection_)/i;

/**
 * A `locationGrid` measurement arrives as a JSON string, e.g.
 * `{"Left Side":{"1st":5}}` → "Left Side 1st: 5". Anything unparseable is
 * returned untouched.
 */
const formatMeasurements = (raw: string): string => {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return raw;
    const parts: string[] = [];
    Object.entries(obj).forEach(([location, stories]) => {
      if (stories && typeof stories === 'object') {
        Object.entries(stories as Record<string, unknown>).forEach(([story, val]) => {
          parts.push(`${location} ${story}: ${val}`);
        });
      } else {
        parts.push(`${location}: ${stories}`);
      }
    });
    return parts.length ? parts.join(' · ') : raw;
  } catch {
    return raw;
  }
};

/** One `{ label, value }` schema field → a human line, or null when empty. */
const formatProductField = (field: any): string | null => {
  const rawValue = field?.value;
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  let value = String(rawValue).trim();
  if (!value) return null;

  const rawLabel = String(field?.label ?? '').trim();
  const isMeasurement =
    rawLabel.toLowerCase() === 'measurements' ||
    (value.startsWith('{') && value.endsWith('}'));
  if (isMeasurement) value = formatMeasurements(value);

  const humanLabel = !rawLabel || AUTO_LABEL.test(rawLabel) ? '' : rawLabel;
  return humanLabel ? `${humanLabel}: ${value}` : value;
};

/**
 * `productDetails` (API) → `SoldProduct[]` (app) for the Verify Scope step.
 *
 * The sold scope the installer confirms is the set of subcategories (e.g. "Gutters",
 * "Gutter Guards"), so each subcategory becomes one scope card. Its `lines` are the
 * entered measurements, colors and selections — combinations are numbered when a
 * subcategory has more than one; loose section fields (Extras) are appended flat.
 */
export const normalizeProductDetails = (raw: any): SoldProduct[] | undefined => {
  const products: any[] = Array.isArray(raw?.products) ? raw.products : [];
  if (products.length === 0) return undefined;

  const out: SoldProduct[] = [];

  products.forEach((product) => {
    const subs: any[] = Array.isArray(product?.subcategories) ? product.subcategories : [];

    if (subs.length === 0) {
      out.push({
        id: String(product?.id ?? product?.verticalId ?? product?.name ?? ''),
        name: product?.name ?? 'Product',
        lines: [],
      });
      return;
    }

    subs.forEach((sub) => {
      const lines: string[] = [];
      const sections: any[] = Array.isArray(sub?.sections) ? sub.sections : [];

      sections.forEach((section) => {
        const combinations: any[] = Array.isArray(section?.combinations)
          ? section.combinations
          : [];
        const multiCombo = combinations.length > 1;

        combinations.forEach((combo, i) => {
          const fieldLines = (Array.isArray(combo?.fields) ? combo.fields : [])
            .map(formatProductField)
            .filter(Boolean) as string[];
          if (fieldLines.length === 0) return;
          if (multiCombo) {
            lines.push(`Combination #${combo?.index ?? i + 1} — ${fieldLines.join(' · ')}`);
          } else {
            lines.push(...fieldLines);
          }
        });

        // Loose fields outside any combination (e.g. an "Extras" section).
        const looseLines = (Array.isArray(section?.fields) ? section.fields : [])
          .map(formatProductField)
          .filter(Boolean) as string[];
        lines.push(...looseLines);
      });

      out.push({
        id: String(sub?.id ?? `${product?.id ?? ''}__${sub?.label ?? ''}`),
        name: sub?.label ?? product?.name ?? 'Product',
        lines,
      });
    });
  });

  return out.length ? out : undefined;
};

/**
 * `note` (API) → `JobNote[]` (app) for the Notes card.
 *
 * The field is tolerant of shape: a bare string ("Gate code 4412…"), a single note
 * object, or an array of them. A blank/`null` note yields undefined so the card
 * hides entirely rather than rendering an empty box.
 */
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

/**
 * `submissionPdf` (API) → `JobPacket` (app).
 *
 * Arrives on the `update-job-status` response as `{ url, bucketName }`, where `url`
 * is a bucket-relative key ending in a uuid. That uuid is meaningless to an
 * installer, so the card shows a name built from the lead/job number and falls back
 * to the raw filename only when neither is known.
 */
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

/**
 * Maps a `my-jobs` row onto the app's `InstallerJob` shape.
 *
 * The API row is flat (`arrivalWindow` / `date` / `address` / `customerName`) while
 * the rest of the installer module speaks the lead model (`leadTime` / `leadDate` /
 * `fullAddress` / `customerDetails`), so the translation lives here rather than in
 * every consumer. Raw fields are carried through as well for screens that want them.
 */
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
    companyName: raw?.companyName,
    resulted: RESULTED_STATUSES.includes(status.toLowerCase()),
    notes: normalizeJobNotes(raw?.note ?? raw?.notes),
    // Only present on the start-job response, not on the list.
    contract: normalizeContract(raw?.contractDetails),
    preInstallPhotos: raw?.preInstallPhotos,
    products: normalizeProductDetails(raw?.productDetails),
    // Returned once the rep's submission PDF has been generated.
    packet: normalizeSubmissionPdf(raw?.submissionPdf, raw),
  };
};

/**
 * Layers a freshly-fetched job over the one already in hand, ignoring keys the new
 * payload didn't supply. The list and start-job responses carry different subsets of
 * a job, so a blind spread would blank out fields the caller still needs.
 */
export const mergeInstallerJob = (base: InstallerJob, patch: InstallerJob): InstallerJob => {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Partial<InstallerJob>;
  return { ...base, ...defined };
};

/**
 * Where the API keeps the full array for each phase, e.g. `phase: "pickup"` →
 * `data.installerPickupPhotos`. `preExisting` is a best guess — the observed
 * responses only cover pickup — so `normalizeImageUploadResult` also falls back to
 * "whichever array isn't `appended`", which keeps this working if the key differs.
 */
const PHASE_ARRAY_KEY: Record<InstallerImagePhase, string> = {
  pickup: 'installerPickupPhotos',
  preExisting: 'installerPreExistingPhotos',
  pre: 'installerPreInstallPhotos',
  post: 'installerPostInstallPhotos',
  return: 'installerReturnPhotos',
};

const toStoredImages = (raw: any): InstallerStoredImage[] =>
  Array.isArray(raw) ? (raw.filter((x) => x && x.s3url) as InstallerStoredImage[]) : [];

export const normalizeImageUploadResult = (
  body: any,
  phase: InstallerImagePhase
): InstallerImageUploadResult => {
  const data = body?.data ?? body ?? {};
  const appended = toStoredImages(data.appended);

  let photos = toStoredImages(data[PHASE_ARRAY_KEY[phase]]);
  if (photos.length === 0) {
    // Unknown key for this phase — take the first array of images that isn't
    // `appended` rather than reporting an empty list.
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
  };
};

export const InstallerService = {
  /** Jobs assigned to the signed-in installer for a given day. */
  getJobs: async (period: JobPeriod = 'today'): Promise<InstallerJobsResult> => {
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

  /**
   * Moves a job through the workflow and returns the full job back.
   *
   * Starting a job (`inProgress`) is how the installer gets the working payload —
   * the response is the only place `contractDetails` and the rep's `preInstallPhotos`
   * come from, so the caller should hold the screen until it resolves.
   */
  updateJobStatus: async (
    jobId: string,
    status: JobStatus,
    /**
     * Why — sent by the result actions (cancel / update / pending). An empty string
     * is still sent; only `undefined` omits the field, so a Reset (which has no
     * reason menu) posts `reason: ""` rather than dropping the key.
     */
    reason?: string
  ): Promise<InstallerJob> => {
    const body = reason === undefined ? { status } : { status, reason };
    traceRequest('Job status', 'put', InstallerEndpoints.updateJobStatus(jobId), body);

    const res: AxiosResponse<any> = await api.put(
      InstallerEndpoints.updateJobStatus(jobId),
      body
    );
    traceResponse('Job status', res.data);
    return normalizeInstallerJob(res.data?.data ?? res.data);
  },

  getJob: async (jobId: string): Promise<InstallerJob | null> => {
    if (INSTALLER_USE_MOCKS) {
      const all = [...MOCK_INSTALLER_JOBS, ...MOCK_INSTALLER_JOBS_TOMORROW];
      return mockDelay(all.find((j) => j._id === jobId) ?? null);
    }
    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.job(jobId));
    return res.data?.data ?? res.data ?? null;
  },

  /** Persists timeline progress. Local-only until the endpoint exists. */
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

  /** Routes a scope discrepancy to the Install Manager + originating rep. */
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

  /**
   * Uploads install photos for one phase — `installer/v1/{jobId}/images`.
   *
   * Multipart, three fields:
   *   `phase`  — pickup | preExisting | pre | post | return
   *   `files`  — the binaries, one part per photo
   *   `images` — a JSON array of descriptors, index-aligned with `files`
   *
   * The backend puts each file in S3 and appends the resulting `{ s3url, bucketName,
   * … }` to the job's array for that phase, answering with `appended` (just these)
   * plus the full post-append list. Callers store `appended[i].s3url` on the local
   * photo — the step-data PATCH references it.
   *
   * NOT gated by `INSTALLER_USE_MOCKS`: this endpoint is live.
   */
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

    // Binaries can't be printed, so the trace shows the three form fields as the
    // network tab renders them: phase, the file parts by name, and the images JSON.
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
        // Photo bodies on a job site network need more headroom than a JSON call.
        timeout: 120000,
      }
    );

    traceResponse('Images', res.data);
    return normalizeImageUploadResult(res.data, phase);
  },

  /**
   * Persists one step's data — `PATCH installer/v1/{jobId}`.
   *
   * The body is FLAT. An earlier version wrapped it in `stepData`, which the server
   * rejects outright:
   *   `400 Unsupported patch fields: stepData. Allowed: preExistingConditions,
   *    installerPreInstallPhotos, installerPostInstallPhotos, jobScopeVerification,
   *    materialReturnNothingToReturn`
   * Unknown keys are stripped here rather than trusted, so one unsupported field can
   * never take down a whole step's save.
   *
   * `status` is NOT accepted by this endpoint — use `updateJobStatus`.
   */
  updateJob: async (jobId: string, patch: InstallerJobPatch): Promise<InstallerJob | null> => {
    const body = stripUnsupportedFields(patch);
    if (Object.keys(body).length === 0) {
      if (isDev) console.log('[Installer] Step data — nothing patchable, request skipped');
      return null;
    }

    traceRequest('Step data', 'patch', InstallerEndpoints.update(jobId), body);

    const res: AxiosResponse<any> = await api.patch(InstallerEndpoints.update(jobId), body);
    traceResponse('Step data', res.data);
    const data = res.data?.data ?? res.data;
    return data ? normalizeInstallerJob(data) : null;
  },

  /**
   * Marks a job finished — the installer's explicit "Job Completed" confirmation.
   *
   * Two calls, in order: any final step data first (so nothing is stranded on the
   * device), then `status: 'completed'` through `update-job-status`, which is the
   * endpoint that owns workflow transitions — the PATCH above refuses `status`.
   * A failed step-data sync does not block the status change; the photos and the
   * conditions are already on the server, and the installer has said they are done.
   */
  completeJob: async (
    jobId: string,
    finalPatch?: InstallerJobPatch
  ): Promise<InstallerJob> => {
    if (isDev) {
      // A banner around the pair, because "completing a job" is one action to the
      // installer but two requests on the wire — seeing them grouped is what makes
      // the Metro output match the thing that was just tapped.
      console.log(
        `\n[Installer] ══════════ COMPLETE JOB ${jobId} ══════════\n` +
          `Sends ${finalPatch ? 2 : 1} request(s):\n` +
          `  1. PATCH ${fullUrl(InstallerEndpoints.update(jobId))}` +
          `${finalPatch ? '' : ' (skipped — no final step data)'}\n` +
          `  ${finalPatch ? '2' : '1'}. PUT   ${fullUrl(
            InstallerEndpoints.updateJobStatus(jobId)
          )}\n`
      );
    }

    if (finalPatch) {
      try {
        await InstallerService.updateJob(jobId, finalPatch);
      } catch (err) {
        console.warn('[Installer] Final step-data sync failed before completing:', err);
      }
    }

    const job = await InstallerService.updateJobStatus(jobId, 'completed');
    if (isDev) console.log('[Installer] ══════════ COMPLETE JOB done ══════════\n');
    return job;
  },
};
