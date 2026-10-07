import type { JobPacket } from '../config/types/installer';

const CONTAINERS = ['data', 'job', 'stepData', 'result'];
const COC_CONTAINERS = ['coc', 'cocDocument', 'cocPdf', 'certificate', 'certificateOfCompletion'];

const COC_KEYS = [
  'cocPdf',
  'cocDocument',
  'cocCertificatePdf',
  'cocSignedPdf',
  'certificatePdf',
  'signedCertificatePdf',
  'completionCertificatePdf',
];

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
          cocScoped: current.cocScoped || COC_CONTAINERS.includes(key),
        });
      }
    });
  }

  return out;
};

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

export const extractCocPdf = (raw: any, fallbackName = 'Certificate_of_Completion.pdf'): JobPacket | null => {
  const nodes = collect(raw);

  for (const { node } of nodes) {
    for (const key of COC_KEYS) {
      if (!(key in node)) continue;
      const packet = toPacket(node[key], fallbackName);
      if (packet) return packet;
    }
  }

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
