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
  SoldProduct,
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
// No job payload is served from mocks any more — `getJob` fetches the real thing, so a
// stand-in job can no longer reach the screen. The remaining `INSTALLER_USE_MOCKS`
// branches are write no-ops (progress / result / discrepancy), which return nothing.
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
  job: (jobId: string) => `installer/v1/jobs/${jobId}`,
  progress: (jobId: string) => `installer/v1/jobs/${jobId}/progress`,
  result: (jobId: string) => `installer/v1/jobs/${jobId}/result`,
  discrepancy: (jobId: string) => `installer/v1/jobs/${jobId}/discrepancy`,
  /**
   * Images. Two verbs, one path:
   *   PUT    — multipart upload (`phase` + `files` + `images` JSON).
   *   DELETE — removes stored shots (`{ phase, s3urls }`).
   * Both live.
   */
  images: (jobId: string) => `installer/v1/${jobId}/images`,
  /**
   * Step data — `{ stepData: { …allow-listed fields } }`, with optional top-level
   * `status` / `reason`. Live, and the ONLY write route for a job: it replaced both the
   * older `installer/v1/{jobId}` (same fields, FLAT) and
   * `installer/v1/update-job-status/{jobId}`, which used to own the transitions.
   */
  update: (jobId: string) => `installer/v1/update/${jobId}`,
  /**
   * Work session — the installer's check-in / check-out on a job. Live.
   *
   * Same shape as the sales side (`lead/v1/{leadId}/work`): a body-less PUT opens the
   * session (the server stamps `workStartedBy` from the token), and a PUT carrying
   * `{ workStartedBy: null }` closes it.
   */
  work: (jobId: string) => `installer/v1/${jobId}/work`,
  /**
   * Reset — reopens a resulted job so the crew can come back to it. Live.
   * Takes `{ statusReason }`; the job returns to `inProgress`.
   */
  reset: (jobId: string) => `installer/v1/${jobId}/reset`,
  /**
   * Status requests — the "Can't Do Work" flow. Live.
   *
   * POST `{ reason, images[] }`. A request, not a transition: it asks for the job to
   * be stood down and leaves the status alone until ops acts, which is why it is its
   * own collection endpoint and not a `status` on `update`.
   */
  statusRequests: (jobId: string) => `installer/v1/${jobId}/status-requests`,
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

/**
 * `?period=` on `my-jobs`. The wire values are NOT the tab labels: the installer reads
 * "Today" and "Tomorrow", the request carries `all` and `tomorrow`.
 */
export type JobPeriod = 'all' | 'tomorrow';

/**
 * Statuses the API uses for a job that is over — no more field work expected.
 *
 * Includes the two result codes: once an installer answers "Can't Do Work" or "Not
 * Hit", the job is settled for this visit and reopens only through Reset, so it must
 * open read-only rather than inviting more work. Compared lower-cased, hence the
 * flattened spelling of the camelCase codes.
 */
const RESULTED_STATUSES = [
  'completed',
  'resulted',
  'cancelled',
  'canceled',
  'closed',
  'cantdowork',
  'nothit',
];

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
 * Arrives on the check-in response as `{ url, bucketName }`, where `url`
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
 * The install record the server already holds — carried through so the timeline can be
 * rebuilt from it rather than from this device's storage alone.
 *
 * Returns undefined when the payload holds none of it (a `my-jobs` list row), so a list
 * row merged over a check-in payload can't blank out what check-in supplied.
 */
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
    // Passed through as the server keeps it; `installer-hydrate` turns it back into
    // the device's own record.
    coc: raw.coc ?? undefined,
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
    // `installerBypass` on the installer rows; `bypass` is the same object under the
    // name the sales endpoints use, accepted so a job fetched through either shape
    // reaches the gates. Left undefined when neither is present — the gates test the
    // flags, not the object, but an empty `{}` would still be a lie about the payload.
    installerBypass: raw?.installerBypass ?? raw?.bypass ?? undefined,
    companyName: raw?.companyName,
    resulted: RESULTED_STATUSES.includes(status.toLowerCase()),
    notes: normalizeJobNotes(raw?.note ?? raw?.notes),
    // Only present on the start-job response, not on the list.
    contract: normalizeContract(raw?.contractDetails),
    preInstallPhotos: raw?.preInstallPhotos,
    stored: normalizeStoredRecords(raw),
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

