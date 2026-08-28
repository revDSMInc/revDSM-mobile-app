import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { DISCREPANCY_ISSUE_TYPES } from '../../../constants/installer';
import type { SoldProduct } from '../../../config/types/installer';
import { EDGE_TO_EDGE_MODAL, footerBottomPadding } from '../../../utils/installer-insets';

export interface JobPhotoRef {
  id: string;
  label: string;
  uri?: string;
}

interface Props {
  visible: boolean;
  product: SoldProduct | null;
  /** Shots captured so far, attachable as evidence. */
  jobPhotos: JobPhotoRef[];
  onClose: () => void;
  onSend: (payload: { issue: string; note: string; attachments: string[] }) => void;
}

/**
 * Reports a mismatch between the sold spec and what's actually on site.
 *
 * Installers can't self-serve edits to the scope — a discrepancy is routed to the
 * Install Manager and the originating rep to resolve, which is why this sends
 * rather than saves.
 */
export function DiscrepancyModal({ visible, product, jobPhotos, onClose, onSend }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [issue, setIssue] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [attached, setAttached] = useState<string[]>([]);

  const reset = () => {
    setIssue(null);
    setNote('');
    setAttached([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSend = () => {
    if (!issue) return;
    onSend({ issue, note, attachments: attached });
    reset();
  };

  const toggle = (id: string) =>
    setAttached((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  if (!product) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      {...EDGE_TO_EDGE_MODAL}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View
          className="w-full rounded-t-[32px] px-6 pt-5"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            // Clears the system bar the sheet now paints UNDER (`EDGE_TO_EDGE_MODAL` on the
            // Modal above). The bar overlays this padding rather than sitting below it, so what
            // the installer SEES under the last button is the same on a 3-button bar, a gesture
            // pill and an iOS home indicator alike.
            paddingBottom: footerBottomPadding(insets.bottom),
            maxHeight: '85%',
          }}
        >
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Report Discrepancy
            </Text>
            <TouchableOpacity onPress={handleClose} className="p-1">
              <Icon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text className="text-[13px] font-bold mb-4" style={{ color: colors.textSecondary }}>
            {product.name}
          </Text>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // Replaces the `KeyboardAvoidingView` that used to wrap this sheet — an
            // ancestor with no height of its own, sitting between the backdrop and the
            // sheet, which was the one way this sheet's hierarchy differed from the
            // Result Job sheet. iOS-only either way: the KAV passed `undefined` on
            // Android, so nothing is lost there.
            automaticallyAdjustKeyboardInsets
          >
            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              What&apos;s wrong?
            </Text>
            <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
              {DISCREPANCY_ISSUE_TYPES.map((t) => {
                const on = issue === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setIssue(t)}
                    className="rounded-full px-3.5 py-2 border-2"
                    style={{
                      backgroundColor: on ? colors.warning.main + '14' : colors.background,
                      borderColor: on ? colors.warning.main : colors.border,
                    }}
                  >
                    <Text
                      className="text-[13px] font-bold"
                      style={{ color: on ? colors.warning.dark : colors.text }}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              Details
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              placeholder='e.g. "Rear run measures 82 ft, sold at 76 ft"'
              placeholderTextColor="#919EAB"
              // Same trap as the PEC note: no `font-*` class means no fontFamily from this
              // tailwind config, so the typed detail came out in the SYSTEM font under a
              // Public Sans label.
              className="rounded-xl px-3 py-2.5 text-sm font-semibold mb-4"
              style={{
                minHeight: 72,
                textAlignVertical: 'top',
                borderWidth: 1,
                borderColor: '#919EAB33',
                color: colors.text,
                backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8',
              }}
            />

            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              Reference Job Photos
            </Text>
            {jobPhotos.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mb-4"
                contentContainerStyle={{ gap: 8 }}
              >
                {jobPhotos.map((ph) => {
                  const on = attached.includes(ph.id);
                  return (
                    <TouchableOpacity key={ph.id} onPress={() => toggle(ph.id)} style={{ width: 78 }}>
                      <View
                        className="rounded-lg overflow-hidden"
                        style={{
                          width: 78,
                          height: 58,
                          borderWidth: on ? 2.5 : 1.5,
                          borderColor: on ? colors.primary.main : colors.border,
                          backgroundColor: '#26364a',
                        }}
                      >
                        {!!ph.uri && (
                          <Image
                            source={{ uri: ph.uri }}
                            style={{ flex: 1 }}
                            resizeMode="cover"
                          />
                        )}
                        {on && (
                          <View
                            className="absolute top-1 right-1 w-4.5 h-4.5 rounded-full items-center justify-center"
                            style={{
                              backgroundColor: colors.primary.main,
                              width: 18,
                              height: 18,
                            }}
                          >
                            <Icon name="checkmark" size={11} color="#fff" />
                          </View>
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        className="text-[10px] font-bold mt-1 text-center"
                        style={{ color: on ? colors.primary.main : colors.textSecondary }}
                      >
                        {ph.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <Text className="text-xs font-semibold mb-4" style={{ color: colors.textSecondary }}>
                No job photos yet — pickup and pre-install shots will appear here.
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity
            disabled={!issue}
            onPress={handleSend}
            className="h-12 rounded-xl items-center justify-center mt-2"
            style={{
              backgroundColor: issue ? colors.info.main : colors.textSecondary + '40',
            }}
          >
            <Text
              className="text-base font-bold"
              style={{ color: issue ? '#fff' : colors.textSecondary }}
            >
              Send to IM + Rep
              {attached.length > 0
                ? ` (${attached.length} photo${attached.length > 1 ? 's' : ''})`
                : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
