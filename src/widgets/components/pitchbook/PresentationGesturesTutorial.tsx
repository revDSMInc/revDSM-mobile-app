import React from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BlurView } from '@react-native-community/blur';

const GREEN = '#72BD00';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onNeverAgain: () => void;
}

function GestureCard({
  children,
  title,
  body,
  wide,
}: {
  children: React.ReactNode;
  title: string;
  body: string;
  wide: boolean;
}) {
  return (
    <View style={[styles.card, wide ? styles.cardWide : styles.cardStacked]}>
      <View style={styles.cardArt}>{children}</View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

export function PresentationGesturesTutorial({ visible, onDismiss, onNeverAgain }: Props) {
  const { width } = useWindowDimensions();

  const wide = width >= 620;

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType="dark"
        blurAmount={12}
        reducedTransparencyFallbackColor="rgba(8,10,8,0.96)"
      />
      <View style={styles.scrim} />

      <View style={styles.body}>
        <Text style={styles.eyebrow}>QUICK TUTORIAL</Text>
        <Text style={styles.heading}>Presentation Gestures</Text>

        <View style={[styles.cards, wide ? styles.cardsRow : styles.cardsColumn]}>
          <GestureCard
            wide={wide}
            title="Tap Center"
            body="Tap anywhere in the center to toggle toolbar and presentation controls"
          >
            <View style={styles.tapOuter}>
              <View style={styles.tapInner}>
                <Icon name="gesture-tap" size={30} color="#fff" />
              </View>
            </View>
          </GestureCard>

          <GestureCard
            wide={wide}
            title="Swipe Edge-to-Edge"
            body="Swipe left or right anywhere on the slide to navigate through slides"
          >
            <View style={styles.swipeArt}>
              <Icon name="chevron-left" size={18} color="rgba(255,255,255,0.30)" />
              <Icon name="chevron-left" size={22} color="rgba(255,255,255,0.55)" />
              <Icon name="arrow-left-right" size={30} color="#fff" style={styles.swipeArrow} />
              <Icon name="chevron-right" size={22} color="rgba(255,255,255,0.55)" />
              <Icon name="chevron-right" size={18} color="rgba(255,255,255,0.30)" />
              <Icon name="gesture-swipe-horizontal" size={28} color={GREEN} style={styles.swipeHand} />
            </View>
          </GestureCard>
        </View>

        <View style={[styles.actions, wide ? styles.actionsRow : styles.actionsColumn]}>
          {/* The primary action is the one that does NOT remember — a rep who wants the
              reminder next time should not have to read the quieter button to get it. */}
          <TouchableOpacity onPress={onDismiss} activeOpacity={0.85} style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>Got It, Dismiss</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onNeverAgain} activeOpacity={0.85} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnGhostText}>Don't show me again</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 60 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,8,6,0.72)' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  eyebrow: { color: GREEN, fontSize: 12, fontWeight: '700', letterSpacing: 2.4, marginBottom: 6 },
  heading: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 26, textAlign: 'center' },

  cards: { alignItems: 'center', justifyContent: 'center', maxWidth: 720 },
  cardsRow: { flexDirection: 'row', gap: 18 },
  cardsColumn: { flexDirection: 'column', gap: 14, width: '100%' },

  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  cardWide: { width: 264 },
  cardStacked: { width: '100%', maxWidth: 420 },
  cardArt: { height: 92, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 6, marginBottom: 6 },
  cardBody: { color: 'rgba(255,255,255,0.62)', fontSize: 12.5, lineHeight: 18, textAlign: 'center' },

  tapOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: GREEN,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeArt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  swipeArrow: { marginHorizontal: 6 },
  swipeHand: { position: 'absolute', top: 26 },

  actions: { marginTop: 28, alignItems: 'center', justifyContent: 'center' },
  actionsRow: { flexDirection: 'row', gap: 14 },
  actionsColumn: { flexDirection: 'column', gap: 10, width: '100%', maxWidth: 420 },
  btn: {
    minHeight: 46,
    paddingHorizontal: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#F2F2F0' },
  btnPrimaryText: { color: '#14181A', fontSize: 14.5, fontWeight: '700' },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  btnGhostText: { color: '#fff', fontSize: 14.5, fontWeight: '600' },
});
