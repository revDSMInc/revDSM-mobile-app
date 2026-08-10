import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * Port of web `deal-center/components/build-from-existing-dialog.js`.
 *
 * Shown on a REHASH when the rep opens the job builder for a calculator that already
 * has a saved build. Reusing the prior scope/measurements/specs is the helpful default,
 * but it must be the rep's explicit choice — never automatic: a rehash is a second
 * attempt at the house, and silently re-applying the original build would hide from the
 * rep that they are quoting last visit's scope.
 *
 * Deliberately NOT dismissible by tapping outside (web renders the Dialog with no
 * `onClose`) — both answers open the builder, so there is no third outcome to fall
 * back to, and a stray tap that closed it would strand the rep on the result step.
 */
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 20,
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
