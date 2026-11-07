/** Recording clock for the camera's video mode: 0 -> "0:00", 75 -> "1:15". */
export const formatRecordingTime = (totalSeconds: number): string => {
  const t = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * How many frames from this clip are already tagged to a slot. They are not uploaded until the
 * picker's Done, so `capture.getPhotos` cannot see them: the slot needs this count to show a badge.
 */
export const countQueuedFrames = (
  queued: ReadonlyArray<{ target: unknown }> | null | undefined,
  key: string,
): number =>
  (queued || []).filter((q) => {
    const t = q?.target as { kind?: string; key?: string } | null | undefined;
    return t?.kind === 'slot' && t.key === key;
  }).length;

/**
 * One tile of the review grid in PIXELS: two columns of the mockup's 804:948 frame.
 *
 * ⚠️ Explicit pixels, not `width: '48.5%'` + `aspectRatio`. That pair rendered NOTHING on a device
 * ("2 Photos Added" over an empty screen, with not even the tag label showing), while the tray used
 * the same uri at a fixed size and drew it fine.
 */
export const reviewTileSize = (
  windowWidth: number,
  gutter = 24,
  gap = 8,
): { width: number; height: number } => {
  const width = Math.max(1, Math.floor((windowWidth - gutter * 2 - gap) / 2));
  return { width, height: Math.round((width * 948) / 804) };
};

/** The frame picker scrubs in whole frames: 30 fps is what the phone records at. */
export const FRAME_PICKER_FPS = 30;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Snap a scrub position (seconds) to a whole frame, kept inside the clip: (0.51, 6) -> 0.5. */
export const snapFrameTime = (seconds: number, duration: number, fps = FRAME_PICKER_FPS): number => {
  const step = 1 / fps;
  const last = Math.max(0, Math.floor((Math.max(duration, step) - 0.001) / step) * step);
  const raw = Number.isFinite(seconds) ? seconds : 0;
  return Math.min(last, Math.max(0, Math.round(raw / step) * step));
};

/** Fraction of the bar (0..1) for a touch at `pageX`, given the bar's left edge and width. */
export const scrubFraction = (pageX: number, barLeft: number, barWidth: number): number =>
  Math.min(1, Math.max(0, (pageX - barLeft) / Math.max(1, barWidth)));

/** Scrubber clock: 1 -> "00:01.00", 75.25 -> "01:15.25". */
export const formatScrubTime = (seconds: number): string => {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}.${pad2(Math.floor((t % 1) * 100))}`;
};

/** Clip length label: 6 -> "00:06". */
export const formatClipLength = (seconds: number): string => {
  const t = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
};
