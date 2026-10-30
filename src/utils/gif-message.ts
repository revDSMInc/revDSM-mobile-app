// A GIF is sent as a plain text message whose whole body is a GIPHY media URL. The backend now fetches that
// URL on send and keeps the bytes in S3 like a photo, so what comes back is a captionless message carrying
// one GIF attachment — `isGifFileMessage`. `isGifMessageText` is what every message stored before that still
// looks like (the GIPHY URL as the body), and is also how this app's own optimistic bubble starts out.

const GIPHY_MEDIA_URL = /^https:\/\/(?:media\d*|i)\.giphy\.com\/\S+\.(?:gif|webp)(?:\?\S*)?$/i;

export const GIF_REPLY_LABEL = 'GIF';

export const isGifMessageText = (text?: string | null): boolean =>
  !!text && GIPHY_MEDIA_URL.test(text.trim());

/**
 * A GIF attachment. ⚠️ A WebP counts only under the server's `…/gifs/` key: a GIPHY WebP rendition
 * is animated, but so is the extension on any still photo, and a photo must keep the photo bubble.
 */
export const isGifFile = (file?: any): boolean => {
  const type = String(
    file?.type || file?.mimeType || file?.fileType || file?.contentType || ''
  ).toLowerCase();
  const name = String(file?.filePath || file?.name || file?.fileName || '');
  if (type === 'image/gif') return true;
  if (type === 'image/webp') return /\/gifs\//.test(name);
  return /\.gif(\?|$)/i.test(name);
};

/** A stored GIF message: no words of its own, and its one attachment is the GIF. */
export const isGifFileMessage = (msg?: any): boolean => {
  const files = msg?.files || [];
  if (files.length !== 1 || !isGifFile(files[0])) return false;
  return !String(msg?.text || msg?.message || '').trim();
};

// Width / height of a GIF from its pixel size; falls back to square so a bubble never collapses or explodes.
export const gifAspectRatio = (width?: number, height?: number): number => {
  if (!width || !height || width <= 0 || height <= 0) return 1;
  return Math.min(Math.max(width / height, 0.5), 2.5);
};
