import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Dimensions, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FULL_PACKAGE_INCLUDES } from '../utils/tab-naming';

export interface PackageAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function FullPackageTitle({
  isFullPackage,
  title,
  extras,
  size,
  weight = '900',
  color,
  iconColor,
  infoColor,
  onInfo,
  style,
}: {
  isFullPackage: boolean;
  title?: string;
  extras?: string;
  size: number;
  weight?: any;
  color: string;
  iconColor?: string;
  infoColor?: string;
  onInfo?: (rect: PackageAnchorRect | null) => void;
  style?: any;
}) {
  const infoRef = useRef<View>(null);

  if (!isFullPackage) {
    return (
      <Text numberOfLines={1} style={[{ fontSize: size, fontWeight: weight, color }, style]}>
        {title || ''}
      </Text>
    );
  }

  const glyph = Math.max(16, Math.round(size * 1.15));
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
      <Ionicons name="cube" size={glyph} color={iconColor || color} />
      {!!extras && (
        <Text
          numberOfLines={1}
          style={{ fontSize: size, fontWeight: weight, color, marginLeft: 4, flexShrink: 1 }}
        >
          +{extras}
        </Text>
      )}
      <TouchableOpacity
        ref={infoRef}
        onPress={() => measureAnchor(infoRef, onInfo)}
        style={{ marginLeft: 8 }}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="What the full package includes"
      >
        <Ionicons name="information-circle" size={glyph} color={infoColor || '#00B8D9'} />
      </TouchableOpacity>
    </View>
  );
}

export function measureAnchor(
  ref: React.RefObject<any>,
  onMeasured?: (rect: PackageAnchorRect | null) => void
) {
  if (!onMeasured) return;
  const node = ref.current;
  if (!node?.measureInWindow) {
    onMeasured(null);
    return;
  }
  node.measureInWindow((x: number, y: number, width: number, height: number) => {
    onMeasured(width && height ? { x, y, width, height } : null);
  });
}

const CARD_MAX_WIDTH = 320;
const SCREEN_MARGIN = 16;
const ANCHOR_GAP = 8;

export function FullPackageInfoOverlay({
  onClose,
  anchorRect,
}: {
  onClose: () => void;
  anchorRect?: PackageAnchorRect | null;
}) {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const cardWidth = Math.min(CARD_MAX_WIDTH, screenW - SCREEN_MARGIN * 2);
  const estimatedHeight = 34 + 28 + FULL_PACKAGE_INCLUDES.length * 26;

  let position: any = { alignSelf: 'center', marginTop: Math.max(SCREEN_MARGIN, (screenH - estimatedHeight) / 2) };
  if (anchorRect) {
    const below = anchorRect.y + anchorRect.height + ANCHOR_GAP;
    const fitsBelow = below + estimatedHeight <= screenH - SCREEN_MARGIN;
    const top = fitsBelow ? below : Math.max(SCREEN_MARGIN, anchorRect.y - ANCHOR_GAP - estimatedHeight);
    const left = Math.min(
      Math.max(SCREEN_MARGIN, anchorRect.x - 12),
      Math.max(SCREEN_MARGIN, screenW - cardWidth - SCREEN_MARGIN)
    );
    position = { position: 'absolute', top, left };
  }

  return (
    <Pressable
      style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15,23,42,0.35)' }]}
      onPress={onClose}
    >
      {/* Inner Pressable swallows the tap so pressing the card doesn't dismiss it. */}
      <Pressable
          style={[
            {
              width: cardWidth,
              backgroundColor: '#fff',
              borderRadius: 16,
              paddingHorizontal: 18,
              paddingTop: 16,
              paddingBottom: 18,
              borderWidth: 1,
              borderColor: '#DFE3E8',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.18,
              shadowRadius: 20,
              elevation: 12,
            },
            position,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Ionicons name="cube" size={18} color="#B45309" style={{ marginRight: 8 }} />
            <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: '#1C252E' }}>
              Full Package Includes:
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={18} color="#94A3B8" />
            </TouchableOpacity>
          </View>
          {FULL_PACKAGE_INCLUDES.map((item) => (
            <View key={item} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontSize: 14, color: '#637381', marginRight: 8 }}>•</Text>
              <Text style={{ fontSize: 14, color: '#637381' }}>{item}</Text>
            </View>
          ))}
      </Pressable>
    </Pressable>
  );
}

export function FullPackageInfoModal({
  visible,
  onClose,
  anchorRect,
}: {
  visible: boolean;
  onClose: () => void;
  anchorRect?: PackageAnchorRect | null;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <FullPackageInfoOverlay onClose={onClose} anchorRect={anchorRect} />
    </Modal>
  );
}
