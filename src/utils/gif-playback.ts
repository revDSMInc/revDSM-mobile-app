// Pure helpers for the chat GIF "play twice, then freeze under a GIF badge" behaviour. No React Native imports, so
// they are unit-testable. React Native cannot pause an animated <Image>, so the bubble measures the animation's length
// from the file itself and swaps to a still frame when two plays have elapsed.

export const GIF_PLAYS_BEFORE_FREEZE = 2;
const DEFAULT_LOOP_MS = 3000;
const MIN_FREEZE_MS = 1000;
const MAX_FREEZE_MS = 60_000;

/** Length of ONE play of a GIF in ms (frame delays summed). null = not an animated GIF / unreadable. */
export const parseGifDurationMs = (b: Uint8Array): number | null => {
  if (b.length < 14 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  let totalCs = 0;
  let frames = 0;
  const skipSubBlocks = () => {
    while (p < b.length && b[p] !== 0) p += b[p] + 1;
    p += 1;
  };
  while (p < b.length) {
    const t = b[p];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p + 1];
      if (label === 0xf9 && b[p + 2] === 4) {
        const cs = b[p + 4] | (b[p + 5] << 8);
        totalCs += cs <= 1 ? 10 : cs; // browsers treat 0/1 cs as 10 cs
      }
      p += 2;
      skipSubBlocks();
    } else if (t === 0x2c) {
      frames += 1;
      const flags = b[p + 9];
      p += 10;
      if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
      p += 1; // LZW min code size
      skipSubBlocks();
    } else {
      return null; // corrupt
    }
  }
  return frames > 1 && totalCs > 0 ? totalCs * 10 : null;
};

/** Length of one play of an animated WebP in ms (ANMF frame durations summed). */
export const parseWebpDurationMs = (b: Uint8Array): number | null => {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  let p = 12;
  let total = 0;
  let frames = 0;
  while (p + 8 <= b.length) {
    const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    if (tag(p) === 'ANMF' && p + 8 + 15 <= b.length) {
      total += b[p + 8 + 12] | (b[p + 8 + 13] << 8) | (b[p + 8 + 14] << 16);
      frames += 1;
    }
    p += 8 + size + (size & 1);
  }
  return frames > 1 && total > 0 ? total : null;
};

export const parseAnimationDurationMs = (b: Uint8Array): number | null =>
  parseGifDurationMs(b) ?? parseWebpDurationMs(b);

/** How long the bubble animates before freezing: two plays, bounded so a tiny or huge file still behaves. */
export const freezeAfterMs = (loopMs: number | null | undefined): number =>
  Math.min(MAX_FREEZE_MS, Math.max(MIN_FREEZE_MS, (loopMs && loopMs > 0 ? loopMs : DEFAULT_LOOP_MS) * GIF_PLAYS_BEFORE_FREEZE));

/**
 * GIPHY serves a one-frame still of every rendition at the same path with `_s` before the extension
 * (`giphy-downsized.gif` -> `giphy-downsized_s.gif`). null when the url has no such convention.
 */
export const gifStillUrl = (url: string): string | null => {
  const m = url.trim().match(/^(https:\/\/media\d*\.giphy\.com\/.+?)(_s)?\.(?:gif|webp)(\?.*)?$/i);
  return m && !m[2] ? `${m[1]}_s.gif` : null;
};
