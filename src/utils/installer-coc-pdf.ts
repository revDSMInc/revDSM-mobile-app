/**
 * Certificate of Completion — the signed PDF the server generates.
 *
 * Submitting the certificate (`PATCH installer/v1/update/{jobId}` with `stepData.coc`)
 * answers with the generated document, and the CoC step shows THAT from then on: a
 * submitted certificate is a filed document, not a form to re-open.
 *
 * ⚠️ Pure, with a type-only import and nothing else — `services/api/installer.ts` pulls
 * in the axios wrapper (and MMKV through it) and cannot be loaded under jest here, which
 * is the same reason `utils/installer-coc-scan.ts` exists.
 *
 * ⚠️ **Nothing is guessed.** Keys and containers are FIXED lists, the discipline
 * `readDocumentGroup` sets: an unrecognised payload yields `null` and the step falls
 * back to the certificate card it drew before, rather than pointing a PDF viewer at
 * whatever string happened to be nearby.
 */

import type { JobPacket } from '../config/types/installer';

/**
 * Where the certificate's document can sit.
 *
 * `coc`-scoped containers are listed separately below, because the GENERIC key names
 * (`pdf`, `document`, `url`) may only be read inside one — see `GENERIC_KEYS`.
 */
const CONTAINERS = ['data', 'job', 'stepData', 'result'];
const COC_CONTAINERS = ['coc', 'cocDocument', 'cocPdf', 'certificate', 'certificateOfCompletion'];

/**
 * Names that identify the certificate outright, readable anywhere.
 *
 * ⚠️ `submissionPdf` is deliberately ABSENT and must stay that way: that is the REP's
 * job packet (`normalizeSubmissionPdf` → `job.packet`), a different document on the same
 * job, and showing it as the signed certificate would be a plausible-looking lie.
 */
const COC_KEYS = [
  'cocPdf',
  'cocDocument',
  'cocCertificatePdf',
  'cocSignedPdf',
  'certificatePdf',
  'signedCertificatePdf',
  'completionCertificatePdf',
];

/** Read ONLY from a `coc`-scoped container — see `COC_CONTAINERS`. */
const GENERIC_KEYS = ['pdf', 'document', 'pdfUrl', 'documentUrl', 'signedPdf', 'url', 's3url'];

const MAX_DEPTH = 4;
const MAX_NODES = 40;

const isPlainObject = (value: any): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: any): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

interface Node {
  node: any;
  /** True when this object was reached through a `coc`-shaped key. */
  cocScoped: boolean;
}

const collect = (body: any): Node[] => {
  if (!isPlainObject(body)) return [];

  const out: Node[] = [];
  const queue: { node: any; depth: number; cocScoped: boolean }[] = [
    { node: body, depth: 0, cocScoped: false },
  ];
  const seen = new Set<any>([body]);

  while (queue.length > 0 && out.length < MAX_NODES) {
    const current = queue.shift()!;
    out.push({ node: current.node, cocScoped: current.cocScoped });
    if (current.depth >= MAX_DEPTH) continue;

    [...CONTAINERS, ...COC_CONTAINERS].forEach((key) => {
      const child = current.node[key];
      if (isPlainObject(child) && !seen.has(child)) {
        seen.add(child);
        queue.push({
          node: child,
          depth: current.depth + 1,
          // Scope is INHERITED: once inside `coc`, a nested `document` block is still
          // the certificate's.
          cocScoped: current.cocScoped || COC_CONTAINERS.includes(key),
        });
      }
    });
  }

  return out;
};

/**
 * One candidate value — a url string, or the `{ url, bucketName }` shape the rest of
 * this API uses — as something `resolvePacketUrl` can open.
 *
 * ⚠️ A bare `url` is only treated as ready-to-open when it looks like one. This API
 * routinely puts a bucket-RELATIVE key in a field called `url` (`submissionPdf.url`),
 * and handing that to a PDF viewer produces a blank sheet rather than an error.
 */
const toPacket = (value: any, fallbackName: string): JobPacket | null => {
  const direct = text(value);
  if (direct) {
    return /^https?:\/\//i.test(direct)
      ? { fileName: fallbackName, fileUrl: direct }
      : { fileName: direct.split('/').pop() || fallbackName, s3url: direct };
  }

  if (!isPlainObject(value)) return null;

  const ready = text(value.fileUrl) || text(value.secureUrl) || text(value.signedUrl);
  const key =
    text(value.s3url) || text(value.filePath) || text(value.key) || text(value.path);
  // `url` is either, so it is classified rather than assumed.
  const url = text(value.url);
  const readyUrl = ready || (url && /^https?:\/\//i.test(url) ? url : undefined);
  const s3url = key || (url && !/^https?:\/\//i.test(url) ? url : undefined);

  if (!readyUrl && !s3url) return null;

  return {
    fileName:
      text(value.fileName) ||
      text(value.name) ||
      (s3url || readyUrl || '').split('?')[0].split('/').pop() ||
      fallbackName,
    ...(readyUrl ? { fileUrl: readyUrl } : {}),
    ...(s3url ? { s3url } : {}),
    bucketName: text(value.bucketName) || text(value.bucket),
  };
};

/**
 * The signed certificate out of a job or a step-data response, or `null` when it holds
 * none — which is every job whose certificate has not been submitted, and any
 * deployment that does not generate one yet. The step then behaves exactly as it did
 * before this existed.
 */
export const extractCocPdf = (raw: any, fallbackName = 'Certificate_of_Completion.pdf'): JobPacket | null => {
  const nodes = collect(raw);

  // Named keys first, wherever they sit: they say what the document IS.
  for (const { node } of nodes) {
    for (const key of COC_KEYS) {
      if (!(key in node)) continue;
      const packet = toPacket(node[key], fallbackName);
      if (packet) return packet;
    }
  }

  // Then the generic names, but only inside a `coc` container.
  for (const { node, cocScoped } of nodes) {
    if (!cocScoped) continue;
    for (const key of GENERIC_KEYS) {
      if (!(key in node)) continue;
      const packet = toPacket(node[key], fallbackName);
      if (packet) return packet;
    }
  }

  return null;
};
