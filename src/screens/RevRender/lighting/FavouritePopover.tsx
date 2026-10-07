import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export interface PopoverAnchor {
  lookId: string;
  x: number;
  y: number;
  bottom: number;
}

const PILL_BG = '#141C24';
const STAR = '#FFC53D';

const PILL_HEIGHT = 40;
const GAP = 10;
const HALF_WIDTH = 62;
const EDGE = 12;
const TOP_LIMIT = 90;

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

  const above = anchor.y - PILL_HEIGHT - GAP;
  const top = above < TOP_LIMIT ? anchor.bottom + GAP : above;

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
