/**
 * Which image a render is allowed to be sent for.
 *
 * ⚠️ WHY THIS EXISTS - "Failed to download house image", 60 of 98 render jobs in 24h.
 *
 * The backend accepts `houseImageUrl` as either a full http(s) URL or a bare S3 key: anything
 * that is not http(s) is PRESIGNED AS A KEY against our bucket. So a device path is not
 * rejected, it is silently turned into a key that cannot exist, the fetch 404s, and the job
 * dies before the model is called.
 *
 * Two things combined to send one:
 *
 *   1. `item.photo?.s3url || item.photo?.uri` - a photo still in `pending_uploads` has
 *      `s3url: ''` (utils/uploadQueue.ts), so this fell through to the LOCAL file:// path.
 *   2. The old `extractS3Key` matched `^https?://host/(.+)` and, with no else branch,
 *      `return url` - handing that local path onward unchanged as if it were a key.
 *
 * Offline is the normal case for this app, so (1) is not an edge case: photograph a house at a
 * door with no signal and every render queued before the upload drains was guaranteed to fail.
 *
 * ⚠️ This is a VALIDATION rule, not a formatting helper. `extractS3Key` returning `null` is a
 * refusal to send - callers must stop, not substitute a fallback. Passing a bad value through
 * is the whole bug.
 *
 * Pure (no React Native imports) so it can be tested: both call sites are screens that cannot
 * be loaded under jest (CLAUDE.md section 6).
 */

/** Schemes that name a file on THIS DEVICE. None of them mean anything to the server. */
const LOCAL_SCHEMES = ['file:', 'content:', 'ph:', 'assets-library:', 'data:'];

/** Directories the upload queue owns. A path inside one has not been uploaded yet. */
const PENDING_DIRS = ['pending_uploads', 'upload_queue'];

/**
 * Is this a path on the device rather than something the server can fetch?
 *
 * ⚠️ Checked BEFORE the http(s) test, and separately from it. A value can be local without
 * carrying a scheme at all - a bare `/var/mobile/.../x.jpg` is just as unusable.
 */
export const isLocalImagePath = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const v = String(value).trim();
  const lower = v.toLowerCase();
  if (LOCAL_SCHEMES.some((s) => lower.startsWith(s))) return true;
  if (PENDING_DIRS.some((d) => lower.includes(d))) return true;
  // An absolute POSIX path is a device path; an S3 key is relative (`company/123/photo.jpg`).
  if (v.startsWith('/')) return true;
  return false;
};

/**
 * The S3 key for a render payload, or `null` when the value must not be sent.
 *
 * Accepts a full http(s) URL (the key is the path) or a bare key, which is passed through.
 * Returns `null` for empty input, for a device path, and for anything else unrecognisable.
 *
 * ⚠️ `null` is not "use the original". It means NO REQUEST. Every caller must treat it as a
 * blocked submit and tell the rep why - see `renderImageBlockReason`.
 */
export const extractS3Key = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;

  if (isLocalImagePath(raw)) return null;

  const match = raw.match(/^https?:\/\/[^/]+\/(.+)/);
  if (match && match[1]) {
    // ⚠️ Drop the query: a PRESIGNED url carries the signature after `?`, and that is not
    // part of the key. Sending it re-presigns an already-signed path and 404s.
    const key = match[1].split('?')[0];
    return key || null;
  }

  // Some other scheme (http(s) already handled above) is not a key we can use.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  return raw;
};

export type RenderBlockReason = 'uploading' | 'missing';

/**
 * Why this photo cannot be rendered yet, or `null` when it can.
 *
 * Split from `extractS3Key` because the two refusals need DIFFERENT words: a photo that is
 * still uploading will become renderable on its own and the rep just has to wait, while one
 * with no source at all is broken and waiting will not help.
 */
export const renderImageBlockReason = (photo: any): RenderBlockReason | null => {
  const s3url = photo?.s3url;
  if (s3url && extractS3Key(s3url)) return null;

  const uri = photo?.uri || photo?.filePath || photo?.path;
  if (uri && isLocalImagePath(uri)) return 'uploading';
  if (!s3url && !uri) return 'missing';
  return extractS3Key(uri) ? null : 'missing';
};

/** The sentence shown to the rep for each reason. */
export const RENDER_BLOCK_MESSAGE: Record<RenderBlockReason, string> = {
  uploading: "This photo is still uploading. It will be ready to render once the upload finishes.",
  missing: "This photo has no uploaded copy on the server, so it cannot be rendered.",
};

/**
 * The render-queue entries that cannot be submitted, with the reason for each.
 * An empty array means every queued render is safe to send.
 */
export const blockedRenderItems = <T extends { photo?: any; viewLabel?: string }>(
  queue: readonly T[]
): { item: T; reason: RenderBlockReason }[] =>
  queue
    .map((item) => {
      const reason = renderImageBlockReason(item?.photo);
      return reason ? { item, reason } : null;
    })
    .filter((x): x is { item: T; reason: RenderBlockReason } => x !== null);
