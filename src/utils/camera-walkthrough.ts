/**
 * Pure rules for the first-run camera walkthrough (Jira 576). No React Native imports so jest can load it.
 *
 * The walkthrough is a flat list of steps. Each step names the SCREEN it lives on (`camera` or `tag`) and the
 * TARGET on that screen it spotlights; the host renders the matching screen while a step is current, so the tour
 * can hop between the live camera and the tag screen. Steps that depend on a feature the app doesn't ship yet
 * (`requires`) are filtered out, which is how the video step stays out until the video module lands.
 */

export type WalkthroughScreen = 'camera' | 'tag';
export type WalkthroughTargetId = 'shutter' | 'tabs' | 'slots' | 'timer' | 'modes';
export type WalkthroughShape = 'rounded' | 'circle';
export type WalkthroughFeature = 'video';

export interface WalkthroughContext {
  /** Labels of the tag screen's top tabs, in display order (schema-driven, so never hardcoded). */
  tabLabels: string[];
}

export interface WalkthroughStep {
  id: string;
  screen: WalkthroughScreen;
  target: WalkthroughTargetId;
  shape: WalkthroughShape;
  title: string;
  body: string | ((ctx: WalkthroughContext) => string);
  requires?: WalkthroughFeature;
}

export interface WalkthroughFeatures {
  video: boolean;
}

/** Bump the suffix to show the intro again to everyone (e.g. after the tour's content changes materially). */
export const CAMERA_WALKTHROUGH_HIDDEN_KEY = 'revdsm_camera_walkthrough_hidden_v1';
export const CAMERA_WALKTHROUGH_HIDDEN_VALUE = '1';

export const shouldShowWalkthroughIntro = (storedFlag: string | null | undefined): boolean =>
  String(storedFlag ?? '') !== CAMERA_WALKTHROUGH_HIDDEN_VALUE;

/** ['Home'] → "Home"; ['Home','Measure'] → "Home and Measure"; 3+ → "Home, Inspection and Misc". */
export const joinLabels = (labels: string[]): string => {
  const clean = labels.map((l) => String(l ?? '').trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
};

export const CAMERA_WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'take-and-tag',
    screen: 'camera',
    target: 'shutter',
    shape: 'circle',
    title: 'Take it, then tag it',
    body: 'Tap the capture button like normal. Right after each shot, you tag it.',
  },
  {
    id: 'pick-section',
    screen: 'tag',
    target: 'tabs',
    shape: 'rounded',
    title: 'Pick the section',
    body: ({ tabLabels }) => {
      const names = joinLabels(tabLabels);
      return names
        ? `Use the tabs at the top to switch between ${names}. Each section has its own spots to tag.`
        : 'Use the tabs at the top to switch sections. Each section has its own spots to tag.';
    },
  },
  {
    id: 'pick-spot',
    screen: 'tag',
    target: 'slots',
    shape: 'rounded',
    title: 'Pick where it goes',
    body: 'Then tap the spot that matches the photo, or tap Tag as Extra. Every photo gets tagged this way.',
  },
  {
    id: 'timer',
    screen: 'camera',
    target: 'timer',
    shape: 'circle',
    title: "Can't reach the capture button?",
    body: "Phone on an extension pole, or up a ladder where you can't reach the capture button? Tap the clock at the top and set the timer. The camera takes the photo for you when it runs out.",
  },
  {
    id: 'video',
    screen: 'camera',
    target: 'modes',
    shape: 'rounded',
    requires: 'video',
    title: 'Or record, then pick the shot',
    body: 'Same situation, another way: pole or ladder, no hand on the capture button. Switch to Video, start recording, move the phone into position, then stop. Drag the slider to the sharpest frame and save it as a photo. Each frame gets tagged. The video is not kept.',
  },
];

export const buildWalkthroughSteps = (
  features: WalkthroughFeatures,
  steps: WalkthroughStep[] = CAMERA_WALKTHROUGH_STEPS,
): WalkthroughStep[] => steps.filter((s) => !s.requires || features[s.requires]);

export const resolveStepBody = (step: WalkthroughStep, ctx: WalkthroughContext): string =>
  typeof step.body === 'function' ? step.body(ctx) : step.body;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Grow a measured target by `pad` on every side, then clip it to the overlay so a tall target (a long slot grid) can't leave the screen. */
export const padAndClampRect = (rect: Rect, pad: number, bounds: { width: number; height: number }): Rect | null => {
  const x1 = Math.max(0, rect.x - pad);
  const y1 = Math.max(0, rect.y - pad);
  const x2 = Math.min(bounds.width, rect.x + rect.width + pad);
  const y2 = Math.min(bounds.height, rect.y + rect.height + pad);
  if (x2 - x1 <= 0 || y2 - y1 <= 0) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

export type TipPlacement = { top: number } | { bottom: number };

/**
 * Where the tip card goes. Below the spotlight when it fits, else above, else pinned to the bottom edge
 * (a spotlight that fills the screen). With no spotlight the card sits at ~30% down, as a centred message.
 */
export const placeTip = (
  spot: Rect | null,
  cardHeight: number,
  bounds: { width: number; height: number },
  insets: { top: number; bottom: number },
  gap = 20,
): TipPlacement => {
  const minTop = insets.top + 8;
  const maxBottom = bounds.height - insets.bottom - 8;
  if (!spot) return { top: Math.max(minTop, bounds.height * 0.3) };
  const below = spot.y + spot.height + gap;
  if (below + cardHeight <= maxBottom) return { top: below };
  const aboveBottom = spot.y - gap;
  if (aboveBottom - cardHeight >= minTop) return { bottom: bounds.height - aboveBottom };
  return { bottom: insets.bottom + 24 };
};
