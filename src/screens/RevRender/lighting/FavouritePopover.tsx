import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/** Where the popover should appear, in window coordinates. */
export interface PopoverAnchor {
  lookId: string;
  /** Centre of the tile, horizontally. */
  x: number;
  /** Top edge of the tile. */
  y: number;
  /** Bottom edge of the tile — used when there is no room above. */
  bottom: number;
}

const PILL_BG = '#141C24';
const STAR = '#FFC53D';

/** Measured from the mock: a 40pt pill, so this is its height plus a small gap. */
const PILL_HEIGHT = 40;
const GAP = 10;
/** Roughly half the pill's width, for centring before it has been laid out. */
const HALF_WIDTH = 62;
/** Keep the pill clear of the screen edges and the header. */
const EDGE = 12;
const TOP_LIMIT = 90;

/**
 * The "Favorite" / "Unfavorite" bubble raised by holding a look tile (483 §3).
 *
 * ⚠️ Holding a tile does NOT toggle the favourite directly. The mock raises
 * this pill and the rep taps it to confirm. A hold that silently changed state
 * is both undiscoverable — nothing says the gesture exists — and unforgiving,
 * since an accidental hold would alter the rep's list with no way back.
 *
 * ⚠️ In a `Modal` so it floats above the scroll view and the bordered card.
 * Rendered inline it is clipped by the card's `overflow-hidden`, and it scrolls
 * away from the tile it belongs to.
 */
export function FavouritePopover({
  anchor,
  isFavourite,
  screenWidth,
  onToggle,
  onClose,
}: {
  anchor: PopoverAnchor | null;
  isFavourite: boolean;
  screenWidth: number;
  onToggle: () => void;
  onClose: () => void;
}) {
  if (!anchor) return null;

  // Above the tile by preference; below it when that would run under the header.
  const above = anchor.y - PILL_HEIGHT - GAP;
  const top = above < TOP_LIMIT ? anchor.bottom + GAP : above;

  // Centre on the tile, then keep the whole pill on screen.
  const left = Math.max(
    EDGE,
    Math.min(screenWidth - HALF_WIDTH * 2 - EDGE, anchor.x - HALF_WIDTH),
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* Any tap outside dismisses — the way out of a menu you opened by accident. */}
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Dismiss">
        <View
          className="absolute flex-row rounded-full overflow-hidden"
          style={{
            top,
            left,
            backgroundColor: PILL_BG,
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
        >
          <TouchableOpacity
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={isFavourite ? 'Unfavorite' : 'Favorite'}
            className="flex-row items-center"
            style={{ height: PILL_HEIGHT, paddingLeft: 12, paddingRight: 16 }}
          >
            <Icon name={isFavourite ? 'star' : 'star-outline'} size={18} color={STAR} />
            <Text className="text-[14px] font-bold ml-2" style={{ color: '#fff' }}>
              {isFavourite ? 'Unfavorite' : 'Favorite'}
            </Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}
