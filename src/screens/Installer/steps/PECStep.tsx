import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { InstallerCamera } from '../../../widgets/components/installer/InstallerCamera';
import { ConfirmActionModal } from '../../../widgets/modals/installer/ConfirmActionModal';
import { PEC_AREAS } from '../../../constants/installer';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import { usePhotoDeleteConfirm } from '../../../hooks/usePhotoDeleteConfirm';
import type { CapturedPhoto, PECArea, PECEntry } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  hasConditions: boolean | null;
  entries: Record<string, PECEntry>;
  onSetHasConditions: (value: boolean | null) => void;
  onSetEntry: (areaId: string, entry: PECEntry | null) => void;
  /**
   * Fired after a condition shot lands in state, so the parent can upload it.
   * Photos reach state through `onSetEntry` (whole-entry replace), which gives the
   * parent no way to tell which shot is new — hence the explicit callback.
   */
  onPhotoCaptured?: (area: PECArea, photo: CapturedPhoto) => void;
  /**
   * Fired when the installer taps a photo's ✕.
   *
   * The parent removes it from state as well as deleting it server-side — the same
   * split as the material step, and it has to be that way round: the photo's `s3url`
   * may still be arriving, and only the parent can drain the upload before reading it.
   * Dropping it from `entries` here first would leave that upload nothing to write to.
   * No handler → no ✕ is rendered. Resolves once the photo is gone from the server as
   * well as from state — the confirm dialog holds its spinner on this promise.
   */
  onRemovePhoto?: (area: PECArea, photo: CapturedPhoto) => void | Promise<void>;
  onComplete: () => void;
  onBack: () => void;
}

/**
 * Pre-existing conditions capture.
 *
 * Documents damage that predates the crew, which is what protects the installer
 * and the company from liability. Every flagged area must carry at least one photo
 * AND a note — a photo without context is not defensible, so the step won't close
 * until both exist.
 */
