import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { InstallerCamera } from '../../../widgets/components/installer/InstallerCamera';
import { ConfirmActionModal } from '../../../widgets/modals/installer/ConfirmActionModal';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import { usePhotoDeleteConfirm } from '../../../hooks/usePhotoDeleteConfirm';
import type { CapturedPhoto, MaterialStepState } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  mode: 'pickup' | 'return';
  state: MaterialStepState;
  onAddPhoto: (photo: CapturedPhoto) => void;
  /**
   * Resolves once the photo is gone from the server as well as from state — the
   * confirm dialog holds its spinner on this promise.
   */
  onRemovePhoto: (photoId: string) => void | Promise<void>;
  onSkip: () => void;
  onBack: () => void;
}

/**
 * Material pickup / return hub.
 *
 * The step self-satisfies on the first photo — Inventory Center reconciles the
 * shots against what was issued, so there's no explicit "done" action. The skip
 * path covers "had material on truck" / "used all material".
 */
export function MaterialPhotoStep({
  visible,
  mode,
  state,
  onAddPhoto,
  onRemovePhoto,
  onSkip,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const log = useInstallerActivityLog();
  const [cameraOpen, setCameraOpen] = useState(false);

  const isPickup = mode === 'pickup';
  const satisfied = state.photos.length > 0 || state.skipped;

  // The capture itself is logged by the upload hook, once S3 has answered with the
  // s3url and byte size the portal's payload needs. The removal is logged here, and
  // only AFTER it lands — logging on the tap would record deletions that never happened.
  const del = usePhotoDeleteConfirm<{ photo: CapturedPhoto; index: number }>(
    async ({ photo, index }) => {
      await onRemovePhoto(photo.id);
      log.photoRemoved({
        step: mode,
        category: isPickup ? 'Material Pickup' : 'Material Return',
        subcategory: `${mode} #${index + 1}`,
        timestamp: photo.takenAt,
        coordinates: photo.coordinates,
        s3url: photo.s3url,
        bucketName: photo.bucketName,
      });
    }
  );

  const handleSkip = () => {
    log.materialSkipped(mode);
    onSkip();
  };

  const skipLabel = isPickup
    ? 'Had Material On Truck — Nothing Picked Up'
    : 'Used All Material — Nothing to Return';

  const satisfiedLabel = state.skipped
    ? isPickup
      ? 'Marked: had material on truck'
      : 'Marked: used all material'
    : `${isPickup ? 'Pickup' : 'Return'} satisfied — Inventory Center will reconcile`;

  return (
    <InstallerSubScreen
      visible={visible}
      title={isPickup ? 'Material Pickup' : 'Material Return'}
      subtitle={
        isPickup
          ? 'Photo the material loaded for this job'
          : 'Photo the material coming back to the warehouse'
      }
      onBack={onBack}
      overlay={
        cameraOpen ? (
          <InstallerCamera
            label={isPickup ? 'PICKUP • Loaded Material' : 'RETURN • Unused Material'}
            hint={
              isPickup
                ? 'Photo the material loaded for this job'
                : 'Photo the material coming back'
            }
            count={state.photos.length}
            onCancel={() => setCameraOpen(false)}
            onCapture={onAddPhoto}
          />
        ) : undefined
      }
    >
      {satisfied ? (
        <View
          className="flex-row items-center rounded-2xl p-3 mb-3 border-2"
          style={{ backgroundColor: colors.primary.main + '10', borderColor: colors.primary.main }}
        >
          <View
            className="w-6 h-6 rounded-full items-center justify-center mr-2.5"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Icon name="check" size={14} color="#fff" />
          </View>
          <Text
            className="flex-1 text-xs font-bold"
            style={{ color: colors.primary.main }}
          >
            {satisfiedLabel}
          </Text>
        </View>
      ) : (
        <Text className="text-xs font-semibold mb-3" style={{ color: colors.textSecondary }}>
          Inventory Center matches your photos against what was issued.
        </Text>
      )}

      {/* Captured shots */}
      {state.photos.length > 0 && (
        <View className="flex-row flex-wrap mb-3" style={{ gap: 10 }}>
          {state.photos.map((photo, i) => (
            <View
              key={photo.id}
              className="rounded-xl overflow-hidden"
              style={{ width: '31%', aspectRatio: 1, backgroundColor: '#26364a' }}
            >
              <Image source={{ uri: photo.uri }} style={{ flex: 1 }} resizeMode="cover" />
              <View className="absolute top-1.5 left-2">
                <Text className="text-[10px] font-bold text-white">#{i + 1}</Text>
              </View>
              <TouchableOpacity
                onPress={() => del.request({ photo, index: i })}
                className="absolute top-1 right-1 w-6 h-6 rounded-full items-center justify-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
              >
                <Icon name="close" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {!state.skipped && (
        <TouchableOpacity
          onPress={() => setCameraOpen(true)}
          className="h-12 rounded-xl items-center justify-center flex-row"
          style={{ backgroundColor: colors.primary.main }}
        >
          <Icon name="camera" size={18} color="#fff" />
          <Text className="text-white ml-2 text-base font-bold">
            {state.photos.length === 0 ? 'Take Photo' : 'Take Another Photo'}
          </Text>
        </TouchableOpacity>
      )}

      {!satisfied && (
        <>
          <View className="flex-row items-center my-3" style={{ gap: 12 }}>
            <View className="flex-1 h-px" style={{ backgroundColor: colors.border }} />
            <Text className="text-[11px] font-bold" style={{ color: colors.textSecondary }}>
              OR
            </Text>
            <View className="flex-1 h-px" style={{ backgroundColor: colors.border }} />
          </View>
          <TouchableOpacity
            onPress={handleSkip}
            className="h-12 rounded-xl items-center justify-center border-2"
            style={{ borderColor: colors.warning.main, backgroundColor: colors.background }}
          >
            <Text className="text-sm font-bold" style={{ color: colors.warning.dark }}>
              {skipLabel}
            </Text>
          </TouchableOpacity>
        </>
      )}

      <ConfirmActionModal
        visible={del.visible}
        icon="image-remove"
        tone="danger"
        title="Delete this photo?"
        description={`Photo #${(del.target?.index ?? 0) + 1} will be removed from this job and deleted from the server. You'll have to retake it.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        submitting={del.deleting}
        onCancel={del.cancel}
        onConfirm={del.confirm}
      />
    </InstallerSubScreen>
  );
}
