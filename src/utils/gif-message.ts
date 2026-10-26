// A GIF chat message is a plain text message whose whole body is a GIPHY media URL — the backend has no
// GIF message type, so web (and old app builds) simply show the link, while this app renders it inline.

const GIPHY_MEDIA_URL = /^https:\/\/(?:media\d*|i)\.giphy\.com\/\S+\.(?:gif|webp)(?:\?\S*)?$/i;

export const GIF_REPLY_LABEL = 'GIF';

export const isGifMessageText = (text?: string | null): boolean =>
  !!text && GIPHY_MEDIA_URL.test(text.trim());

// Width / height of a GIF from its pixel size; falls back to square so a bubble never collapses or explodes.
export const gifAspectRatio = (width?: number, height?: number): number => {
  if (!width || !height || width <= 0 || height <= 0) return 1;
  return Math.min(Math.max(width / height, 0.5), 2.5);
};