export function PECStep({
  visible,
  hasConditions,
  entries,
  onSetHasConditions,
  onSetEntry,
  onPhotoCaptured,
  onRemovePhoto,
  onComplete,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const log = useInstallerActivityLog();
  const [cameraFor, setCameraFor] = useState<PECArea | null>(null);

  const flagged = Object.keys(entries);
  const totalPhotos = flagged.reduce((n, k) => n + (entries[k]?.photos.length ?? 0), 0);

  const allDocumented = useMemo(
    () =>
      flagged.length > 0 &&
      flagged.every(
        (k) => (entries[k]?.photos.length ?? 0) > 0 && (entries[k]?.note ?? '').trim().length > 0
      ),
    [flagged, entries]
  );

  const canConfirm =
    hasConditions === false || (hasConditions === true && allDocumented);

  const handleSetHasConditions = (value: boolean) => {
    log.pecAnswered(value);
    onSetHasConditions(value);
  };

  const toggleArea = (area: PECArea) => {
    const flagged = !entries[area.id];
    log.pecAreaToggled(area, flagged);
    if (flagged) onSetEntry(area.id, { areaId: area.id, note: '', photos: [] });
    else onSetEntry(area.id, null);
  };

  // The shot itself is logged by the upload hook, once S3 has answered with the
  // s3url and byte size the portal's payload needs.
  const addPhoto = (area: PECArea, photo: CapturedPhoto) => {
    const current = entries[area.id] ?? { areaId: area.id, note: '', photos: [] };
    onSetEntry(area.id, { ...current, photos: [...current.photos, photo] });
    onPhotoCaptured?.(area, photo);
  };

  /**
   * The ✕ on a condition photo — opens a confirmation, then hands off. State and the
   * server are the parent's job (see `onRemovePhoto`); this only reports it, and only
   * once the removal has actually landed.
   */
  const del = usePhotoDeleteConfirm<{
    area: PECArea;
    photo: CapturedPhoto;
    index: number;
  }>(async ({ area, photo, index }) => {
    await onRemovePhoto?.(area, photo);
    log.photoRemoved({
      step: 'pec',
      category: 'Pre-Existing Conditions',
      subcategory: `${area.label} #${index + 1}`,
      timestamp: photo.takenAt,
      coordinates: photo.coordinates,
      s3url: photo.s3url,
      bucketName: photo.bucketName,
    });
  });

  const setNote = (areaId: string, note: string) => {
    const current = entries[areaId] ?? { areaId, note: '', photos: [] };
    onSetEntry(areaId, { ...current, note });
  };

  /** Notes log on blur, not per keystroke — one entry per area, not one per letter. */
  const commitNote = (area: PECArea) => {
    const note = (entries[area.id]?.note ?? '').trim();
    if (note) log.pecNoteEntered(area, note);
  };

  const handleConfirm = () => {
    log.pecConfirmed({
      hasConditions,
      areaCount: flagged.length,
      photoCount: totalPhotos,
      areas: flagged.map(
        (id) => PEC_AREAS.find((a) => a.id === id)?.label ?? id
      ),
    });
    onComplete();
    onBack();
  };

  return (
    <InstallerSubScreen
      visible={visible}
      title={t('installer.pecTitle')}
      subtitle={t('installer.pecSub')}
      onBack={onBack}
      overlay={
        cameraFor ? (
          <InstallerCamera
            label={`${t('installer.pecTitle').toUpperCase()} • ${t(cameraFor.labelKey)}`}
            hint={t('installer.pecCameraHint')}
            count={entries[cameraFor.id]?.photos.length ?? 0}
            onCancel={() => setCameraFor(null)}
            onCapture={(photo) => addPhoto(cameraFor, photo)}
          />
        ) : undefined
      }
      footer={
        <>
          <TouchableOpacity
            disabled={!canConfirm}
            onPress={handleConfirm}
            className="h-12 rounded-xl items-center justify-center"
            style={{
              backgroundColor: canConfirm ? colors.primary.main : colors.textSecondary + '40',
            }}
          >
            <Text
              className="text-base font-bold text-center"
              style={{ color: canConfirm ? '#fff' : colors.textSecondary }}
            >
              {t('installer.pecConfirm')}
            </Text>
          </TouchableOpacity>
          {hasConditions === true && flagged.length > 0 && !allDocumented && (
            <Text
              className="text-center text-xs font-bold mt-1.5"
              style={{ color: colors.warning.dark }}
            >
              {t('installer.pecIncomplete')}
            </Text>
          )}
        </>
      }
    >
      <Text
        className="text-sm font-semibold leading-6 mb-3"
        style={{ color: colors.textSecondary }}
      >
        {t('installer.pecIntro')}
      </Text>

      {/* Answer.
          `text-center` on the labels, not just `items-center` on the buttons: the flex
          alignment centres the text BLOCK, while a label that wraps to two lines — which
          Spanish does here — still ranges its own lines left inside that block. */}
      <View className="flex-row mb-4" style={{ gap: 8 }}>
        <TouchableOpacity
          onPress={() => handleSetHasConditions(false)}
          className="flex-1 rounded-xl items-center justify-center border-2 py-3 px-2"
          style={{
            backgroundColor:
              hasConditions === false ? colors.primary.main + '10' : colors.background,
            borderColor: hasConditions === false ? colors.primary.main : colors.border,
          }}
        >
          <Text
            className="text-sm font-bold text-center"
            style={{ color: hasConditions === false ? colors.primary.main : colors.text }}
          >
            {t('installer.pecNone')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleSetHasConditions(true)}
          className="flex-1 rounded-xl items-center justify-center border-2 py-3 px-2"
          style={{
            backgroundColor:
              hasConditions === true ? colors.warning.main + '14' : colors.background,
            borderColor: hasConditions === true ? colors.warning.main : colors.border,
          }}
        >
          <Text
            className="text-sm font-bold text-center"
            style={{ color: hasConditions === true ? colors.warning.dark : colors.text }}
          >
            {t('installer.pecPresent')}
          </Text>
        </TouchableOpacity>
      </View>

      {hasConditions === false && (
        <View
          className="flex-row items-center rounded-xl p-3 border-2"
          style={{ backgroundColor: colors.primary.main + '10', borderColor: colors.primary.main }}
        >
          <View
            className="w-5 h-5 rounded-full items-center justify-center mr-2"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Icon name="check" size={12} color="#fff" />
          </View>
          <Text className="flex-1 text-sm font-semibold" style={{ color: colors.primary.main }}>
            {t('installer.pecNoneConfirmed')}
          </Text>
        </View>
      )}

      {hasConditions === true && (
        <>
          <Text className="text-base font-bold mb-2" style={{ color: colors.text }}>
            {t('installer.pecFlagAreas')}
          </Text>

          {PEC_AREAS.map((area) => {
            const entry = entries[area.id];
            const on = !!entry;
            const count = entry?.photos.length ?? 0;

            return (
              <View key={area.id}>
                <View
                  className="flex-row items-center rounded-xl p-2.5 mb-1.5 border"
                  style={{
                    backgroundColor: on ? colors.warning.main + '14' : colors.background,
                    borderColor: on ? colors.warning.main : colors.border,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => toggleArea(area)}
                    className="flex-row items-center flex-1"
                  >
                    <View
                      className="w-5 h-5 rounded-md items-center justify-center mr-2.5"
                      style={{ backgroundColor: on ? colors.warning.main : '#eceef0' }}
                    >
                      {on && <Icon name="check" size={12} color="#fff" />}
                    </View>
                    <Text
                      className="text-sm font-bold"
                      style={{ color: on ? colors.warning.dark : colors.text }}
                    >
                      {t(area.labelKey)}
                    </Text>
                  </TouchableOpacity>

                  {on && (
                    <TouchableOpacity
                      onPress={() => setCameraFor(area)}
                      className="rounded-lg px-2.5 py-1.5 flex-row items-center"
                      style={{
                        backgroundColor: count > 0 ? colors.primary.main : colors.info.main,
                      }}
                    >
                      <Icon name={count > 0 ? 'check' : 'camera'} size={12} color="#fff" />
                      <Text className="text-white text-xs font-bold ml-1">
                        {count === 0
                          ? t('installer.pecAddPhoto')
                          : count === 1
                          ? t('installer.pecPhotosAdd', { count })
                          : t('installer.pecPhotosAddPlural', { count })}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {on && (
                  <>
                    {count > 0 && (
                      <View className="flex-row flex-wrap mb-1.5" style={{ gap: 6 }}>
                        {entry!.photos.map((p, i) => (
                          <View key={p.id}>
                            <Image
                              source={{ uri: p.uri }}
                              className="rounded-lg"
                              style={{ width: 52, height: 52, backgroundColor: '#26364a' }}
                            />
                            {!!onRemovePhoto && (
                              <TouchableOpacity
                                onPress={() => del.request({ area, photo: p, index: i })}
                                // The tile is 52 px, so the ✕ is smaller than the
                                // material step's and sits tight to the corner; the
                                // hitSlop keeps it thumb-sized on a roof regardless.
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full items-center justify-center"
                                style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                              >
                                <Icon name="close" size={11} color="#fff" />
                              </TouchableOpacity>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                    <TextInput
                      value={entry!.note}
                      onChangeText={(t) => setNote(area.id, t)}
                      onBlur={() => commitNote(area)}
                      placeholder={t('installer.pecNotePlaceholder')}
                      placeholderTextColor="#919EAB"
                      // ⚠️ A TextInput with no `font-*` class gets NO fontFamily from this
                      // tailwind config, so the note rendered in the SYSTEM font while every
                      // label around it was Public Sans — the one thing on this screen that
                      // did. `font-semibold` puts it back on the same face as its own row.
                      className="rounded-lg px-2.5 py-2.5 text-sm font-semibold mb-2"
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        color: colors.text,
                        backgroundColor: colors.background,
                      }}
                    />
                  </>
                )}
              </View>
            );
          })}

          {flagged.length > 0 && (
            <Text
              className="text-xs font-semibold mt-1"
              style={{ color: colors.textSecondary }}
            >
              {flagged.length === 1
                ? t('installer.pecSummaryOne', {
                    areas: flagged.length,
                    photos: totalPhotos,
                  })
                : t('installer.pecSummaryMany', {
                    areas: flagged.length,
                    photos: totalPhotos,
                  })}
            </Text>
          )}
        </>
      )}

      <ConfirmActionModal
        visible={del.visible}
        icon="image-remove"
        tone="danger"
        title={t('installer.deletePhotoTitle')}
        description={t('installer.pecDeleteBody', {
          area: del.target ? t(del.target.area.labelKey) : t('installer.pecTitle'),
        })}
        confirmLabel={t('installer.delete')}
        cancelLabel={t('installer.keep')}
        submitting={del.deleting}
        onCancel={del.cancel}
        onConfirm={del.confirm}
      />
    </InstallerSubScreen>
  );
}
