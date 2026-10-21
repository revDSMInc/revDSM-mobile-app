/**
 * Saving annotated photos as a BACKGROUND, OFFLINE-SAFE job (the "Save takes too long" ticket).
 *
 * Tapping Save used to download every original, rasterise each in the screen's WebView and upload them one by one
 * behind a full-screen loader. Now Save only writes a small JOB (the marks + a durable copy of the original) to disk and
 * returns; this service then, in the background:
 *   1. flattens the photo + marks into a JPEG (`annotationRenderer`, the app-root WebView),
 *   2. hands the JPEG to `uploadQueueManager` carrying an `annotation` descriptor (new photo = PUT, re-edit = PATCH).
 * The upload queue already owns retry, backoff, parking, offline waiting and idempotency, so an annotation made with no
 * signal is rendered locally, queued, and pushed when the connection returns.
 *
 * ⚠️ Jobs live in MMKV key `annotation_save_jobs` - it MUST stay in `SESSION_KEEP_KEYS` (utils/session-scope.ts) or a
 * sign-out wipes work the rep did at a door. Each job is stamped with its owner and only that rep's session replays it.
 * ⚠️ A job needs the ORIGINAL's bytes. A photo that exists only as a signed URL that was never cached cannot be flattened
 * with no connection; the job then waits for the connection (and is dropped, with a message, if the URL has expired).
 */
import { AppState } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { storage } from '../utils/storage';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner } from './sessionScope';
import { isOwnedBy } from '../utils/session-scope';
import { warmToLocalCache } from '../utils/imageFileCache';
import { uploadQueueManager, type UploadQueueAnnotation } from '../utils/uploadQueue';
import { renderAnnotatedImage } from './annotationRenderer';
import { FlashMessage } from '../config/message';
import { resetAnnotatedOrderSheet, saveAnnotatedOrderSheet, type ResetOutcome } from './orderSheetSync';
import { serverErrorText } from '../utils/order-sheet-annotation';
import { isNetworkError } from '../utils/network-error';

const JOBS_KEY = 'annotation_save_jobs';
const MAX_ATTEMPTS = 3;
const JOB_DIR = 'annotation_jobs';
const ORIGINAL_GRACE_MS = 30_000;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * REVUIUX-569: an ORDER SHEET annotation. Same queue, different ending: instead of a photo upload the flattened result is
 * wrapped as a PDF and PATCHed over the existing document (`services/orderSheetSync.ts`). ⚠️ Not the photo upload queue and
 * not the offline DOCUMENT queue - that one is append-only and would file a second order sheet.
 */
export interface OrderSheetJobAnnotation {
  mode: 'orderSheet';
  annotationData: any;
  /** The row's `serverId`, from EITHER backend collection - sent as it is. */
  orderSheetDocumentId: string;
  baseName?: string;
  contentKind: 'pdf' | 'image';
  mediaBox?: { width: number; height: number } | null;
  staleUris?: string[];
  originalPath?: string | null;
  knownSizes?: number[];
  /** Stamped when the job is written: the rep saved with no connection. */
  queuedOffline?: boolean;
}

/**
 * REVUIUX-569: "Reset all changes" asked with no connection. Rides the same durable queue as the annotation (FIFO, so a reset
 * asked after an annotate runs after it) and is replayed on reconnect by `resetAnnotatedOrderSheet`.
 */
export interface OrderSheetResetJobAnnotation {
  mode: 'orderSheetReset';
  orderSheetDocumentId: string;
  baseName?: string;
  currentUri?: string | null;
  knownSizes?: number[];
}

export interface AnnotationJob {
  id: string;
  userId?: string;
  leadId: string;
  /** Durable `file://` copy of the original (or the remote url when it could not be copied yet). */
  originalUri: string;
  layoutWidth: number;
  layoutHeight: number;
  strokes: any[];
  texts: any[];
  shapes: any[];
  categoryName: string;
  /** Includes the " (Annotated)" suffix. */
  subcategory: string;
  coordinates?: { latitude: number; longitude: number };
  createdAt: string;
  annotation: UploadQueueAnnotation | OrderSheetJobAnnotation | OrderSheetResetJobAnnotation;
  attempts?: number;
}

