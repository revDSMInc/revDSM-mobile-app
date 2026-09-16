import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { zoneApiId, zoneKnockedCount, zoneLabel } from '../../../utils/zone-helpers';

/**
 * Port of web src/sections/map/zone-canvasser/archived-zones-panel.js — the rep's
 * archived zones, each with an Unarchive action.
 *
 * Split into a card and a toggle so the card can render IN FLOW above the bottom-left
 * buttons: as an absolute popover it would overflow its button's bounds, and Android
 * never delivers a touch there — every Unarchive button would be dead.
 */

type CardProps = {
  zones: any[];
  loading: boolean;
  onUnarchive: (zone: any) => void | Promise<void>;
  /** The zone id currently being unarchived (web `processingId`). */
  processingId: string | null;
};

export function ArchivedZonesCard({ zones, loading, onUnarchive, processingId }: CardProps) {
  const { colors, isDark } = useTheme();
  const { width, height } = useWindowDimensions();

  // Web confirm dialog copy, verbatim. A native Alert, not a Modal, for the reason the
  // stats popup gives: this already sits inside the map's full-screen Modal.
  const confirmUnarchive = (zone: any) => {
    if (processingId) return;
    Alert.alert(
      'Unarchive Zone?',
      `"${zoneLabel(zone)}" will move back to your active map. Its knock history stays intact.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unarchive', onPress: () => onUnarchive(zone) },
      ]
    );
  };

  const border = isDark ? colors.border : 'rgba(0,0,0,0.08)';

  return (
    <View
      className="rounded-xl p-4 mb-2 self-start"
      style={{
        backgroundColor: isDark ? colors.surface : '#FFFFFF',
        borderWidth: 1,
        borderColor: border,
        // Web: hug the viewport on mobile (max 300 wide).
        width: Math.min(300, width - 32),
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 8,
      }}
    >
      <Text
        className="text-[11px] font-bold tracking-wider mb-3"
        style={{ color: colors.textSecondary }}
      >
        ARCHIVED ZONES{zones.length > 0 ? ` (${zones.length})` : ''}
      </Text>

      {loading ? (
        <View className="items-center py-4">
          <ActivityIndicator size="small" color="#4CBB17" />
        </View>
      ) : zones.length === 0 ? (
        <Text className="text-[13px] py-1" style={{ color: colors.textSecondary }}>
          No archived zones.
        </Text>
      ) : (
        // The header stays put while the list scrolls. The cap sits on the ScrollView
        // itself (web: 340 overall) — a maxHeight on the card alone does not reliably
        // make Yoga shrink the list.
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ maxHeight: Math.max(120, Math.min(300, height - 300)) }}
        >
          {zones.map((zone, index) => {
            const id = zoneApiId(zone) || String(index);
            const isProcessing = processingId === id;
            const isLast = index === zones.length - 1;
            return (
              <View
                key={id}
                className="flex-row items-center justify-between"
                style={{
                  gap: 12,
                  paddingBottom: isLast ? 0 : 10,
                  marginBottom: isLast ? 0 : 10,
                  borderBottomWidth: isLast ? 0 : 1,
                  borderBottomColor: border,
                }}
              >
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: colors.text }}
                    numberOfLines={1}
                  >
                    {zoneLabel(zone)}
                  </Text>
                  <Text className="text-[11px]" style={{ color: colors.textSecondary }}>
                    {zone?.buildingDetails?.length || 0} homes · {zoneKnockedCount(zone)} knocked
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => confirmUnarchive(zone)}
                  disabled={!!processingId}
                  className="flex-row items-center rounded-lg px-2.5 py-1.5"
                  style={{
                    borderWidth: 1,
                    borderColor: '#4CBB17',
                    opacity: processingId && !isProcessing ? 0.5 : 1,
                  }}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#4CBB17" />
                  ) : (
                    <MaterialCommunityIcons name="archive-arrow-up-outline" size={16} color="#4CBB17" />
                  )}
                  <Text className="text-[12px] font-semibold ml-1" style={{ color: '#4CBB17' }}>
                    Unarchive
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/** Web toggle: white with an archive icon, dark with a close icon while open. */
export function ArchivedZonesToggle({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel="Archived zones"
      className={`w-11 h-11 rounded-full items-center justify-center shadow-md ${
        open ? 'bg-slate-800' : 'bg-white'
      }`}
    >
      <MaterialCommunityIcons
        name={open ? 'close' : 'archive-outline'}
        size={22}
        color={open ? '#FFFFFF' : '#475569'}
      />
    </TouchableOpacity>
  );
}
