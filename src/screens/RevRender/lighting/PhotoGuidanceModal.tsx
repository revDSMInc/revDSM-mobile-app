import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { RenderMode } from './ModeSwitch';

const GREEN = '#2EDE56';

/**
 * First-time photo guidance when switching modes (Lance, REVUIUX-483 30 Sep).
 *
 * Core and Lighting want opposite photos: Core repaints a surface you need to
 * see in detail, Lighting runs a channel along the whole roofline and shifts the
 * scene to dusk, so it needs the house and sky in frame. Reps have been filling
 * the elevation slots with close-ups, which is right for Core and unusable for
 * Lighting.
 *
 * "Don't show me this again" is PER REP ACCOUNT, not per device — so the
 * dismissal has to persist server-side. Until that endpoint exists the caller
 * can hold it locally, but it must not stay there.
 */
export function PhotoGuidanceModal({
  mode,
  visible,
  isDark,
  onGotIt,
  onNeverShowAgain,
}: {
  mode: RenderMode;
  visible: boolean;
  isDark: boolean;
  onGotIt: () => void;
  onNeverShowAgain: () => void;
}) {
  const copy =
    mode === 'core'
      ? {
          title: 'Get in close for best results',
          body: 'Core Products repaints a surface, so the render needs to see it clearly. Pick a close-up of the soffit, fascia or gutter.',
          icon: 'magnify-plus-outline',
        }
      : {
          title: 'Zoom out for best results',
          body: 'Roofline Lighting runs along the whole roof and shows the home at dusk, so it needs the full house and some sky in frame. Pick a photo taken from the street.',
          icon: 'home-outline',
        };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onGotIt}>
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View
          className="w-full rounded-[20px] p-6"
          style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff' }}
        >
          <View className="items-center mb-4">
            <View
              className="items-center justify-center rounded-full mb-3"
              style={{ width: 56, height: 56, backgroundColor: `${GREEN}22` }}
            >
              <Icon name={copy.icon} size={28} color={GREEN} />
            </View>
            <Text
              className="text-[17px] font-black text-center"
              style={{ color: isDark ? '#fff' : '#212B36' }}
            >
              {copy.title}
            </Text>
          </View>

          <Text
            className="text-[13px] text-center mb-6"
            style={{ color: isDark ? '#919EAB' : '#637381', lineHeight: 19 }}
          >
            {copy.body}
          </Text>

          <TouchableOpacity
            onPress={onGotIt}
            accessibilityRole="button"
            className="rounded-full items-center justify-center mb-3"
            style={{ minHeight: 48, backgroundColor: GREEN }}
          >
            <Text className="text-[15px] font-black text-white">Got it</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onNeverShowAgain}
            accessibilityRole="button"
            className="items-center justify-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-[13px] font-bold" style={{ color: isDark ? '#919EAB' : '#637381' }}>
              Got it, don&apos;t show me this again
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