export type AnnotationJobInput = Omit<AnnotationJob, 'id' | 'userId' | 'createdAt' | 'attempts'>;

let jobs: AnnotationJob[] = [];
let loaded = false;
let processing = false;

const load = () => {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage.getString(JOBS_KEY);
    jobs = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[AnnotationJobs] could not read saved jobs', e);
    jobs = [];
  }
};

const listeners = new Set<() => void>();

/** Jobs of the signed-in rep that are still being flattened (the UI shows them as already-saved photos). */
export const getAnnotationJobs = (): AnnotationJob[] => {
  load();
  return jobs.filter(mine);
};

export const addAnnotationJobListener = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const persist = () => {
  try {
    storage.set(JOBS_KEY, JSON.stringify(jobs));
  } catch (e) {
    console.warn('[AnnotationJobs] could not save jobs', e);
  }
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[AnnotationJobs] listener failed', e);
    }
  });
};

const toFsPath = (uri: string) => decodeURIComponent(String(uri || '').replace(/^file:\/\//i, ''));
const isRemote = (uri: string) => /^https?:/i.test(uri);

const mine = (j: AnnotationJob) => isOwnedBy(j.userId, getSessionOwner());

export const pendingAnnotationJobCount = (): number => {
  load();
  return jobs.filter(mine).length;
};

const unlinkQuiet = async (uri?: string) => {
  if (!uri || isRemote(uri)) return;
  try {
    await ReactNativeBlobUtil.fs.unlink(toFsPath(uri));
  } catch {
    /* already gone */
  }
};

/** Copies the original into app storage so the job survives cache eviction. Remote urls are kept as they are. */
const makeDurable = async (id: string, uri: string): Promise<string> => {
  if (!uri || isRemote(uri)) return uri;
  try {
    const fs = ReactNativeBlobUtil.fs;
    const dir = `${fs.dirs.DocumentDir}/${JOB_DIR}`;
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
    const dest = `${dir}/${id}_original.jpg`;
    await fs.cp(toFsPath(uri), dest);
    return `file://${dest}`;
  } catch (e) {
    console.warn('[AnnotationJobs] could not copy the original, using it in place', e);
    return uri;
  }
};

/**
 * "Reset all changes" for an order sheet. Online it runs straight away (the rep sees the server's own answer); with no
 * connection - or when the request never reached the server - it is written to the durable queue and replayed on reconnect,
 * with the moment the rep asked as the log's action time. Resolves 'queued' in that case.
 */
export const requestOrderSheetReset = async (args: {
  leadId: string;
  documentId: string;
  currentUri?: string | null;
  knownSizes?: number[];
  baseName?: string | null;
}): Promise<ResetOutcome | 'queued'> => {
  const requestedAt = new Date().toISOString();
  const queue = async (): Promise<'queued'> => {
    load();
    const id = `annot-job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    jobs.push({
      id,
      userId: getSessionOwner() || undefined,
      leadId: args.leadId,
      originalUri: '',
      layoutWidth: 0,
      layoutHeight: 0,
      strokes: [],
      texts: [],
      shapes: [],
      categoryName: 'Order Sheet',
      subcategory: 'Order Sheet (Reset)',
      createdAt: requestedAt,
      annotation: {
        mode: 'orderSheetReset',
        orderSheetDocumentId: args.documentId,
        baseName: args.baseName || undefined,
        currentUri: args.currentUri,
        knownSizes: args.knownSizes,
      },
    });
    persist();
    void processAnnotationJobs();
    return 'queued';
  };
  if (!isOnline()) return queue();
  try {
    return await resetAnnotatedOrderSheet({ ...args, occurredAt: requestedAt, queuedOffline: false });
  } catch (e: any) {
    // A real server answer is thrown to the caller; only "never reached the server" is queued.
    if (!isNetworkError(e)) throw e;
    return queue();
  }
};

/** Writes the jobs and starts working through them. Resolves as soon as they are SAVED - not when they are uploaded. */
export const enqueueAnnotationJobs = async (inputs: AnnotationJobInput[]): Promise<number> => {
  load();
  const userId = getSessionOwner() || undefined;
  for (const input of inputs) {
    const id = `annot-job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const originalUri = await makeDurable(id, input.originalUri);
    const annotation =
      input.annotation.mode === 'orderSheet' ? { ...input.annotation, queuedOffline: !isOnline() } : input.annotation;
    jobs.push({ ...input, annotation, originalUri, id, userId, createdAt: new Date().toISOString() });
  }
  persist();
  void processAnnotationJobs();
  return inputs.length;
};

const readBase64 = async (uri: string): Promise<string> => {
  let local = uri;
  if (isRemote(uri)) {
    if (!isOnline()) {
      const err: any = new Error('OFFLINE');
      err.offline = true;
      throw err;
    }
    const cached = await warmToLocalCache(uri);
    if (!cached) throw new Error('Could not download the original photo');
    local = cached;
  }
  const data = await ReactNativeBlobUtil.fs.readFile(toFsPath(local), 'base64');
  return `data:image/jpeg;base64,${data}`;
};

/** Draws the marks over the background and returns a `data:image/jpeg;base64,...` string (shared with the order-sheet editor). */
export const flattenMarks = (input: {
  backgroundBase64: string;
  layoutWidth: number;
  layoutHeight: number;
  strokes: any[];
  texts: any[];
  shapes: any[];
}): Promise<string> =>
  renderAnnotatedImage({
    backgroundImageBase64: input.backgroundBase64,
    layoutWidth: input.layoutWidth,
    layoutHeight: input.layoutHeight,
    strokes: input.strokes.map((s) => ({ isEraser: s.isEraser, color: s.color, width: s.width, points: s.points })),
    texts: input.texts.map((t) => ({
      text: t.text,
      color: t.color,
      fontSize: t.fontSize,
      fontStyle: t.fontStyle,
      opacity: t.opacity,
      px: t.px,
      py: t.py,
    })),
    shapes: input.shapes.map((sh) => ({ kind: sh.kind, color: sh.color, width: sh.width, p1: sh.p1, p2: sh.p2 })),
  });

const processOne = async (job: AnnotationJob): Promise<void> => {
  if (job.annotation.mode === 'orderSheetReset') {
    const rs = job.annotation;
    await resetAnnotatedOrderSheet({
      leadId: job.leadId,
      documentId: rs.orderSheetDocumentId,
      currentUri: rs.currentUri,
      knownSizes: rs.knownSizes,
      baseName: rs.baseName,
      occurredAt: job.createdAt,
      queuedOffline: true,
    });
    return;
  }
  const background = await readBase64(job.originalUri);
  const flattened = await flattenMarks({
    backgroundBase64: background,
    layoutWidth: job.layoutWidth,
    layoutHeight: job.layoutHeight,
    strokes: job.strokes,
    texts: job.texts,
    shapes: job.shapes,
  });

  const flattenedBase64 = flattened.replace(/^data:image\/\w+;base64,/, '');

  if (job.annotation.mode === 'orderSheet') {
    const os = job.annotation;
    await saveAnnotatedOrderSheet({
      leadId: job.leadId,
      documentId: os.orderSheetDocumentId,
      flattenedJpegBase64: flattenedBase64,
      contentKind: os.contentKind,
      mediaBox: os.mediaBox,
      baseName: os.baseName,
      annotationData: os.annotationData,
      staleUris: os.staleUris,
      originalPath: os.originalPath,
      knownSizes: os.knownSizes,
      occurredAt: job.createdAt,
      queuedOffline: os.queuedOffline,
    });
    return;
  }

  const tempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/annotated_${Date.now()}_${job.id}.jpg`;
  await ReactNativeBlobUtil.fs.writeFile(tempPath, flattenedBase64, 'base64');

  // addToQueue copies the file into durable queue storage and starts draining (it waits for a connection itself).
  await uploadQueueManager.addToQueue({
    leadId: job.leadId,
    categoryName: job.categoryName,
    subcategory: job.subcategory,
    uri: `file://${tempPath}`,
    type: 'image/jpeg',
    name: `annotated_${Date.now()}.jpg`,
    coordinates: job.coordinates,
    userId: job.userId,
    annotation: job.annotation as UploadQueueAnnotation,
  });
  await unlinkQuiet(`file://${tempPath}`);
};

