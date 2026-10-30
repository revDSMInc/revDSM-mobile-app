import { createRef, useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import { Storage } from '../utils/storage';
import {
  CAMERA_WALKTHROUGH_HIDDEN_KEY,
  CAMERA_WALKTHROUGH_HIDDEN_VALUE,
  buildWalkthroughSteps,
  resolveStepBody,
  shouldShowWalkthroughIntro,
  type WalkthroughFeatures,
  type WalkthroughScreen,
  type WalkthroughStep,
  type WalkthroughTargetId,
} from '../utils/camera-walkthrough';

export type WalkthroughPhase = 'idle' | 'intro' | 'tour';

interface Options {
  /** Off → the controller is inert (`phase` stays `idle`). */
  enabled?: boolean;
  /** Which optional features this build ships (gates the video step). */
  features?: Partial<WalkthroughFeatures>;
  /** Tab labels of the tag screen, for the "Pick the section" copy. */
  tabLabels?: string[];
}

const readHidden = (): boolean => {
  try {
    return !shouldShowWalkthroughIntro(Storage.getItem(CAMERA_WALKTHROUGH_HIDDEN_KEY));
  } catch {
    return false;
  }
};

const writeHidden = () => {
  try {
    Storage.setItem(CAMERA_WALKTHROUGH_HIDDEN_KEY, CAMERA_WALKTHROUGH_HIDDEN_VALUE);
  } catch {
    // Storage is best-effort: the worst case is the intro appearing once more.
  }
};

/**
 * State for the first-run camera walkthrough. The host (the screen that owns the camera AND the tag screen) calls
 * this once, renders `<WalkthroughOverlay controller={…} />` in each of its native trees, hangs `targetRef(id)` on
 * the views to spotlight, and shows the screen named by `screen` while a tour step is current.
 */
export function useCameraWalkthrough({ enabled = true, features, tabLabels = [] }: Options = {}) {
  const [phase, setPhase] = useState<WalkthroughPhase>(() => (enabled && !readHidden() ? 'intro' : 'idle'));
  const [index, setIndex] = useState(0);
  const [sample, setSample] = useState<string | null>(null);

  const video = !!features?.video;
  const steps = useMemo(() => buildWalkthroughSteps({ video }), [video]);
  const step: WalkthroughStep | null = phase === 'tour' ? steps[index] ?? null : null;

  const refs = useRef<Partial<Record<WalkthroughTargetId, RefObject<View | null>>>>({});
  const targetRef = useCallback((id: WalkthroughTargetId): RefObject<View | null> => {
    if (!refs.current[id]) refs.current[id] = createRef<View>();
    return refs.current[id] as RefObject<View | null>;
  }, []);

  const startTour = useCallback(() => {
    setIndex(0);
    setPhase('tour');
  }, []);
  const dismissIntro = useCallback((forever: boolean) => {
    if (forever) writeHidden();
    setPhase('idle');
  }, []);
  const end = useCallback((forever: boolean) => {
    if (forever) writeHidden();
    setPhase('idle');
    setIndex(0);
    setSample(null);
  }, []);
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), [steps.length]);
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  const ctx = useMemo(() => ({ tabLabels }), [tabLabels]);

  return {
    phase,
    active: phase !== 'idle',
    steps,
    step,
    index,
    total: steps.length,
    isLast: index >= steps.length - 1,
    body: step ? resolveStepBody(step, ctx) : '',
    /** The screen the current step lives on, or null outside the tour. */
    screen: (step?.screen ?? null) as WalkthroughScreen | null,
    /** A real frame from the live camera, shown as the example photo on the tag screen. */
    sample,
    setSample,
    targetRef,
    startTour,
    dismissIntro,
    next,
    back,
    end,
  };
}

export type CameraWalkthroughController = ReturnType<typeof useCameraWalkthrough>;
