import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';

export const SummaryStep = ({ jobState, onUpdate, calculateTotal }: any) => {
  const { colors, isDark } = useTheme();
  return (
    <View className="px-5 mt-6">
      <Text className="text-xl font-black mb-1" style={{ color: colors.text }}>
        Final Summary
      </Text>
      <Text className="text-xs font-bold mb-8" style={{ color: colors.textSecondary }}>
        Review all pricing and apply discounts
      </Text>

      <View
        className="rounded-[32px] p-6 border shadow-2xl"
        style={{
          borderColor: colors.border,
          backgroundColor: isDark ? colors.surface : colors.background,
        }}
      >
        <View className="flex-row justify-between mb-4">
          <Text
            className="text-[11px] font-black uppercase tracking-widest"
            style={{ color: colors.textSecondary }}
          >
            Retail MSRP
          </Text>
          <Text className="text-base font-black" style={{ color: colors.text }}>
            ${calculateTotal({ ...jobState, discounts: { seniorVet: false, preOrder: false } })}
          </Text>
        </View>

        <View className="flex-row items-center justify-between mb-6">
          <Text
            className="text-sm font-black uppercase tracking-widest"
            style={{ color: colors.text }}
          >
            Total Savings
          </Text>
          <Text className="text-sm font-black text-[#4CBB17]">
            -$
            {(
              Number(
                calculateTotal({ ...jobState, discounts: { seniorVet: false, preOrder: false } })
              ) - Number(jobState.endPrice)
            ).toFixed(2)}
          </Text>
        </View>

        <View className="h-[1px] mb-6" style={{ backgroundColor: colors.border }} />

        <View className="flex-row justify-between items-center">
          <Text
            className="text-xl font-black uppercase tracking-widest"
            style={{ color: colors.text }}
          >
            Grand Total
          </Text>
          <Text className="text-3xl font-black" style={{ color: colors.primary.main }}>
            ${jobState.endPrice}
          </Text>
        </View>
      </View>

      <View className="mt-8 flex-row justify-between gap-3">
        <DiscountButton
          label="Senior/Vet 10%"
          active={jobState.discounts.seniorVet}
          onPress={() => onUpdate('discounts', 'seniorVet', !jobState.discounts.seniorVet)}
        />
        <DiscountButton
          label="Pre-Order 25%"
          active={jobState.discounts.preOrder}
          onPress={() => onUpdate('discounts', 'preOrder', !jobState.discounts.preOrder)}
        />
      </View>
    </View>
  );
};

const DiscountButton = ({ label, active, onPress }: any) => {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 py-4 rounded-2xl border items-center shadow-sm"
      style={{
        borderColor: active ? colors.primary.main : colors.border,
        backgroundColor: active
          ? isDark
            ? colors.primary.main + '20'
            : colors.primary.main + '10'
          : isDark
          ? colors.grey[800]
          : colors.background,
      }}
    >
      <Text
        className="text-[11px] font-black uppercase tracking-widest"
        style={{ color: active ? colors.primary.main : colors.textSecondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};
