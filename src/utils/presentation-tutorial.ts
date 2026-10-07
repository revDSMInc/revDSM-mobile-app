export const PRESENTATION_TUTORIAL_SEEN_KEY = 'pitchbook-gesture-tutorial-v1';

export const shouldShowPresentationTutorial = (storedFlag: string | null | undefined): boolean =>
  String(storedFlag ?? '') !== '1';

export const PRESENTATION_TUTORIAL_SEEN_VALUE = '1';

export const MIN_SWIPE_DISTANCE = 40;

export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < MIN_SWIPE_DISTANCE) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

export const CHROME_AUTO_HIDE_MS = 3000;