export const processAnnotationJobs = async (): Promise<void> => {
  load();
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const job = jobs.find(mine);
      if (!job) break;
      try {
        await processOne(job);
        jobs = jobs.filter((j) => j.id !== job.id);
        persist();
        // ⚠️ NOT deleted yet: the card that showed the marks over this original keeps drawing it until the flattened
        // image has painted, and a missing file would blank it. Removed after a grace period (and by the startup sweep).
        setTimeout(() => void unlinkQuiet(job.originalUri), ORIGINAL_GRACE_MS);
      } catch (e: any) {
        if (e?.offline || !isOnline() || isNetworkError(e)) {
          // Waiting for the original's bytes: resume on reconnect. Not an attempt.
          console.log('[AnnotationJobs] waiting for a connection to fetch the original');
          break;
        }
        const attempts = (job.attempts || 0) + 1;
        console.warn(`[AnnotationJobs] job ${job.id} failed (attempt ${attempts}):`, e?.message || e);
        if (attempts >= MAX_ATTEMPTS) {
          jobs = jobs.filter((j) => j.id !== job.id);
          persist();
          void unlinkQuiet(job.originalUri);
          // An order-sheet failure shows what the SERVER said (`{ message }`), not a generic line.
          FlashMessage.error(
            job.annotation.mode === 'orderSheetReset'
              ? 'Order sheet not reset'
              : job.annotation.mode === 'orderSheet'
                ? 'Order sheet not saved'
                : 'Annotation not saved',
            job.annotation.mode === 'orderSheet' || job.annotation.mode === 'orderSheetReset'
              ? serverErrorText(e, 'The annotated order sheet could not be saved.')
              : 'One annotated photo could not be prepared. Please annotate it again.',
          );
        } else {
          jobs = jobs.map((j) => (j.id === job.id ? { ...j, attempts } : j));
          persist();
          await new Promise<void>((r) => setTimeout(r, 2000 * attempts));
        }
      }
    }
  } finally {
    processing = false;
  }
};

/** Removes originals left behind by jobs that finished (or by a killed app): not referenced by a job and older than a day. */
const sweepOrphanOriginals = async (): Promise<void> => {
  try {
    const fs = ReactNativeBlobUtil.fs;
    const dir = `${fs.dirs.DocumentDir}/${JOB_DIR}`;
    if (!(await fs.exists(dir))) return;
    const keep = new Set(jobs.map((j) => toFsPath(j.originalUri)));
    const stats: any[] = await fs.lstat(dir);
    for (const f of stats || []) {
      const path = String(f.path || `${dir}/${f.filename}`);
      const age = Date.now() - (Number(f.lastModified) || 0);
      if (!keep.has(path) && age > ORPHAN_AGE_MS) await fs.unlink(path).catch(() => {});
    }
  } catch {
    /* best effort */
  }
};

let syncStarted = false;
/** Resumes jobs left by a killed app and re-runs them on reconnect / foreground. Idempotent. */
export const startAnnotationJobSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;
  onReconnect(() => void processAnnotationJobs());
  AppState.addEventListener('change', (next) => {
    if (next === 'active') void processAnnotationJobs();
  });
  void processAnnotationJobs();
  void sweepOrphanOriginals();
};
