/**
 * Flattens an annotated photo (photo + ink + shapes + text -> JPEG base64) in a hidden WebView.
 *
 * The WebView lives in an APP-ROOT host (`widgets/common/AnnotationRenderHost.tsx`), not in the annotation screen, so
 * a rep can tap Save and leave: the render finishes in the background (`annotationSaveService`). Renders are run one at
 * a time - one WebView, one canvas - and each is matched to its answer by a request id echoed through `imageIndex`.
 */

export interface RenderInput {
  backgroundImageBase64: string;
  layoutWidth: number;
  layoutHeight: number;
  strokes: any[];
  texts: any[];
  shapes: any[];
}

interface Pending {
  resolve: (base64: string) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const HOST_READY_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 90_000;

let post: ((json: string) => void) | null = null;
let ready = false;
let readyWaiters: Array<() => void> = [];
let nextId = 1;
let chain: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Pending>();

export const registerRenderHost = (postMessage: (json: string) => void): (() => void) => {
  post = postMessage;
  return () => {
    if (post === postMessage) {
      post = null;
      ready = false;
    }
  };
};

export const markRenderHostReady = (): void => {
  ready = true;
  const waiters = readyWaiters;
  readyWaiters = [];
  waiters.forEach((w) => w());
};

export const markRenderHostReloading = (): void => {
  ready = false;
};

export const handleRenderHostMessage = (raw: string): void => {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const key = String(data?.imageIndex);
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  clearTimeout(entry.timer);
  if (data.status === 'success' && typeof data.base64 === 'string') entry.resolve(data.base64);
  else entry.reject(new Error(data?.message || 'Render failed'));
};

const waitUntilReady = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ready && post) return resolve();
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w !== onReady);
      reject(new Error('Annotation renderer is not available'));
    }, HOST_READY_TIMEOUT_MS);
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    readyWaiters.push(onReady);
  });

const renderOne = async (input: RenderInput): Promise<string> => {
  await waitUntilReady();
  const id = `r${nextId++}`;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Render timed out'));
    }, RENDER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    post!(JSON.stringify({ ...input, imageIndex: id }));
  });
};

/** Resolves with a `data:image/jpeg;base64,...` string. Serialised: concurrent calls queue behind each other. */
export const renderAnnotatedImage = (input: RenderInput): Promise<string> => {
  const run = chain.then(() => renderOne(input));
  chain = run.catch(() => undefined);
  return run;
};
