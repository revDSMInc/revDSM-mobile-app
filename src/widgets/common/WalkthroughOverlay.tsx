import React, { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CameraWalkthroughController } from '../../hooks/useCameraWalkthrough';
import { padAndClampRect, placeTip, type Rect } from '../../utils/camera-walkthrough';

const YELLOW = '#FFD607';
const DIM = 'rgba(0,0,0,0.76)';
const SPOT_PAD = 10;
// Re-measure a few times after a step change: the target may live on a screen that is still laying out.
const MEASURE_DELAYS_MS = [0, 120, 400];

interface Props {
  controller: CameraWalkthroughController;
}

/**
 * Renders the walkthrough's first-run popup and its spotlight tour. It is a plain absolutely-positioned view,
 * NOT a Modal: a Modal is its own native tree and would cover (and not measure against) the views it spotlights.
 * Mount one inside every native tree that hosts a target, as the last child so it paints on top.
 * While it is showing it swallows every touch, so the spotlit control cannot be pressed by accident.
 */
export function WalkthroughOverlay({ controller }: Props) {
  const { phase, step } = controller;
  const insets = useSafeAreaInsets();
  const rootRef = useRef<View>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [spot, setSpot] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(220);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
    setSize({ width, height });
  };

  const targetRef = step ? controller.targetRef(step.target) : null;
  useEffect(() => {
    setSpot(null);
    if (!step || !targetRef) return undefined;
    let cancelled = false;
    const measure = () => {
      const target = targetRef.current;
      const root = rootRef.current;
      if (!target || !root) return;
      // measureInWindow on both, then subtract: stays correct whatever the Modal / status-bar offset is.
      root.measureInWindow((rx, ry) => {
        target.measureInWindow((x, y, width, height) => {
          if (cancelled || !width || !height) return;
          const bounds = sizeRef.current;
          if (!bounds.width || !bounds.height) return;
          let rect: Rect = { x: x - rx, y: y - ry, width, height };
          if (step.shape === 'circle') {
            const side = Math.max(width, height);
            rect = { x: rect.x + (width - side) / 2, y: rect.y + (height - side) / 2, width: side, height: side };
          }
          setSpot(padAndClampRect(rect, SPOT_PAD, bounds));
        });
      });
    };
    const timers = MEASURE_DELAYS_MS.map((ms) => setTimeout(measure, ms));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // `size` re-runs the measure after the overlay's own first layout (rotation / iPad split too).
  }, [step, targetRef, size.width, size.height]);

  if (phase === 'idle') return null;

  if (phase === 'intro') {
    return (
      <View style={[styles.root, styles.introDim]} onStartShouldSetResponder={() => true} pointerEvents="auto">
        <View style={styles.introCard}>
          <Text style={styles.eyebrow}>CAMERA</Text>
          <Text style={styles.introTitle}>Want a quick walkthrough?</Text>
          <Text style={styles.introBody}>
            See how photo tagging, the timer and video capture work. It takes about 30 seconds.
          </Text>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={controller.startTour} accessibilityRole="button">
            <Text style={[styles.btnText, styles.btnTextOnPrimary]}>Show me the walkthrough</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => controller.dismissIntro(false)} accessibilityRole="button">
            <Text style={styles.btnText}>Never mind</Text>
          </Pressable>
          <Pressable style={styles.linkBtn} onPress={() => controller.dismissIntro(true)} accessibilityRole="button">
            <Text style={styles.linkText}>Don't show again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!step) return null;

  const radius = spot ? (step.shape === 'circle' ? Math.min(spot.width, spot.height) / 2 : 16) : 0;
  // A borderWidth this large turns one view into "dim everywhere except a rounded hole".
  const reach = Math.max(size.width, size.height);
  const placement = placeTip(
    spot,
    cardHeight,
    size,
    { top: Math.max(insets.top, 24), bottom: Math.max(insets.bottom, 16) },
  );
  const last = controller.isLast;

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={styles.root}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
    >
      {spot ? (
        <>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: spot.x - reach,
              top: spot.y - reach,
              width: spot.width + reach * 2,
              height: spot.height + reach * 2,
              borderWidth: reach,
              borderColor: DIM,
              borderRadius: radius + reach,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: spot.x,
              top: spot.y,
              width: spot.width,
              height: spot.height,
              borderWidth: 3,
              borderColor: YELLOW,
              borderRadius: radius,
            }}
          />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />
      )}

      <View style={[styles.tipWrap, placement]} pointerEvents="box-none">
        <View style={styles.tip} onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
          <View style={styles.tipHead}>
            <Text style={styles.tipCount}>{`${controller.index + 1} OF ${controller.total}`}</Text>
            {!last && (
              <Pressable hitSlop={12} onPress={() => controller.end(false)} accessibilityRole="button">
                <Text style={styles.tipSkip}>Skip</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.tipTitle}>{step.title}</Text>
          <Text style={styles.tipBody}>{controller.body}</Text>

          {last ? (
            <>
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => controller.end(false)} accessibilityRole="button">
                <Text style={[styles.btnText, styles.btnTextOnPrimary]}>Got it</Text>
              </Pressable>
              <Pressable style={styles.btn} onPress={() => controller.end(true)} accessibilityRole="button">
                <Text style={styles.btnText}>Got it, don't show again</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.row}>
              {controller.index > 0 && (
                <Pressable style={[styles.btn, styles.flex]} onPress={controller.back} accessibilityRole="button">
                  <Text style={styles.btnText}>Back</Text>
                </Pressable>
              )}
              <Pressable style={[styles.btn, styles.btnPrimary, styles.flex]} onPress={controller.next} accessibilityRole="button">
                <Text style={[styles.btnText, styles.btnTextOnPrimary]}>Next</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // zIndex + elevation: the camera view it sits over is itself `zIndex: 9999`.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 10000, elevation: 100, overflow: 'hidden' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },

  introDim: { backgroundColor: 'rgba(0,0,0,0.66)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  introCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 24,
    padding: 24,
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  eyebrow: { color: YELLOW, fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  introTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginTop: 6, marginBottom: 8 },
  introBody: { color: '#C7C7CC', fontSize: 16, lineHeight: 23, marginBottom: 18 },

  tipWrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24, alignItems: 'center' },
  tip: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 24,
    padding: 22,
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  tipHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 20 },
  tipCount: { color: '#98989D', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  tipSkip: { color: '#D1D1D6', fontSize: 16, fontWeight: '500' },
  tipTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginTop: 6, marginBottom: 8 },
  tipBody: { color: '#C7C7CC', fontSize: 16, lineHeight: 23, marginBottom: 14 },

  btn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#3D3D3F',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  btnPrimary: { backgroundColor: '#F8D448' },
  btnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  btnTextOnPrimary: { color: '#000000' },
  linkBtn: { paddingVertical: 14, alignItems: 'center' },
  linkText: { color: '#98989D', fontSize: 16 },
});

export default WalkthroughOverlay;
