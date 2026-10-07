import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import IonIcon from 'react-native-vector-icons/Ionicons';

const DISABLED_GLYPH = 'rgba(255,255,255,0.32)';

interface Props {
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  inset?: number;
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
    top: '50%',
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
