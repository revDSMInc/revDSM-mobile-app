import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { InstallerCamera } from '../../../widgets/components/installer/InstallerCamera';
import { PEC_AREAS } from '../../../constants/installer';
import type { CapturedPhoto, PECArea, PECEntry } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  hasConditions: boolean | null;
  entries: Record<string, PECEntry>;
  onSetHasConditions: (value: boolean | null) => void;
  onSetEntry: (areaId: string, entry: PECEntry | null) => void;
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
  onComplete,
  onBack,
}: Props) {
  const { colors } = useTheme();
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

  const toggleArea = (area: PECArea) => {
    if (entries[area.id]) onSetEntry(area.id, null);
    else onSetEntry(area.id, { areaId: area.id, note: '', photos: [] });
  };

  const addPhoto = (areaId: string, photo: CapturedPhoto) => {
    const current = entries[areaId] ?? { areaId, note: '', photos: [] };
    onSetEntry(areaId, { ...current, photos: [...current.photos, photo] });
  };

  const setNote = (areaId: string, note: string) => {
    const current = entries[areaId] ?? { areaId, note: '', photos: [] };
    onSetEntry(areaId, { ...current, note });
  };

  const handleConfirm = () => {
    onComplete();
    onBack();
  };

  return (
    <InstallerSubScreen
      visible={visible}
      title="Pre-Existing Conditions"
      subtitle="Document site conditions before starting work"
      onBack={onBack}
      overlay={
        cameraFor ? (
          <InstallerCamera
            label={`CONDITION • ${cameraFor.label}`}
            hint="Photo the pre-existing damage or condition"
            count={entries[cameraFor.id]?.photos.length ?? 0}
            onCancel={() => setCameraFor(null)}
            onCapture={(photo) => addPhoto(cameraFor.id, photo)}
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
              className="text-base font-bold"
              style={{ color: canConfirm ? '#fff' : colors.textSecondary }}
            >
              Confirm Pre-Existing Conditions
            </Text>
          </TouchableOpacity>
          {hasConditions === true && flagged.length > 0 && !allDocumented && (
            <Text
              className="text-center text-[11px] font-bold mt-1.5"
              style={{ color: colors.warning.dark }}
            >
              Every flagged area needs at least one photo and a note
            </Text>
          )}
        </>
      }
    >
      <Text
        className="text-xs font-semibold leading-5 mb-3"
        style={{ color: colors.textSecondary }}
      >
        Review the work site before starting. Documented conditions protect you and the
        company from liability for damage that existed before the crew arrived.
      </Text>

      {/* Answer */}
      <View className="flex-row mb-4" style={{ gap: 8 }}>
        <TouchableOpacity
          onPress={() => onSetHasConditions(false)}
          className="flex-1 rounded-xl items-center justify-center border-2 py-3"
          style={{
            backgroundColor:
              hasConditions === false ? colors.primary.main + '10' : colors.background,
            borderColor: hasConditions === false ? colors.primary.main : colors.border,
          }}
        >
          <Text
            className="text-[13px] font-bold"
            style={{ color: hasConditions === false ? colors.primary.main : colors.text }}
          >
            No Conditions Found
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onSetHasConditions(true)}
          className="flex-1 rounded-xl items-center justify-center border-2 py-3"
          style={{
            backgroundColor:
              hasConditions === true ? colors.warning.main + '14' : colors.background,
            borderColor: hasConditions === true ? colors.warning.main : colors.border,
          }}
        >
          <Text
            className="text-[13px] font-bold"
            style={{ color: hasConditions === true ? colors.warning.dark : colors.text }}
          >
            Conditions Present
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
          <Text className="flex-1 text-xs font-semibold" style={{ color: colors.primary.main }}>
            Site reviewed — no pre-existing conditions to report.
          </Text>
        </View>
      )}

      {hasConditions === true && (
        <>
          <Text className="text-[13px] font-bold mb-2" style={{ color: colors.text }}>
            Flag affected areas — each needs a photo and a note
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
                      className="text-[13px] font-bold"
                      style={{ color: on ? colors.warning.dark : colors.text }}
                    >
                      {area.label}
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
                      <Text className="text-white text-[11px] font-bold ml-1">
                        {count > 0 ? `${count} photo${count > 1 ? 's' : ''} · add` : 'Add Photo'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {on && (
                  <>
                    {count > 0 && (
                      <View className="flex-row flex-wrap mb-1.5" style={{ gap: 6 }}>
                        {entry!.photos.map((p) => (
                          <Image
                            key={p.id}
                            source={{ uri: p.uri }}
                            className="rounded-lg"
                            style={{ width: 52, height: 52, backgroundColor: '#26364a' }}
                          />
                        ))}
                      </View>
                    )}
                    <TextInput
                      value={entry!.note}
                      onChangeText={(t) => setNote(area.id, t)}
                      placeholder="Describe the condition — e.g. crack near garage, ~3 ft"
                      placeholderTextColor="#919EAB"
                      className="rounded-lg px-2.5 py-2 text-xs mb-2"
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
              className="text-[11px] font-semibold mt-1"
              style={{ color: colors.textSecondary }}
            >
              {flagged.length} area{flagged.length > 1 ? 's' : ''} flagged · {totalPhotos} photo
              {totalPhotos === 1 ? '' : 's'}
            </Text>
          )}
        </>
      )}

    </InstallerSubScreen>
  );
}
