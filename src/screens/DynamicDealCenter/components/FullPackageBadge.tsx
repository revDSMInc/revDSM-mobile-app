import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Dimensions, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FULL_PACKAGE_INCLUDES } from '../utils/tab-naming';

/**
 * The package badge that replaces a full-package calculator's derived
 * `G+VMax+Versa+S+FWrap` name, plus the card listing what it stands for.
 *
 * Shared because the name is printed in FOUR places and every one of them has to
 * agree: the calculator step's footer tab, its locked receipt heading, the rollout
 * step's top strip, and the quote card heading. Whether a calculator IS a package is
 * decided in one place too — `isFullPackageSelection` (`utils/tab-naming.ts`) — so
 * the rule and its rendering each have a single home.
 *
 * (`HorizontalDraggableTabs` renders its own copy of the icon pair rather than
 * importing this: it is a shared `widgets/` component and must not depend on a
 * screen. It takes the already-computed `isFullPackage` flag instead.)
 */

/** Screen-space box of the ⓘ that was tapped, so the card can open beneath it. */
export interface PackageAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The calculator's name, or the package icon + ⓘ when it is a full package. */
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
  /**
   * Tab keys the package does not account for (`describeFullPackage().extras`).
   * Rendered as `+Light` beside the icon, so a duplicated package with a product
   * added to it never looks identical to the plain package it came from.
   */
  extras?: string;
  /** Font size of the name; the icons scale with it so they sit on the same line. */
  size: number;
  /** Weight of the NAME (the icons don't have one). Tab labels are 900; the
   *  Sale/Demo chooser's heading is 600, and must not be bolded by adopting this. */
  weight?: any;
  color: string;
  iconColor?: string;
  infoColor?: string;
  /** Receives the ⓘ's on-screen box — pass it to `FullPackageInfoModal.anchorRect`. */
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

  // Icons track the text size they stand in for, so a 20pt receipt heading and a
  // 14pt card heading both stay optically balanced with their neighbours.
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

/**
 * Measure a tapped ⓘ in WINDOW space and hand the box to the caller.
 *
 * Window space (not parent space) because the card renders inside a `Modal`, which is
 * its own full-screen host — parent-relative coordinates would place it against the
 * wrong origin. Exported so `HorizontalDraggableTabs`, which draws its own icon pair,
 * reports an anchor in exactly the same frame of reference.
 *
 * `measureInWindow` can fire back with zeros for a view that is mid-layout; the caller
 * gets `null` for that, and the card falls back to centring itself rather than pinning
 * to the top-left corner.
 */
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

/**
 * Scrim + the contents card, positioned JUST BELOW the icon that was tapped, WITHOUT
 * a `Modal` wrapper.
 *
 * This is the form used inside an already-open modal (the Sale/Demo chooser), because
 * stacking native modals is unreliable on both platforms — the same reason the funding
 * flow's `SendLinkModal` is an in-sheet overlay. Render it as the LAST child of the
 * host modal's full-screen root so it covers the sheet, and give the host root
 * window-space coordinates to measure against.
 *
 * The card was originally pinned to a fixed screen edge per screen, which read as
 * "wrong card" when the tapped ⓘ was at the other end of the screen — a receipt
 * heading is at the top, its footer tab at the bottom, and one fixed anchor cannot
 * serve both. It follows the anchor it is given.
 */
export function FullPackageInfoOverlay({
  onClose,
  anchorRect,
}: {
  onClose: () => void;
  /** Where the tapped ⓘ is on screen. `null` → the card centres itself. */
  anchorRect?: PackageAnchorRect | null;
}) {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const cardWidth = Math.min(CARD_MAX_WIDTH, screenW - SCREEN_MARGIN * 2);
  // Height is estimated rather than measured: measuring means rendering once at the
  // wrong place and moving, which reads as a flinch. The card's content is fixed
  // (a header plus one row per item), so the estimate is exact enough to decide
  // whether it fits below the icon.
  const estimatedHeight = 34 + 28 + FULL_PACKAGE_INCLUDES.length * 26;

  let position: any = { alignSelf: 'center', marginTop: Math.max(SCREEN_MARGIN, (screenH - estimatedHeight) / 2) };
  if (anchorRect) {
    const below = anchorRect.y + anchorRect.height + ANCHOR_GAP;
    // Flip above the icon when there isn't room beneath it — otherwise the card
    // would hang off the bottom of the screen with its bullets unreachable.
    const fitsBelow = below + estimatedHeight <= screenH - SCREEN_MARGIN;
    const top = fitsBelow ? below : Math.max(SCREEN_MARGIN, anchorRect.y - ANCHOR_GAP - estimatedHeight);
    // Left-align to the icon, then clamp so the card never leaves the screen — the
    // ⓘ can sit anywhere from the far left of a tab strip to the right edge of a card.
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

/**
 * The overlay above, in its own `Modal` — the form used by a screen that is NOT
 * already inside one (the calculator step and the rollout step).
 */
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
