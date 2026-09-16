import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * The slide's top overlay: a round ✕ on the left, the page count on the right.
 *
 * Ticket: *"add the cross button and the page number on the top in this format when the
 * app is in full screen mode or normal mode."*
 *
 * ONE component for all three surfaces — fullscreen landscape, fullscreen portrait and
 * the inline card — because the same two controls had three different treatments before
 * this (a plain `2 / 77` pill and a `contract` icon in landscape, a flow row in portrait,
 * a green `1 of 8` chip and a "Back to Map" button inline) and they had already drifted.
 *
 * ⚠️ Only `onClose` differs by surface, and it is the caller's to decide: fullscreen
 * LEAVES fullscreen, the inline card leaves the pitch book. Both are "get me out of
 * here", which is why one glyph serves both.
 */

interface Props {
  current: number;
  total: number;
  onClose?: () => void;
  /** Accessible name for the ✕, since the glyph alone does not say where it goes. */
  closeLabel?: string;
  /**
   * ⚠️ False on a surface that already has a way out. The INLINE card sits under the
   * screen's own back arrow and beside a "Back to Map" button, so a third exit on the
   * slide was a control with nothing of its own to do.
   */
  showClose?: boolean;
  /**
   * Sized for a small slide rather than a full screen.
   *
   * ⚠️ The pill is deliberately prominent in fullscreen — it has to be read from across a
   * customer's living room — and that same size on the inline 4:3 card reads as an
   * oversized box sitting on a thumbnail.
   */
  compact?: boolean;
  top: number;
  left: number;
  right: number;
}

export function PresentationTopBar({
  current,
  total,
  onClose,
  closeLabel = 'Close',
  showClose = true,
  compact = false,
  top,
  left,
  right,
}: Props) {
  const withClose = showClose && !!onClose;
  return (
    /**
     * ⚠️ `pointerEvents="box-none"` on the row. It spans the full width across the top of
     * the slide, and without this it would swallow every tap and pinch that lands between
     * the two controls — including the centre tap that toggles this very chrome.
     */
    <View
      // ⚠️ With no ✕ there is only ONE child, and `space-between` would park it on the
      // LEFT. The count belongs on the right on every surface.
      style={[styles.row, !withClose && styles.rowEndOnly, { top, left, right }]}
      pointerEvents="box-none"
    >
      {withClose && (
      <TouchableOpacity
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        activeOpacity={0.85}
        // Generous hit slop: the glyph is small and the corner of a slide is exactly
        // where a rep reaches while holding the device one-handed.
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={[styles.close, compact && styles.closeCompact]}
      >
        <Icon name="close" size={compact ? 18 : 22} color="#fff" />
      </TouchableOpacity>
      )}

      <View style={[styles.pill, compact && styles.pillCompact]}>
        {/*
          Two Texts in one line, not one string: the design weights the CURRENT page and
          dims the total, which is what makes the pair readable at a glance from across a
          customer's living room.
        */}
        <Text style={[styles.current, compact && styles.currentCompact]} numberOfLines={1}>
          {current}
        </Text>
        <Text style={[styles.total, compact && styles.totalCompact]} numberOfLines={1}>
          {' '}
          / {total}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 15,
  },
  /**
   * ⚠️ `flexShrink: 0` on BOTH controls. The row is `space-between` across the full width
   * of the slide, so a narrow frame — which is what a landscape phone gives — would
   * otherwise squeeze the pill and clip its own total to `2 / ⌐`, as reported.
   */
  close: {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexShrink: 0,
    flexDirection: 'row',
    /**
     * ⚠️ `center`, NOT `baseline`.
     *
     * The two numbers are different sizes, and baseline alignment lines up their
     * BASELINES rather than centring the pair in the pill — so inside a fixed-height row
     * the text sat high instead of in the middle, which is what was reported. Baseline is
     * the typographically "correct" pairing for mixed sizes and is exactly wrong here:
     * the pill is a fixed box, and what has to look centred is the block, not the type.
     */
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
  },
  /**
   * ⚠️ `includeFontPadding: false` on both — Android reserves extra space above and below
   * the glyphs for ascenders/descenders the string may not use, which pushes text off
   * centre inside a fixed-height box. iOS ignores the prop, so it costs nothing there.
   */
  current: { color: '#fff', fontSize: 17, fontWeight: '700', includeFontPadding: false },
  total: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '600',
    includeFontPadding: false,
  },

  rowEndOnly: { justifyContent: 'flex-end' },
  closeCompact: { width: 32, height: 32, borderRadius: 16 },
  pillCompact: { height: 26, paddingHorizontal: 10, borderRadius: 13 },
  currentCompact: { fontSize: 12 },
  totalCompact: { fontSize: 10.5 },
});
