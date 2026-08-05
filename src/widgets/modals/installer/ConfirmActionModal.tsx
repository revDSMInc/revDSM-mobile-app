import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';

export type ConfirmTone = 'primary' | 'danger';

/**
 * How the confirmation is presented.
 *
 * `dialog` — centred card, fades in. For a decision that has to interrupt: it sits over
 * the middle of the screen and there is nowhere to tap but the two buttons.
 * `sheet` — slides up from the bottom edge, dismissible by tapping above it. For a
 * decision taken in the flow of work, where the reason list is the substance of it.
 */
export type ConfirmPresentation = 'dialog' | 'sheet';

interface Props {
  visible: boolean;
  /** MaterialCommunityIcons glyph shown in the tinted circle. */
  icon: string;
  title: string;
  /** Optional — omit for dialogs where the title plus the reason list say it all. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red — for actions that destroy work. */
  tone?: ConfirmTone;
  /** Centred dialog (default) or bottom sheet. Same content either way. */
  presentation?: ConfirmPresentation;
  /**
   * When supplied, the dialog asks for one of these before it will confirm, and
   * passes the choice to `onConfirm`. Used where the API requires a reason.
   */
  reasons?: string[];
  reasonLabel?: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}

/**
 * Yes/Cancel confirmation for the installer's one-way actions.
 *
 * Completing a job and resetting one are both irreversible from the phone, so
 * neither fires straight off its button. Shared rather than duplicated so the two
 * read identically — only the wording, the accent and the presentation change.
 *
 * The two presentations render the SAME body, deliberately: the reason picker, the
 * disabled-until-chosen confirm and the in-flight lockout must behave identically
 * whichever way the confirmation arrives.
 */
export function ConfirmActionModal({
  visible,
  icon,
  title,
  description,
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  tone = 'primary',
  presentation = 'dialog',
  reasons,
  reasonLabel = 'Reason',
  submitting,
  onCancel,
  onConfirm,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const accent = tone === 'danger' ? colors.error.main : colors.primary.main;
  const isSheet = presentation === 'sheet';

  const [reason, setReason] = useState<string | null>(null);

  // A choice must not survive the dialog closing and reopening for a different job.
  useEffect(() => {
    if (!visible) setReason(null);
  }, [visible]);

  const needsReason = !!reasons?.length;
  const canConfirm = !submitting && (!needsReason || !!reason);

  const body = (
    <>
      <View
        className="w-14 h-14 rounded-full items-center justify-center mb-4"
        style={{ backgroundColor: accent + '1A' }}
      >
        <Icon name={icon} size={30} color={accent} />
      </View>

      {/* With no description the title carries the full gap itself, so dropping the
          blurb doesn't leave the next block crowding the heading. */}
      <Text
        className={`text-xl font-black text-center ${description ? 'mb-2' : 'mb-6'}`}
        style={{ color: colors.text }}
      >
        {title}
      </Text>
      {!!description && (
        <Text
          className="text-sm font-semibold text-center leading-5 mb-6"
          style={{ color: colors.textSecondary }}
        >
          {description}
        </Text>
      )}

      {needsReason && (
        <View className="w-full mb-5">
          <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
            {reasonLabel}
          </Text>
          {/* A sheet is anchored to the bottom edge and can afford a longer list; a
              centred dialog grows in both directions and has to stay clear of the
              screen edges. */}
          <ScrollView style={{ maxHeight: isSheet ? 300 : 220 }}>
            <View
              className="rounded-xl overflow-hidden border"
              style={{ borderColor: colors.border }}
            >
              {reasons!.map((option, i) => {
                const on = reason === option;
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setReason(option)}
                    className="px-4 py-3.5 flex-row items-center justify-between"
                    style={{
                      backgroundColor: on ? accent + '10' : colors.background,
                      borderBottomWidth: i < reasons!.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Text
                      className="text-base flex-1"
                      style={{ color: on ? accent : colors.text }}
                    >
                      {option}
                    </Text>
                    {on && <Icon name="check-circle" size={20} color={accent} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      )}

      <View className="flex-row w-full" style={{ gap: 10 }}>
        <TouchableOpacity
          disabled={submitting}
          onPress={onCancel}
          className="flex-1 h-12 rounded-xl items-center justify-center border-2"
          style={{ borderColor: colors.border, backgroundColor: colors.background }}
        >
          <Text className="text-base font-bold" style={{ color: colors.textSecondary }}>
            {cancelLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!canConfirm}
          onPress={() => onConfirm(reason ?? undefined)}
          className="flex-1 h-12 rounded-xl items-center justify-center"
          style={{ backgroundColor: canConfirm ? accent : colors.textSecondary + '40' }}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              className="text-base font-bold"
              style={{ color: canConfirm ? '#fff' : colors.textSecondary }}
            >
              {confirmLabel}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  if (isSheet) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        // Ignore the hardware back button mid-request, so the action can't be left in
        // an unknown state from the installer's point of view.
        onRequestClose={submitting ? undefined : onCancel}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          {/* Only the area ABOVE the sheet dismisses. A backdrop wrapping the sheet
              would also fire on the sheet's own padding, cancelling a reset the
              installer was in the middle of choosing a reason for. Locked while a
              request is in flight, like every other way out of this modal. */}
          <Pressable style={{ flex: 1 }} onPress={submitting ? undefined : onCancel} />

          <View
            className="w-full px-6 pt-3 items-center"
            style={{
              backgroundColor: isDark ? colors.surface : colors.background,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              // Clears the home indicator / nav bar — the confirm button is the last
              // thing in here and must not sit under it.
              paddingBottom: insets.bottom + 16,
            }}
          >
            {/* Grabber — the app's established sheet affordance (see the phone-actions
                sheet on the job detail screen). */}
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.textSecondary,
                opacity: 0.3,
                marginBottom: 16,
              }}
            />
            {body}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Ignore the hardware back button mid-request, so the action can't be left in
      // an unknown state from the installer's point of view.
      onRequestClose={submitting ? undefined : onCancel}
    >
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      >
        <View
          className="w-full rounded-3xl px-6 pt-7 pb-5 items-center"
          style={{ backgroundColor: isDark ? colors.surface : colors.background }}
        >
          {body}
        </View>
      </View>
    </Modal>
  );
}
