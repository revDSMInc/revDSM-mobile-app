import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { GhostSlider } from './GhostSlider';
import { HouseGhost } from './HouseGhost';
import type { CapturedPhoto } from '../../../config/types/installer';

const GREEN = '#4CBB17';

export interface InstallerCameraProps {
  /** Chip shown at the top of the viewfinder, e.g. "PRE • Back-Left". */
  label: string;
  hint?: string;
  /** "N taken" badge for multi-shot hubs. */
  count?: number;
  /**
   * Reference shot to ghost over the viewfinder. When undefined the placeholder
   * line-art house is used instead (no rep photos from the API yet).
   */
  ghostUri?: string | null;
  /** Show the ghost overlay + opacity slider + hold-to-peek control. */
  withGhost?: boolean;
  /** Side-by-side review after capture instead of a single preview. */
  compareLabels?: { left: string; right: string };
  onCancel: () => void;
  onCapture: (photo: CapturedPhoto) => void;
}

/**
 * Full-screen capture surface for the installer flow.
 *
 * Two modes:
 *  - plain (material / CoC / PEC / extras): capture → preview → Use or Retake
 *  - ghost (`withGhost`): the rep's shot is underlaid at adjustable opacity so the
 *    installer can line up the same vantage point, then review side-by-side.
 */
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
      // Simulators have no camera — fall back to a stand-in so the flow stays
      // reviewable. Mirrors CustomCameraModal's behaviour.
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

  const renderGhost = (opacity: number) =>
    ghostUri ? (
      <Image
        source={{ uri: ghostUri }}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { opacity }]}
      />
    ) : (
      <HouseGhost opacity={opacity} />
    );

  // ── Review ────────────────────────────────────────────────────────────────
  if (captured) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top + 12 }]}>
        <Text className="text-white text-base font-bold px-4 mb-1">
          {compareLabels ? 'Compare' : 'Review'} — {label}
        </Text>
        {compareLabels && (
          <Text className="text-[#8b93a0] text-xs font-medium px-4 mb-3">
            Same vantage point and framing? Good enough — the scene is supposed to have
            changed.
          </Text>
        )}

        {compareLabels ? (
          <View className="flex-1 flex-row px-4" style={{ gap: 12 }}>
            <View className="flex-1">
              <Text className="text-xs font-bold mb-2 tracking-widest" style={{ color: GREEN }}>
                {compareLabels.left}
              </Text>
              <View className="flex-1 rounded-2xl overflow-hidden bg-[#1a2432]">
                {renderGhost(0.9)}
              </View>
            </View>
            <View className="flex-1">
              <Text className="text-xs font-bold mb-2 tracking-widest text-white">
                {compareLabels.right}
              </Text>
              <View className="flex-1 rounded-2xl overflow-hidden bg-[#26364a]">
                <Image
                  source={{ uri: captured }}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>
          </View>
        ) : (
          <View className="flex-1 mx-4 rounded-2xl overflow-hidden bg-[#26364a]">
            <Image source={{ uri: captured }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          </View>
        )}

        <View
          className="flex-row px-4 pt-3"
          style={{ gap: 12, paddingBottom: Math.max(insets.bottom, 20) }}
        >
          <TouchableOpacity
            onPress={() => setCaptured(null)}
            className="flex-1 h-12 rounded-xl items-center justify-center bg-white/10"
          >
            <Text className="text-white text-base font-bold">Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleUse}
            className="flex-1 h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: GREEN }}
          >
            <Text className="text-white text-base font-bold">
              {compareLabels ? 'Confirm' : 'Use Photo'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Viewfinder ────────────────────────────────────────────────────────────
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

        {withGhost && renderGhost(peeking ? 0.85 : ghostOpacity)}

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
            {withGhost ? 'Line up the ghost with the house' : hint}
          </Text>
        )}
      </View>

      {/* Controls */}
      <View
        className="px-6 pt-4"
        style={{ paddingBottom: Math.max(insets.bottom, 20) }}
      >
        {withGhost && (
          <View className="flex-row items-center mb-2">
            <Text className="text-[#8b93a0] text-[11px] font-bold w-12">Ghost</Text>
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
          {withGhost ? (
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
