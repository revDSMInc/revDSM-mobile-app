import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const ToolsSection = ({ onShowJobBuilder, onShowCalculator, onShowPitchbook }: any) => {
  const { colors } = useTheme();
  return (
    <View className="px-5 py-4">
      <Text
        className="text-[14px] font-black uppercase tracking-widest mb-5"
        style={{ color: colors.textSecondary }}
      >
        Operational Tools
      </Text>
      <ToolCard
        title="Job Builder"
        desc="Execute construction specs & pricing"
        icon="hammer-wrench"
        onPress={onShowJobBuilder}
      />
      <ToolCard
        title="Customer Consent Form"
        desc="Customer consent agreements"
        icon="file-signature"
      />
      <ToolCard
        title="LF Calculator"
        desc="Gutter measurements helper"
        icon="calculator"
        onPress={onShowCalculator}
      />
      <ToolCard
        title="Pitch Book"
        desc="Presentation materials"
        icon="book-open-page-variant"
        onPress={onShowPitchbook}
      />
      <ToolCard
        title="Risk Report"
        desc="View property risk assessment"
        icon="alert-decagram-outline"
      />
      <ToolCard
        title="Inspection Report"
        desc="Detailed inspection logs"
        icon="clipboard-text-outline"
      />
      <ToolCard title="Roof Waiver" desc="Roof waiver documents" icon="home-roof" />
    </View>
  );
};

const ToolCard = ({ title, desc, icon, onPress }: any) => {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="p-5 rounded-[24px] flex-row items-center mb-4 border shadow-sm"
      style={{
        borderColor: colors.border,
        backgroundColor: isDark ? colors.surface : colors.background,
      }}
    >
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center"
        style={{ backgroundColor: isDark ? colors.grey[800] : colors.grey[100] }}
      >
        <Icon name={icon} size={24} color={isDark ? colors.grey[0] : colors.grey[900]} />
      </View>
      <View className="flex-1 ml-4">
        <Text
          className="text-base font-black uppercase tracking-widest"
          style={{ color: colors.text }}
        >
          {title}
        </Text>
        <Text className="text-[12px] mt-1" style={{ color: colors.textSecondary }}>
          {desc}
        </Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
};

export const MapSection = ({ lead }: any) => {
  const { colors, isDark } = useTheme();
  return (
    <View className="px-5 py-4">
      <Text
        className="text-[14px] font-black uppercase tracking-widest mb-5"
        style={{ color: colors.textSecondary }}
      >
        On-Site Location
      </Text>
      <View
        className="rounded-[24px] p-5 border shadow-sm"
        style={{
          borderColor: colors.border,
          backgroundColor: isDark ? colors.surface : colors.background,
        }}
      >
        <Text className="text-[14px] font-bold" style={{ color: colors.text }}>
          📍 {lead?.fullAddress || lead?.customerDetails?.address || 'Address not available'}
        </Text>
        <View
          className="h-48 rounded-2xl mt-4 max-w-[100%] overflow-hidden"
          style={{ backgroundColor: isDark ? colors.background : colors.grey[100] }}
        />
      </View>
    </View>
  );
};
