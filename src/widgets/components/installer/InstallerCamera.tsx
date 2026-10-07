import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { footerBottomPadding } from '../../../utils/installer-insets';
import { GhostSlider } from './GhostSlider';
import type { CapturedPhoto } from '../../../config/types/installer';

const GREEN = '#4CBB17';

export interface InstallerCameraProps {
  label: string;
  hint?: string;
  count?: number;
  ghostUri?: string | null;
  withGhost?: boolean;
  compareLabels?: { left: string; right: string };
  onCancel: () => void;
  onCapture: (photo: CapturedPhoto) => void;
}

export function InstallerCamera({
  label,
  hint,
  count = 0,
  ghostUri,
  withGhost = false,
  compareLabels,
  onCancel,
  onCapture,
}: InstallerCameraProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const cameraRef = useRef<Camera>(null);
  const device = useCameraDevice('back');

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [ghostOpacity, setGhostOpacity] = useState(0.35);
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    (async () => {
      const status = await Camera.getCameraPermissionStatus();
      if (status === 'granted') return setHasPermission(true);
      const requested = await Camera.requestCameraPermission();
      setHasPermission(requested === 'granted');
    })();
  }, []);

  const takePhoto = async () => {
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current!.takePhoto({ flash: 'off' });
      setCaptured(`file://${photo.path}`);
    } catch {
      setCaptured('https://picsum.photos/800/600');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleUse = () => {
    if (!captured) return;
    onCapture({
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      uri: captured,
      takenAt: new Date().toISOString(),
    });
    setCaptured(null);
  };

  const hasGhost = withGhost && !!ghostUri;

  const renderGhost = (opacity: number) =>
    ghostUri ? (
      <Image
        source={{ uri: ghostUri }}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { opacity }]}
      />
    ) : null;

  if (captured) {
    const showCompare = !!compareLabels && !!ghostUri;

    return (
      <View style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top + 12 }]}>
        <Text className="text-white text-base font-bold px-4 mb-1">
          {showCompare ? 'Compare' : 'Review'} — {label}
        </Text>
        {showCompare && (
          <Text className="text-[#8b93a0] text-xs font-medium px-4 mb-3">
            Same vantage point and framing? Good enough — the scene is supposed to have
            changed.
          </Text>
        )}

        {showCompare && compareLabels ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4, gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            <View>
              <Text className="text-xs font-bold mb-2 tracking-widest" style={{ color: GREEN }}>
                {compareLabels.left}
              </Text>
              {/* A fixed 4:3 frame, not `flex-1`: a flex child inside a ScrollView has no
                  height to fill, so both photos would collapse to nothing. */}
              <View
                className="rounded-2xl overflow-hidden bg-[#1a2432]"
                style={styles.comparePane}
              >
                {renderGhost(0.9)}
              </View>
            </View>
            <View>
              <Text className="text-xs font-bold mb-2 tracking-widest text-white">
                {compareLabels.right}
              </Text>
              <View
                className="rounded-2xl overflow-hidden bg-[#26364a]"
                style={styles.comparePane}
              >
                <Image
                  source={{ uri: captured }}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>
          </ScrollView>
        ) : (
          <View className="flex-1 mx-4 rounded-2xl overflow-hidden bg-[#26364a]">
            <Image source={{ uri: captured }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          </View>
        )}

        <View
          className="flex-row px-4 pt-3"
          style={{ gap: 12, paddingBottom: footerBottomPadding(insets.bottom) }}
        >
          <TouchableOpacity
            onPress={() => setCaptured(null)}
            className="flex-1 h-12 rounded-xl items-center justify-center bg-white/10"
          >
            <Text className="text-white text-base font-bold">{t('installer.retake')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleUse}
            className="flex-1 h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: GREEN }}
          >
            <Text className="text-white text-base font-bold">
              {showCompare ? t('common.confirm') : t('installer.usePhoto')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={styles.viewfinder}>
        {hasPermission && device ? (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            photo
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
            {hasPermission === false ? (
              <Text className="text-white text-sm font-semibold px-8 text-center">
                Camera permission is required to capture install photos.
              </Text>
            ) : (
              <ActivityIndicator color={GREEN} />
            )}
          </View>
        )}

        {hasGhost && renderGhost(peeking ? 0.85 : ghostOpacity)}

        <View style={[styles.topChip, { top: insets.top + 12 }]} pointerEvents="none">
          <Text className="text-white text-xs font-bold">{label}</Text>
        </View>

        <TouchableOpacity
          onPress={onCancel}
          style={[styles.closeBtn, { top: insets.top + 8 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="close" size={20} color="#fff" />
        </TouchableOpacity>

        {count > 0 && (
          <View style={[styles.countChip, { top: insets.top + 12 }]} pointerEvents="none">
            <Text className="text-[#0e1c16] text-xs font-bold">{count} taken</Text>
          </View>
        )}

        {!!hint && (
          <Text style={styles.hint} className="text-xs font-semibold">
            {hasGhost ? 'Line up the ghost with the house' : hint}
          </Text>
        )}
      </View>

      {/* Controls */}
      <View
        className="px-6 pt-4"
        style={{ paddingBottom: footerBottomPadding(insets.bottom) }}
      >
        {hasGhost && (
          <View className="flex-row items-center mb-2">
            <Text className="text-[#8b93a0] text-[11px] font-bold w-12">
              {t('installer.ghost')}
            </Text>
            <GhostSlider value={ghostOpacity} onChange={setGhostOpacity} />
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <View style={{ width: 92 }} />
          <TouchableOpacity
            onPress={takePhoto}
            disabled={isCapturing}
            style={styles.shutter}
          >
            {isCapturing ? <ActivityIndicator color={GREEN} /> : null}
          </TouchableOpacity>
          {hasGhost ? (
            <TouchableOpacity
              onPressIn={() => setPeeking(true)}
              onPressOut={() => setPeeking(false)}
              style={styles.peekBtn}
            >
              <Text className="text-white text-[11px] font-bold text-center">
                Hold: Rep Photo
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 92 }} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0c1118', zIndex: 9999 },
  comparePane: { aspectRatio: 4 / 3 },
  viewfinder: { flex: 1, overflow: 'hidden', backgroundColor: '#1a2432' },
  noCamera: { alignItems: 'center', justifyContent: 'center' },
  topChip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  countChip: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(125,219,70,0.9)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
  },
  closeBtn: {
    position: 'absolute',
    left: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.75)',
  },
  shutter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    borderWidth: 5,
    borderColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekBtn: {
    width: 92,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    ...Platform.select({ ios: {}, android: {} }),
  },
});
