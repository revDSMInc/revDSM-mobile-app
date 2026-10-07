import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  current: number;
  total: number;
  onClose?: () => void;
  closeLabel?: string;
  showClose?: boolean;
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
    <View
      style={[styles.row, !withClose && styles.rowEndOnly, { top, left, right }]}
      pointerEvents="box-none"
    >
      {withClose && (
      <TouchableOpacity
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        activeOpacity={0.85}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
  },
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
