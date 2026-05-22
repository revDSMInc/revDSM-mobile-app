import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { formatZoneDisplayName } from '../../../utils/zone-canvasser-util';
import { OverlayModal } from './OverlayModal';

type Props = {
  visible: boolean;
  zone: any;
  onClose: () => void;
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

export function ZoneStatsPopup({ visible, zone, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const totalHomes = zone?.buildingDetails?.length || 0;

  let allLeads: any[] = [];
  if (Array.isArray(zone?.salesRepBuildingLeads)) {
    allLeads = zone.salesRepBuildingLeads.flat();
  } else if (zone?.buildingLeads && Array.isArray(zone.buildingLeads)) {
    allLeads = zone.buildingLeads.flat();
  }

  const homesKnocked = allLeads.length;
  const notHome = allLeads.filter((l) => l?.status === 'not_home').length;
  const noAnswer = allLeads.filter((l) => l?.status === 'no_answer').length;
  const notQualified = allLeads.filter((l) => l?.status === 'not_qualified').length;
  const leadsCreated = allLeads.filter(
    (l) => l?.status === 'create_lead' || l?.status === 'selfGenerated'
  ).length;
  const goBack = allLeads.filter((l) => l?.status === 'go_back').length;
  const interestedNoTime = allLeads.filter((l) => l?.status === 'interested_no_time').length;
  const notInterested = allLeads.filter((l) => l?.status === 'not_interested').length;
  const noSoliciting = allLeads.filter((l) => l?.status === 'no_soliciting').length;
  const percentage = totalHomes > 0 ? Math.round((homesKnocked / totalHomes) * 100) : 0;
  const displayName = formatZoneDisplayName(zone);
  const surfaceBg = isDark ? colors.surface : '#FFFFFF';

  return (
    <OverlayModal visible={visible} onRequestClose={onClose}>
      <View className="w-[90%] max-h-[80%] rounded-xl overflow-hidden" style={{ backgroundColor: surfaceBg }}>
        <View
          className="flex-row justify-between items-center px-5 py-4 border-b"
          style={{ borderBottomColor: isDark ? colors.border : '#E2E8F0' }}
        >
          <Text className="text-lg font-bold flex-1 pr-2" style={{ color: colors.text }}>
            {displayName}
          </Text>
          <TouchableOpacity onPress={onClose}>
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

        <View className="p-5">
          <TouchableOpacity
            onPress={onClose}
            className="w-full py-3 rounded-lg items-center"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white font-bold">Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </OverlayModal>
  );
}
