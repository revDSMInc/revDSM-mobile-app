import React, { useRef } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Look } from '../../../utils/revrender-lighting/types';
import { LightStrip } from './LightStrip';

const GREEN = '#2EDE56';

/**
 * Three per row, not four.
 *
 * ⚠️ The grid padding in `LightingPanel` must use the SAME number — import
 * these rather than retyping a percentage, or a partial row silently spreads
 * across the full width and stops lining up with the grid above it.
 */
export const TILE_COLUMNS = 3;
export const TILE_WIDTH = '31%';

/**
 * One look in a grid. Selected state must match everywhere the same look
 * appears — Quick picks, its own tab, and the selected box — so it is driven by
 * id from one piece of state rather than held locally.
 */
export function LookTile({
  look,
  selected,
  favourite,
  tag,
  isDark,
  onPress,
  onLongPress,
}: {
  look: Look;
  selected: boolean;
  favourite?: boolean;
  tag?: 'now' | 'next' | null;
  isDark: boolean;
  onPress: () => void;
  /**
   * Hold reports WHERE the tile is, in window coordinates, so the caller can
   * anchor the Favorite bubble to it — it does not toggle anything itself.
   */
  onLongPress?: (frame: { x: number; y: number; bottom: number }) => void;
}) {
  const ref = useRef<View>(null);

  const reportFrame = () => {
    if (!onLongPress) return;
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Centre-x and both edges: the popover prefers to sit above the tile and
      // flips below it near the top of the screen.
      onLongPress({ x: x + width / 2, y, bottom: y + height });
    });
  };

  return (
    <TouchableOpacity
      ref={ref}
      onPress={onPress}
      onLongPress={reportFrame}
      // 483 §3: hold 450ms to favourite. Below the RN default of 500.
      delayLongPress={450}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={look.name}
      accessibilityState={{ selected }}
      // 44pt minimum tap target (483 §11).
      style={{ width: TILE_WIDTH, minHeight: 44, marginBottom: 14 }}
    >
      {/*
        ⚠️ Every badge is positioned against THIS box, not the outer
        TouchableOpacity — which also contains the name label below. Anchored
        to the outer element, `bottom` lands on the text instead of the strip.
      */}
      <View
        className="rounded-[14px] overflow-hidden border-2"
        style={{ borderColor: selected ? GREEN : 'transparent' }}
      >
        {/*
          ⚠️ ONE row of pucks, explicitly — `LightStrip` defaults to two.
          A look is a single run of lights along a roofline, so two stacked
          rows misdescribe the product, and in a tile this wide they also
          crowd the panel until the colours stop being readable at a glance.
        */}
        <LightStrip colors={look.colors} rows={1} pucks={7} height={64} radius={12} />

        {/*
          ⚠️ INSIDE the corner, not hanging off it. Floating the tick outside
          (`top:-6 right:-6`) overlapped the neighbouring tile in a 3-up grid,
          and `overflow-hidden` on this box would now clip it entirely.
        */}
        {selected && (
          <View
            className="absolute items-center justify-center rounded-full"
            style={{ top: 5, right: 5, width: 20, height: 20, backgroundColor: GREEN }}
          >
            <Icon name="check" size={13} color="#fff" />
          </View>
        )}

        {favourite && !selected && (
          <View className="absolute" style={{ top: 5, left: 6 }}>
            <Icon name="star" size={13} color="#FFC94D" />
          </View>
        )}

        {/*
          NOW / NEXT sit BOTTOM-LEFT on the dark strip, as a light pill: they
          label the strip, so they belong on it, and bottom-left is the one
          corner that never collides with the tick or the favourite star.
          NOW is solid white (it is the live one); NEXT is a translucent wash,
          so the pair reads as a hierarchy rather than two equal labels.
        */}
        {tag && (
          <View
            className="absolute rounded-full px-2 py-[2px]"
            style={{ bottom: 5, left: 5, backgroundColor: tag === 'now' ? '#fff' : 'rgba(255,255,255,0.25)' }}
          >
            <Text
              className="text-[9px] font-black"
              style={{ color: tag === 'now' ? '#161C24' : '#fff' }}
            >
              {tag === 'now' ? 'NOW' : 'NEXT'}
            </Text>
          </View>
        )}
      </View>

      <Text
        numberOfLines={2}
        className="text-[11px] font-bold mt-1.5 text-center"
        style={{ color: selected ? (isDark ? '#fff' : '#212B36') : (isDark ? '#919EAB' : '#637381') }}
      >
        {look.name}
      </Text>
    </TouchableOpacity>
  );
}
