export const clampZoomScale = (next: number, maxScale: number): number => {
  'worklet';
  return Math.min(Math.max(next, 1), maxScale);
};

export const panBound = (boxSize: number, scale: number): number => {
  'worklet';
  return (boxSize * (Math.max(scale, 1) - 1)) / 2;
};

export const zoomOrigin = (focal: number, translate: number, scale: number): number => {
  'worklet';
  return (focal - translate) / (scale || 1);
};

export const anchoredTranslate = (
  focal: number,
  origin: number,
  scale: number,
  boxSize: number,
): number => {
  'worklet';
  const bound = panBound(boxSize, scale);
  return Math.min(Math.max(focal - origin * scale, -bound), bound);
};

export const doubleTapTranslate = (focal: number, scale: number, boxSize: number): number => {
  'worklet';
  return anchoredTranslate(focal, focal, scale, boxSize);
};

export const clampPan = (
  savedTranslate: number,
  delta: number,
  scale: number,
  boxSize: number,
): number => {
  'worklet';
  const bound = panBound(boxSize, scale);
  return Math.min(Math.max(savedTranslate + delta, -bound), bound);
};

export const TAP_MAX_DISTANCE = 10;

export const SWIPE_ACTIVATE_DISTANCE = 15;
