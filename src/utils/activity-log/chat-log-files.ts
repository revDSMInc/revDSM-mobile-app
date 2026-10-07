export const CHAT_LOG_FALLBACK_BUCKET = 'np-revdsm-staging';

export interface ChatLogFileInput {
  fileName?: string;
  name?: string;
  bucketName?: string;
  filePath?: string;
  path?: string;
  fileType?: string;
  mimeType?: string;
  type?: string;
  category?: string;
  subcategory?: string;
  fileSize?: number | string;
  size?: number | string;
  file_size?: number | string;
}

export interface ChatLogFile {
  fileName: string;
  bucketName: string;
  filePath: string;
  fileType: string;
  category: string;
  subcategory: string;
  fileSize: number;
}

export const normalizeLogFileSize = (file: ChatLogFileInput = {}): number => {
  const raw = file.fileSize ?? file.size ?? file.file_size;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const buildChatLogFiles = (files: ChatLogFileInput[] = []): ChatLogFile[] =>
  (files || []).filter(Boolean).map((f) => ({
    fileName: f.fileName || f.name || '',
    bucketName: f.bucketName || CHAT_LOG_FALLBACK_BUCKET,
    filePath: f.filePath || f.path || '',
    fileType: f.fileType || f.mimeType || f.type || '',
    category: f.category || '',
    subcategory: f.subcategory || '',
    fileSize: normalizeLogFileSize(f),
  }));
