import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';

export function BuildFromExistingModal({
  visible,
  onReuse,
  onStartFresh,
}: {
  visible: boolean;
  onReuse: () => void;
  onStartFresh: () => void;
}) {
  const { isDark } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={isDark ? 'dark' : 'light'}
          blurAmount={10}
          reducedTransparencyFallbackColor={isDark ? '#000000' : '#FFFFFF'}
        />
        {/* Scrim OVER the blur. A light blur of a mostly-white screen is itself
            near-white, so the white card had nothing to sit against and its edges
            disappeared. Dimming what is behind the card — rather than tinting the card
            — keeps the dialog reading as the foreground element. `pointerEvents="none"`
            so it never swallows a tap meant for the buttons. */}
        <View pointerEvents="none" style={styles.scrim} />
        <Pressable style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="time-outline" size={32} color="#4CBB17" />
          </View>

          <Text style={styles.title}>Build job from existing job build?</Text>
          <Text style={styles.body}>
            This job was already built on the original appointment. You can reuse that
            scope, measurements, and specs, or start over from scratch.
          </Text>

          {/* Start Fresh sits LEFT/outlined and Use Existing RIGHT/filled, matching web:
              reuse is the recommended action, so it gets the primary weight. */}
          <View style={styles.actions}>
            <TouchableOpacity onPress={onStartFresh} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Start Fresh</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onReuse} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnPrimaryText}>Use Existing</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: '#DFE3E8',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 16,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#4CBB1722',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C252E',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: '#637381',
    textAlign: 'center',
    marginBottom: 24,
  },
  actions: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  btnGhostText: { fontSize: 14, fontWeight: '600', color: '#1C252E' },
  btnPrimary: { backgroundColor: '#4CBB17' },
  btnPrimaryText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