/**
 * Field names out of a `400 Unsupported patch fields: a, b. Allowed: …` rejection.
 *
 * The axios interceptor rejects with the server's own body, so the wording arrives on
 * `err.message`. Returns `[]` for any other failure — a network drop or a 500 must not
 * be mistaken for a field the server dislikes.
 */
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
  /** Jobs assigned to the signed-in installer for a given day. */
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

  /**
   * Moves a job through the workflow — `PUT installer/v1/update/{jobId}` with
   * `{ status, statusReason }` and nothing else.
   *
   * Same path as the step-data save, different verb: **PUT is the transition, PATCH is
   * the data**. Don't collapse them — a PUT carrying `stepData` is not the contract, and
   * a PATCH is what completion uses precisely because it carries all 7 steps alongside
   * `status: completed`.
   *
   * `status` is a wire code (`cantDoWork`, `notHit`, `inProgress`), not a button label;
   * `statusReason` is an object with `reason` + optional `images[]`. Returns whatever
   * job the response carried, or null — the payload is not part of the contract, so
   * callers must not depend on it. Starting a job gets its working payload from check-in
   * instead.
   */
  setJobStatus: async (
    jobId: string,
    status: JobStatus,
    /**
     * Why. `{ reason, images? }`. Only `undefined` omits the field, so a transition
     * with no reason menu (job start) doesn't carry an empty key.
     */
    statusReason?: StatusReasonPayload
  ): Promise<InstallerJob | null> => {
    const body = statusReason === undefined ? { status } : { status, statusReason };
    traceRequest('Job status', 'put', InstallerEndpoints.update(jobId), body);

    const res: AxiosResponse<any> = await api.put(InstallerEndpoints.update(jobId), body);
    traceResponse('Job status', res.data);
    const data = res.data?.data ?? res.data;
    return data?._id ? normalizeInstallerJob(data) : null;
  },

  /**
   * Files a status request — "Can't Do Work".
   *
   * `POST installer/v1/{jobId}/status-requests` with `{ reason, images[] }`.
   *
   * ⚠️ This REPLACED the `PUT …/update/{jobId}` + `{ status: 'cantDoWork' }` transition
   * that used to back this button. Do not send both: the request is the record ops
   * reviews, and setting the status here as well would stand the job down before
   * anyone had looked at it. "Not Hit" is unaffected and still uses `setJobStatus`.
   *
   * Returns nothing — the response shape is not part of the contract, same as
   * `resetJob`. The caller reports success from the absence of a throw.
   */
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

  /**
   * Reset — reopens the job so the crew can come back to it.
   *
   * Its own endpoint rather than a `status` transition: the server decides what the job
   * returns to (`inProgress`) and answers with `{ previousStatus, status }` plus ids —
   * a summary, not the job — so nothing is normalized out of it.
   *
   * `statusReason` is an object with `reason` + optional `images[]`.
   */
  resetJob: async (jobId: string, statusReason: StatusReasonPayload): Promise<void> => {
    const body = { statusReason };
    traceRequest('Reset job', 'put', InstallerEndpoints.reset(jobId), body);

    const res: AxiosResponse<any> = await api.put(InstallerEndpoints.reset(jobId), body);
    traceResponse('Reset job', res.data);
  },

  /**
   * Check-in — the installer has opened the job and is working it.
   *
   * The worker is still taken from the bearer token; what the body carries is **where
   * the installer was standing when they tapped**, so the server can enforce the same
   * geofence the app just applied (`utils/installer-geofence.ts`):
   *
   *   `location` — the DEVICE's fix, as GeoJSON `[longitude, latitude]`. Not the job's
   *                own point: the server already knows that, and a location it already
   *                holds proves nothing about who is on site.
   *   `address`  — the job address the check-in was matched against, so a rejection can
   *                name it.
   *   `radius`   — the tolerance the app allowed, in metres. Sent rather than assumed so
   *                a change on either side is visible in the request instead of silently
   *                disagreeing.
   *
   * Omitted entirely when the device could not produce a fix and the gate let the
   * check-in through anyway (a job with no coordinates and no locatable office) — a
   * body-less PUT is still the contract, which is what this endpoint took before.
   *
   * Answers with the full working payload — `contractDetails`, `preInstallPhotos`,
   * `productDetails`, `submissionPdf`. This is now the ONLY place that data comes from,
   * so the detail screen is rendered straight off this response. Null only if the body
   * carried no job.
   */
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

  /**
   * Check-out — the installer has left the job. Clearing `workStartedBy` is what
   * closes the session, mirroring `LeadService.endWorkLead` on the sales side.
   *
   * Skipped outright when there is no auth token, because the commonest way to leave a
   * job is to LOG OUT: that clears the token, the navigator swaps screen sets, the
   * detail screen unmounts, and its check-out cleanup fires into a session that no
   * longer exists — `401 Authorization header is missing`. Nothing is lost by not
   * sending it; the server ties the work session to the bearer token, so signing out
   * ends it server-side anyway.
   */
  endWork: async (jobId: string): Promise<void> => {
    if (!hasSession()) {
      console.warn('[Installer] Skipping check-out — no session to check out of.');
      return;
    }
    const body = { workStartedBy: null };
    traceRequest('Check out', 'put', InstallerEndpoints.work(jobId), body);
    await api.put(InstallerEndpoints.work(jobId), body);
  },

  /**
   * One job in full — `GET installer/v1/jobs/{jobId}`.
   *
   * NOT CALLED. Reviewing a resulted job reads it from `{jobId}/work` instead, which is
   * the endpoint that actually answers with the working payload. Kept because a plain
   * read that opens no work session is the shape this eventually wants — switch the
   * read-only branch of `openJob` over the moment this route is confirmed to exist.
   *
   * Not mock-gated, deliberately: answering a real job id with a stand-in job would put
   * someone else's contract on the screen, which is worse than showing nothing.
   */
  getJob: async (jobId: string): Promise<InstallerJob | null> => {
    traceRequest('Job detail', 'get', InstallerEndpoints.job(jobId), undefined);

    const res: AxiosResponse<any> = await api.get(InstallerEndpoints.job(jobId));
    traceResponse('Job detail', res.data);

    const data = res.data?.data ?? res.data;
    return data?._id ? normalizeInstallerJob(data) : null;
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
   * Deletes stored install photos — `DELETE installer/v1/{jobId}/images`.
   *
   * Body: `{ phase, s3urls }`. The keys are the bucket-relative `s3url`s the upload
   * returned, so a photo that never reached S3 has nothing to delete and must not be
   * passed here — callers filter first.
   *
   * This is the counterpart to the multipart upload, and it is what actually removes
   * the object; the step-data PATCH only restates which keys the job still references.
   * Both are needed on a removal: the DELETE drops the stored image, the PATCH drops
   * the reference. Fire the DELETE first — if the PATCH is then lost on a bad
   * connection, the server's own array is already short of the deleted shot, whereas
   * the reverse order can leave a live reference to an object that is gone.
   *
   * Takes the wider `InstallerDeletePhase` — this route also accepts `scope` and `coc`,
   * which the upload route has no array for.
   *
   * Resolves without a request when `s3urls` is empty, so callers can hand it whatever
   * the installer removed without pre-checking.
   */
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

    // axios puts a DELETE body on `config.data` — there is no `api.delete(url, body)`
    // overload, and passing it positionally would silently send no body at all.
    const res: AxiosResponse<any> = await api.delete(InstallerEndpoints.images(jobId), {
      data: body,
    });
    traceResponse('Delete images', res.data);
  },

  /**
   * Persists one step's data — `PATCH installer/v1/update/{jobId}`.
   *
   * The step fields go inside a **`stepData` wrapper**; only `status` sits at the top
   * level. (The predecessor route, `PATCH installer/v1/{jobId}`, took the same fields
   * FLAT and rejected the wrapper with `400 Unsupported patch fields: stepData` —
   * that is the shape this endpoint replaced.)
   *
   * Unknown keys are stripped rather than trusted, so one unsupported field can never
   * take down a whole step's save. If the server rejects a key anyway — its allow-list
   * moved, or a field is not wired yet — the request is retried once WITHOUT the keys
   * it named, so the rest of the step still saves instead of the whole thing being
   * lost. What was dropped is logged; the installer is on a roof, not at a console.
   *
   * `status` rides along at the top level when given — that is how the job is signed
   * off, in the same request that carries the visit's data. A transition on its own
   * (start, result) is a **PUT** through `setJobStatus`, not a PATCH: same path, and the
   * verb is what distinguishes a transition from a data write.
   */
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
        // Named loudly, with the URL and status: a 404 here means the route isn't the
        // one the backend serves, which reads on-device exactly like a lost connection.
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

  /**
   * Marks a job finished — the installer's explicit "Job Completed" confirmation.
   *
   * ONE request: `PATCH installer/v1/update/{jobId}` carrying `status: 'completed'`
   * alongside every step's data merged into a single `stepData`. The steps were each
   * saved as they were left, but restating them here means the sign-off cannot land on
   * a half-written record — if one step's save was dropped on a bad connection, this
   * request repairs it and completes the job in the same breath.
   *
   * (It used to be two calls, the step data then `PUT update-job-status`. That route is
   * gone; this endpoint takes `status` itself, so the transition rides along instead.)
   */
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
