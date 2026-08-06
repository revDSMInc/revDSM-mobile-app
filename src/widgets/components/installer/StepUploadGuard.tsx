import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  /** Photos still queued or in the air. The overlay hides itself at 0. */
  count: number;
  /** Dismiss and stay in the step — the uploads carry on either way. */
  onKeepShooting: () => void;
  /** Close the step now, leaving the queue to finish in the background. */
  onLeaveAnyway: () => void;
}

/**
 * "Photos still uploading" — shown when the installer backs out of a capture step
 * while the queue is still draining.
 *
 * **Why leaving matters here.** A step is closed by PATCHing the photos it recorded,
 * and that PATCH can only reference a shot whose `s3url` has come back. Close the step
 * mid-upload and the request goes out naming the photos that happened to have landed;
 * the rest are on the device, absent from the job, and nothing on the server points at
 * them. The installer sees a step they filled and a record that is short of it.
 *
 * So the exit is held, and the step **closes itself** the moment the count reaches zero
 * — the installer does not have to come back and tap again.
 *
 * **An absolute-fill View, not a Modal.** Every capture step is already inside one
 * (`InstallerSubScreen` / `PhotoMatchStep`), and a second Modal presented over the
 * first from a sibling position is exactly the stacking iOS refuses. This is the same
 * shape `InstallerCamera` and `ReviewPair` use to layer over a step.
 *
 * **"Leave Anyway" is deliberate.** Three attempts against a 120 s timeout, serialized,
 * means a genuinely dead cell can hold the queue for minutes. A crew packing up must
 * never be locked in a dialog by a network that is not coming back — so the cost of
 * leaving is stated plainly and the choice stays theirs.
 */
export function StepUploadGuard({ count, onKeepShooting, onLeaveAnyway }: Props) {
  const { colors } = useTheme();
  if (count <= 0) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <View
        className="rounded-3xl px-6 pt-6 pb-5 mx-8"
        style={{ backgroundColor: colors.background, maxWidth: 380 }}
      >
        <View className="items-center mb-3">
          <View
            className="items-center justify-center rounded-full mb-3"
            style={{ width: 56, height: 56, backgroundColor: colors.primary.main + '1A' }}
          >
            <ActivityIndicator size="small" color={colors.primary.main} />
          </View>
          <Text className="text-lg font-black text-center" style={{ color: colors.text }}>
            {count === 1 ? 'Uploading 1 photo' : `Uploading ${count} photos`}
          </Text>
        </View>

        <Text
          className="text-[13px] font-semibold leading-5 text-center mb-4"
          style={{ color: colors.textSecondary }}
        >
          This step closes on its own as soon as they finish. Leaving now saves the step
          without them — the photos stay on this device, but the job won't reference them.
        </Text>

        <TouchableOpacity
          onPress={onKeepShooting}
          className="h-12 rounded-xl items-center justify-center flex-row mb-2"
          style={{ backgroundColor: colors.primary.main }}
        >
          <Icon name="camera-outline" size={17} color="#fff" />
          <Text className="text-white ml-2 text-base font-black">Keep Shooting</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onLeaveAnyway}
          className="h-11 items-center justify-center"
        >
          <Text className="text-sm font-bold" style={{ color: colors.textSecondary }}>
            Leave Anyway
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
});
