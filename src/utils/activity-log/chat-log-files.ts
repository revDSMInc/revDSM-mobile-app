/**
 * chat-log-files.ts — the `meta.files[]` rows a chat activity log carries.
 *
 * Mobile logged only a flattened `fileName` string, so the portal could see THAT a photo was sent
 * but not WHICH object it was — no `filePath`, no bucket, no category. Reported against the web
 * payload, which carries a row per file. This is that mapping.
 *
 * Pure and RN-free so it can be tested: every consumer (`hooks/useChatLogic.ts`) pulls in React
 * Native and cannot be loaded under jest here.
 */

/** The chat default bucket, used when a file ref does not name its own. */
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
  /** Byte size. The server spells it three ways; the pickers use `fileSize` / `size`. */
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
  /** The file's own BYTE size, per row. See `normalizeLogFileSize`. */
  fileSize: number;
}

/**
 * A file's byte size, from whichever key carries it.
 *
 * ⚠️ The server spells it three ways (`size`, `fileSize`, `file_size`) — the same spread
 * `ChatService.normalizeFileSize` already handles for display — and the two pickers use
 * `fileSize` (image picker) and `size` (document picker). Reading only one of them silently
 * logs 0 for the other sources.
 *
 * Returns 0 rather than undefined when genuinely unknown, so the key is always present.
 */
export const normalizeLogFileSize = (file: ChatLogFileInput = {}): number => {
  const raw = file.fileSize ?? file.size ?? file.file_size;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Map file refs to the web log's `meta.files[]` shape.
 *
 * ⚠️ `filePath` must be the S3 OBJECT PATH, never a local `file://` uri and never a signed URL.
 * A signed URL expires within the hour, so logging one files a link that is dead by the time
 * anyone opens the record. For an UPLOAD the path only exists once the server has stored it,
 * which is why those logs fire after the send rather than before it.
 */
export const buildChatLogFiles = (files: ChatLogFileInput[] = []): ChatLogFile[] =>
  (files || []).filter(Boolean).map((f) => ({
    fileName: f.fileName || f.name || '',
    bucketName: f.bucketName || CHAT_LOG_FALLBACK_BUCKET,
    filePath: f.filePath || f.path || '',
    // `type` is LAST: on an optimistic bubble it holds the GiftedChat kind ('image'), not a mime
    // type, so a real `fileType`/`mimeType` must win.
    fileType: f.fileType || f.mimeType || f.type || '',
    // Empty strings rather than omitted keys — web sends both on every row.
    category: f.category || '',
    subcategory: f.subcategory || '',
    fileSize: normalizeLogFileSize(f),
  }));
