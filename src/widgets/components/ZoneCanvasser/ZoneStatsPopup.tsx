import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { formatZoneDisplayName } from '../../../utils/zone-canvasser-util';
import { getZoneStats } from '../../../utils/zone-helpers';
import { OverlayModal } from './OverlayModal';

type Props = {
  visible: boolean;
  zone: any;
  onClose: () => void;
  onDelete?: (zone: any) => void | Promise<void>;
  onArchive?: (zone: any) => void | Promise<void>;
  isProcessing?: boolean;
};

function StatItem({ label, value, textColor, mutedColor }: { label: string; value: number; textColor: string; mutedColor: string }) {
  return (
    <View className="w-[48%] mb-4">
      <Text className="text-[11px] font-semibold uppercase" style={{ color: mutedColor }}>
        {label}
      </Text>
      <Text className="text-lg font-bold mt-1" style={{ color: textColor }}>
        {value}
      </Text>
    </View>
  );
}

const DELETE_COLOR = '#FF5630'; // theme error.main — web `color="error"`
const ARCHIVE_COLOR = '#FFAB00'; // theme warning.main — web `color="warning"`

const CONFIRM = {
  delete: {
    title: 'Delete Zone?',
    content: 'This will permanently remove the zone. This action cannot be undone.',
    action: 'Delete',
  },
  archive: {
    title: 'Archive Zone?',
    content:
      'This zone will be archived and removed from your active map. Your knock history will be preserved.',
    action: 'Archive',
  },
} as const;

export function ZoneStatsPopup({
  visible,
  zone,
  onClose,
  onDelete,
  onArchive,
  isProcessing = false,
}: Props) {
  const { colors, isDark } = useTheme();
  const {
    totalHomes,
    homesKnocked,
    notHome,
    noAnswer,
    notQualified,
    leadsCreated,
    goBack,
    interestedNoTime,
    notInterested,
    noSoliciting,
    percentage,
    canDelete,
    canArchive,
  } = getZoneStats(zone);
  const displayName = formatZoneDisplayName(zone);
  const surfaceBg = isDark ? colors.surface : '#FFFFFF';

  const confirm = (kind: keyof typeof CONFIRM) => {
    const handler = kind === 'delete' ? onDelete : onArchive;
    if (!handler || isProcessing) return;
    const copy = CONFIRM[kind];
    Alert.alert(copy.title, copy.content, [
      { text: 'Cancel', style: 'cancel' },
      { text: copy.action, style: 'destructive', onPress: () => handler(zone) },
    ]);
  };

  const showAction = (canDelete && !!onDelete) || (canArchive && !!onArchive);
  const actionColor = canDelete ? DELETE_COLOR : ARCHIVE_COLOR;

  return (
    <OverlayModal visible={visible} onRequestClose={isProcessing ? undefined : onClose}>
      <View className="w-[90%] max-h-[80%] rounded-xl overflow-hidden" style={{ backgroundColor: surfaceBg }}>
        <View
          className="flex-row justify-between items-center px-5 py-4 border-b"
          style={{ borderBottomColor: isDark ? colors.border : '#E2E8F0' }}
        >
          <Text className="text-lg font-bold flex-1 pr-2" style={{ color: colors.text }}>
            {displayName}
          </Text>
          <TouchableOpacity onPress={onClose} disabled={isProcessing}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView className="px-5 py-4 max-h-96">
          <View className="flex-row flex-wrap justify-between">
            <StatItem label="Total Homes" value={totalHomes} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Homes Knocked" value={homesKnocked} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Not Home / No Answer" value={notHome + noAnswer} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Not Qualified" value={notQualified} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Leads Created" value={leadsCreated} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Go Back" value={goBack} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Interested No Time" value={interestedNoTime} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="Not Interested" value={notInterested} textColor={colors.text} mutedColor={colors.textSecondary} />
            <StatItem label="No Soliciting" value={noSoliciting} textColor={colors.text} mutedColor={colors.textSecondary} />
          </View>

          <View className="mt-6">
            <View className="flex-row justify-between mb-2">
              <Text className="text-[13px] font-semibold" style={{ color: colors.textSecondary }}>
                Progress
              </Text>
              <Text className="text-[13px] font-bold" style={{ color: colors.text }}>
                {percentage}% Complete
              </Text>
            </View>
            <View
              className="h-2 rounded overflow-hidden"
              style={{ backgroundColor: isDark ? colors.border : '#E2E8F0' }}
            >
              <View
                className="h-full rounded"
                style={{ width: `${percentage}%`, backgroundColor: colors.primary.main }}
              />
            </View>
          </View>
        </ScrollView>

        {showAction && (
          <View className="p-5">
            <TouchableOpacity
              onPress={() => confirm(canDelete ? 'delete' : 'archive')}
              disabled={isProcessing}
              className="w-full py-3 rounded-lg flex-row items-center justify-center"
              style={{ backgroundColor: actionColor, opacity: isProcessing ? 0.7 : 1 }}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MaterialCommunityIcons
                  name={canDelete ? 'delete-outline' : 'archive-outline'}
                  size={20}
                  color="#FFFFFF"
                />
              )}
              <Text className="text-white font-bold ml-2">
                {canDelete ? 'Delete Zone' : 'Archive Zone'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </OverlayModal>
  );
}
