import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useTheme } from '../../../theme/ThemeProvider';
import { headerTopPadding } from '../../../utils/installer-insets';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
  /** Sticky action rendered above the bottom inset. */
  footer?: React.ReactNode;
  /**
   * Full-bleed layer (e.g. the camera) rendered outside the inset container and
   * the ScrollView, so `absoluteFill` covers the whole screen including the
   * insets rather than being trapped inside scroll content.
   */
  overlay?: React.ReactNode;
}

/**
 * Full-screen shell for the install timeline's sub-flows.
 *
 * Presented as a `Modal` (matching LeadCenter's SubModalWrap) so sub-flows stack
 * over the job detail screen without needing their own navigator routes. The
 * header mirrors LeadCenter's local header: bordered square back button + title.
 */
export function InstallerSubScreen({
  visible,
  title,
  subtitle,
  onBack,
  children,
  footer,
  overlay,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onBack}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/*
          Insets are applied by hand rather than with <SafeAreaView>: that is a
          native view fed by the provider's native hierarchy, and a Modal renders
          into a separate host view outside it — so inside a Modal it receives
          zero insets and the header collides with the status bar. The
          useSafeAreaInsets() hook reads React context, which does cross the
          Modal boundary. Same approach as PhotoMatchStep / AgreementSignatureModal.

          The hook is not the whole answer either, though: what crosses the boundary is
          the ROOT window's inset, not this modal window's, and the two stop agreeing the
          moment something else re-declares the status bar — opening the camera over a
          step and dismissing it is enough. `insets.top` then comes back 0 and the back
          button lands on the status bar. `headerTopPadding` floors it so that cannot
          happen; a real, larger inset still wins.
        */}
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            paddingTop: headerTopPadding(insets.top),
            paddingLeft: insets.left,
            paddingRight: insets.right,
          }}
        >
        <View className="px-4 pb-3 pt-2">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={onBack}
              className="mr-3 p-1 items-center justify-center border border-border rounded-lg"
              style={{ width: 32, height: 32 }}
            >
              <Feather
                name="arrow-left"
                size={14}
                color={isDark ? colors.text : colors.textSecondary}
              />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-lg font-black" style={{ color: colors.text }}>
                {title}
              </Text>
              {/* 12 px / secondary — the size sales sets a card subtitle in
                  (`VerticalSummaryTab`'s "Review all configured job details…"). 11 px was
                  below anything the sales app puts body copy at. */}
              {!!subtitle && (
                <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                  {subtitle}
                </Text>
              )}
            </View>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: footer ? 16 : Math.max(insets.bottom, 24) + 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        {!!footer && (
          <View
            className="px-4 pt-3"
            style={{
              paddingBottom: Math.max(insets.bottom, 16),
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.background,
            }}
          >
            {footer}
          </View>
        )}
        </View>
        {overlay}
      </View>
    </Modal>
  );
}
