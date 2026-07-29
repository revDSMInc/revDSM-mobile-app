import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { InstallerCamera } from '../../components/installer/InstallerCamera';
import { ConfirmActionModal } from './ConfirmActionModal';
import { usePhotoDeleteConfirm } from '../../../hooks/usePhotoDeleteConfirm';
import { INSTALLER_RESULT_REASONS } from '../../../constants/installer';
import type { CapturedPhoto, InstallerResultType } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  result: InstallerResultType | null;
  submitting?: boolean;
  /**
   * Evidence captured so far. Owned by the parent (it lives in `InstallProgress`) so a
   * shot still uploading when Submit is pressed is drained rather than dropped.
   */
  photos?: CapturedPhoto[];
  /** A shot was taken — the parent stores it and starts the upload. */
  onPhotoCaptured?: (reason: string, photo: CapturedPhoto) => void;
  /** Resolves once the photo is gone from the server too; the ✕ spinner waits on it. */
  onRemovePhoto?: (photo: CapturedPhoto) => void | Promise<void>;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Results a job the installer can't complete.
 *
 * A reason is mandatory — an unexplained non-completion is what the Install Manager
 * can't action, so confirm stays disabled until one is picked.
 *
 * Once a reason IS picked, the installer attaches photos of what stopped them. The
 * strip is the same one the Pre-Existing Conditions step uses (52 px tiles, a ✕ per
 * tile that confirms before deleting), because it is the same job: evidence that only
 * means something next to the label explaining it.
 *
 * **Can't Do Work requires at least one photo** — that result puts the install back on
 * the schedule and someone has to justify the return trip, which a sentence alone
 * doesn't. Not Hit does not: "Car Broke Down" and "Medical Emergency" have nothing at
 * the job site to photograph, and demanding one would strand an installer reporting
 * exactly those.
 */
export function ResultJobModal({
  visible,
  result,
  submitting,
  photos = [],
  onPhotoCaptured,
  onRemovePhoto,
  onClose,
  onConfirm,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Reasons are per-result-type, so a stale pick must not survive a type change.
  // Photos are deliberately NOT cleared here: switching reason after shooting is
  // common ("Weather" → "Roof Access Unsafe"), and the shots are still the evidence.
  // `buildResultStepData` re-stamps them with whichever reason is finally submitted.
  useEffect(() => {
    setReason(null);
    setCameraOpen(false);
  }, [result, visible]);

  const del = usePhotoDeleteConfirm<{ photo: CapturedPhoto; index: number }>(
    async ({ photo }) => {
      await onRemovePhoto?.(photo);
    }
  );

  if (!result) return null;
  const reasons = INSTALLER_RESULT_REASONS[result] ?? [];
  const canAttach = !!reason && !!onPhotoCaptured;

  /** Can't Do Work must be evidenced; Not Hit need not be. */
  const photosRequired = result === "Can't Do Work" && !!onPhotoCaptured;
  const needsPhoto = photosRequired && photos.length === 0;
  const canSubmit = !!reason && !needsPhoto && !submitting;

  // The camera takes the whole sheet rather than stacking another modal on top of it —
  // a viewfinder inside a 85 %-height bottom sheet is unusable.
  if (cameraOpen && reason) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <InstallerCamera
          label={`RESULT • ${reason}`}
          hint="Photo what's stopping the work"
          count={photos.length}
          onCancel={() => setCameraOpen(false)}
          onCapture={(photo) => onPhotoCaptured?.(reason, photo)}
        />
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View
          className="w-full rounded-t-[32px] px-6 pt-5"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            paddingBottom: Math.max(insets.bottom, 24),
            maxHeight: '85%',
          }}
        >
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Result Job
            </Text>
            <TouchableOpacity onPress={onClose} className="p-1">
              <Icon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              Result
            </Text>
            <View
              className="w-full px-4 py-3.5 rounded-xl border mb-5"
              style={{
                borderColor: '#919EAB33',
                backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8',
              }}
            >
              <Text className="text-base font-bold" style={{ color: colors.text }}>
                {result}
              </Text>
            </View>

            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              Reason
            </Text>
            <View
              className="rounded-xl overflow-hidden border mb-4"
              style={{ borderColor: colors.border }}
            >
              {reasons.map((r, i) => {
                const on = reason === r;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setReason(r)}
                    className="px-4 py-3.5 flex-row items-center justify-between"
                    style={{
                      backgroundColor: on ? colors.primary.main + '10' : colors.background,
                      borderBottomWidth: i < reasons.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Text
                      className="text-base flex-1"
                      style={{ color: on ? colors.primary.main : colors.text }}
                    >
                      {r}
                    </Text>
                    {on && <Icon name="checkmark-circle" size={20} color={colors.primary.main} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Evidence — only once there is a reason to attach it to. */}
            {canAttach && (
              <View className="mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    Photos{' '}
                    <Text
                      style={{
                        color: needsPhoto ? colors.error.main : colors.textSecondary,
                      }}
                    >
                      {photosRequired ? '(required)' : '(optional)'}
                    </Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setCameraOpen(true)}
                    className="rounded-lg px-2.5 py-1.5 flex-row items-center"
                    style={{
                      backgroundColor:
                        photos.length > 0
                          ? colors.primary.main
                          : needsPhoto
                          ? colors.error.main
                          : colors.info.main,
                    }}
                  >
                    <MaterialIcon
                      name={photos.length > 0 ? 'check' : 'camera'}
                      size={12}
                      color="#fff"
                    />
                    <Text className="text-white text-[11px] font-bold ml-1">
                      {photos.length > 0
                        ? `${photos.length} photo${photos.length > 1 ? 's' : ''} · add`
                        : 'Add Photo'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {photos.length > 0 ? (
                  <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                    {photos.map((p, i) => (
                      <View key={p.id}>
                        <Image
                          source={{ uri: p.uri }}
                          className="rounded-lg"
                          style={{ width: 52, height: 52, backgroundColor: '#26364a' }}
                        />
                        {!!onRemovePhoto && (
                          <TouchableOpacity
                            onPress={() => del.request({ photo: p, index: i })}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full items-center justify-center"
                            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                          >
                            <MaterialIcon name="close" size={11} color="#fff" />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: needsPhoto ? colors.error.main : colors.textSecondary }}
                  >
                    {needsPhoto
                      ? `A photo of the problem is required for "${reason}" — it's what the Install Manager acts on.`
                      : "Photograph what stopped the work — it's what the Install Manager acts on."}
                  </Text>
                )}
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            disabled={!canSubmit}
            onPress={() => canSubmit && reason && onConfirm(reason)}
            className="h-12 rounded-xl items-center justify-center mt-2"
            style={{
              backgroundColor: canSubmit ? colors.primary.main : colors.textSecondary + '40',
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                className="text-base font-bold"
                style={{ color: canSubmit ? '#fff' : colors.textSecondary }}
              >
                Submit Result
              </Text>
            )}
          </TouchableOpacity>

          {/* Says which of the two requirements is outstanding, not just that one is. */}
          {needsPhoto && (
            <Text
              className="text-center text-[11px] font-bold mt-1.5"
              style={{ color: colors.error.main }}
            >
              Add at least one photo to submit this result
            </Text>
          )}
        </View>
      </View>

      <ConfirmActionModal
        visible={del.visible}
        icon="image-remove"
        tone="danger"
        title="Delete this photo?"
        description="This photo will be removed from the result and deleted from the server. You'll have to retake it."
        confirmLabel="Delete"
        cancelLabel="Keep"
        submitting={del.deleting}
        onCancel={del.cancel}
        onConfirm={del.confirm}
      />
    </Modal>
  );
}
