import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import IonIcon from 'react-native-vector-icons/Ionicons';

const DISABLED_GLYPH = 'rgba(255,255,255,0.32)';

/**
 * Prev / next arrows floating over a slide.
 *
 * Ticket: *"user can change slides by swiping or tapping arrows — add this functionality
 * also."* Fullscreen already had both; the INLINE card had neither, so a rep presenting
 * without going fullscreen could only move with the buttons under the progress bar.
 *
 * ⚠️ Disabled at the ends rather than hidden. An arrow that vanishes at slide 1 moves the
 * one beside it and makes the rep re-aim mid-sentence; dimmed in place, the target never
 * moves.
 *
 * ⚠️ **Only the GLYPH dims — the disc stays at full strength.** It first dimmed the whole
 * control to `opacity: 0.3`, and a near-black disc at 30 % over the fullscreen slide's
 * BLACK letterbox is invisible: on slide 1 the rep saw one arrow and reported the other
 * missing. Dimming the chevron alone keeps the control present, which is the whole reason
 * it is disabled rather than hidden.
 */

interface Props {
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** Distance in from each side; `leftInset` / `rightInset` override it per side. */
  inset?: number;
  /**
   * ⚠️ The two sides take DIFFERENT insets in landscape and that is not symmetry for its
   * own sake: the cutout is on one side and the Android navigation bar on the other, so a
   * single value either clips one arrow or pushes both needlessly far in.
   */
  leftInset?: number;
  rightInset?: number;
  size?: number;
}

export function SlideArrows({
  onPrev,
  onNext,
  canPrev,
  canNext,
  inset = 12,
  leftInset,
  rightInset,
  size = 40,
}: Props) {
  const half = size / 2;
  const l = leftInset ?? inset;
  const r = rightInset ?? inset;

  return (
    <>
      <TouchableOpacity
        onPress={onPrev}
        disabled={!canPrev}
        accessibilityRole="button"
        accessibilityLabel="Previous slide"
        activeOpacity={0.8}
        style={[
          styles.arrow,
          { left: l, width: size, height: size, borderRadius: half, marginTop: -half },
        ]}
      >
        <IonIcon name="chevron-back" size={22} color={canPrev ? '#fff' : DISABLED_GLYPH} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onNext}
        disabled={!canNext}
        accessibilityRole="button"
        accessibilityLabel="Next slide"
        activeOpacity={0.8}
        style={[
          styles.arrow,
          { right: r, width: size, height: size, borderRadius: half, marginTop: -half },
        ]}
      >
        <IonIcon name="chevron-forward" size={22} color={canNext ? '#fff' : DISABLED_GLYPH} />
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  arrow: {
    position: 'absolute',
    // ⚠️ RN has no `translateY(-50%)`, so the vertical centre is `top: '50%'` plus a
    // NEGATIVE margin of half the height — without it the arrow's TOP edge sits on the
    // midline rather than its centre. Same rule as the inspection viewer's chevrons.
    top: '50%',
    /**
     * ⚠️ Nearly OPAQUE, with a light ring and a shadow — not the translucent scrim the
     * top bar uses.
     *
     * These sit ON the slide, and a slide is arbitrary artwork: at `rgba(0,0,0,0.45)` the
     * white chevron over a white table was barely visible, which is what was reported.
     * The ✕ and the page count get away with a scrim because they sit in the letterboxed
     * BLACK margin, where there is nothing behind them to wash them out.
     *
     * The ring is what carries it the other way — an almost-black disc on an almost-black
     * slide would disappear just as completely.
     */
    backgroundColor: 'rgba(17,19,20,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
});
