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
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { InstallerCamera } from '../../components/installer/InstallerCamera';
import { ConfirmActionModal } from './ConfirmActionModal';
import { usePhotoDeleteConfirm } from '../../../hooks/usePhotoDeleteConfirm';
import { INSTALLER_RESULT_REASONS } from '../../../constants/installer';
import type { CapturedPhoto, InstallerResultType, ProposedSchedulePayload } from '../../../config/types/installer';
import { AppointmentSchedulerModal } from '../job-builder/AppointmentSchedulerModal';
import { EDGE_TO_EDGE_MODAL, footerBottomPadding } from '../../../utils/installer-insets';

interface Props {
  visible: boolean;
  result: InstallerResultType | null;
  submitting?: boolean;
  photos?: CapturedPhoto[];
  uploadingCount?: number;
  onPhotoCaptured?: (reason: string, photo: CapturedPhoto) => void;
  onRemovePhoto?: (photo: CapturedPhoto) => void | Promise<void>;
  customerName?: string;
  onClose: () => void;
  onConfirm: (reason: string, proposedSchedule?: ProposedSchedulePayload) => void;
}

export function ResultJobModal({
  visible,
  result,
  submitting,
  photos = [],
  uploadingCount = 0,
  customerName = '',
  onPhotoCaptured,
  onRemovePhoto,
  onClose,
  onConfirm,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [proposedSchedule, setProposedSchedule] = useState<ProposedSchedulePayload | null>(
    null
  );

  useEffect(() => {
    setReason(null);
    setCameraOpen(false);
    setSchedulerOpen(false);
    setProposedSchedule(null);
  }, [result, visible]);

  const del = usePhotoDeleteConfirm<{ photo: CapturedPhoto; index: number }>(
    async ({ photo }) => {
      await onRemovePhoto?.(photo);
    }
  );

  if (!result) return null;
  const reasons = INSTALLER_RESULT_REASONS[result] ?? [];
  const canAttach = !!reason && !!onPhotoCaptured;

  const photosRequired = result === "Can't Do Work" && !!onPhotoCaptured;
  const needsPhoto = photosRequired && photos.length === 0;
  const needsSchedule = result === 'Not Hit' || result === 'Reset';
  const canSubmit = !!reason && !needsPhoto && (!needsSchedule || !!proposedSchedule) && !submitting;

  const isUploading = uploadingCount > 0;
  const photoWord = `photo${uploadingCount === 1 ? '' : 's'}`;

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
    <>
    <Modal
      visible={visible && !schedulerOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      {...EDGE_TO_EDGE_MODAL}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View
          className="w-full rounded-t-[32px] px-6 pt-5"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            paddingBottom: footerBottomPadding(insets.bottom),
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
                  <>
                    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                      {photos.map((p, i) => (
                        <View key={p.id}>
                          <Image
                            source={{ uri: p.uri }}
                            className="rounded-lg"
                            style={{ width: 52, height: 52, backgroundColor: '#26364a' }}
                          />
                          {/* Per-tile state. The strip used to look identical whether a
                              shot was safely in S3 or had failed to get there, which is
                              the difference that decides whether the result carries any
                              evidence at all. */}
                          {p.uploadStatus === 'uploading' && (
                            <View
                              className="absolute inset-0 rounded-lg items-center justify-center"
                              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
                            >
                              <ActivityIndicator size="small" color="#fff" />
                            </View>
                          )}
                          {p.uploadStatus === 'failed' && (
                            <View
                              className="absolute inset-0 rounded-lg items-center justify-center"
                              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
                            >
                              <MaterialIcon name="alert-circle" size={18} color="#FF5630" />
                            </View>
                          )}
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

                    {/* Said BEFORE the tap, so the wait that follows is expected rather
                        than a sheet that appears to have frozen. */}
                    {isUploading && !submitting && (
                      <View className="flex-row items-center mt-2">
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                        <Text
                          className="text-xs font-semibold ml-2"
                          style={{ color: colors.textSecondary }}
                        >
                          Uploading {uploadingCount} {photoWord}… submitting will wait for
                          {uploadingCount === 1 ? ' it' : ' them'}.
                        </Text>
                      </View>
                    )}
                  </>
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

            {needsSchedule && (
              <View className="mb-4">
                <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
                  New install date & time
                </Text>
                <TouchableOpacity
                  onPress={() => setSchedulerOpen(true)}
                  className="w-full px-4 py-3.5 rounded-xl border flex-row items-center justify-between"
                  style={{
                    borderColor: proposedSchedule ? colors.primary.main : colors.border,
                    backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8',
                  }}
                >
                  <Text
                    className="text-base flex-1"
                    style={{
                      color: proposedSchedule ? colors.text : colors.textSecondary,
                    }}
                  >
                    {proposedSchedule
                      ? proposedSchedule.date === 'TBD'
                        ? `TBD${proposedSchedule.reason ? ` — ${proposedSchedule.reason}` : ''}`
                        : `${proposedSchedule.date}${
                            proposedSchedule.timeWindow
                              ? ` · ${proposedSchedule.timeWindow}`
                              : ''
                          }`
                      : 'Select date and time (or TBD)'}
                  </Text>
                  <Icon
                    name={proposedSchedule ? 'checkmark-circle' : 'calendar-outline'}
                    size={20}
                    color={proposedSchedule ? colors.primary.main : colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            disabled={!canSubmit}
            onPress={() =>
              canSubmit &&
              reason &&
              onConfirm(reason, proposedSchedule || undefined)
            }
            className="h-12 rounded-xl items-center justify-center mt-2"
            style={{
              backgroundColor: canSubmit ? colors.primary.main : colors.textSecondary + '40',
            }}
          >
            {submitting ? (
              <View className="flex-row items-center">
                <ActivityIndicator color="#fff" />
                <Text className="text-white text-base font-bold ml-2">
                  {isUploading ? `Uploading ${uploadingCount} ${photoWord}…` : 'Submitting…'}
                </Text>
              </View>
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
          {needsSchedule && !proposedSchedule && (
            <Text
              className="text-center text-[11px] font-bold mt-1.5"
              style={{ color: colors.error.main }}
            >
              Select a new install date and time, or TBD
            </Text>
          )}
        </View>
      </View>
    </Modal>

      <AppointmentSchedulerModal
        visible={visible && schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        customerName={customerName}
        isEdit
        initialDate={proposedSchedule?.date}
        initialTimeWindow={proposedSchedule?.timeWindow || undefined}
        onConfirm={(data) => {
          setProposedSchedule(
            data?.date === 'TBD'
              ? { date: 'TBD', timeWindow: null, reason: data?.reason || null }
              : {
                  date: String(data?.date || ''),
                  timeWindow: data?.timeWindow || null,
                }
          );
        }}
      />

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
    </>
  );
}
