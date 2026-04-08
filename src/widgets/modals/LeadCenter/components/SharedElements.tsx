import React from 'react';
import { View, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const ModalContainer = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) => {
  const { colors, isDark } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: isDark ? colors.background : '#F4F6F8' }, style]}>
      {children}
    </View>
  );
};

export const ModalHeader = ({ title, subtitle, onClose, children }: any) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="px-5 pb-4 border-b shadow-sm"
      style={{
        backgroundColor: isDark ? colors.surface : colors.background,
        borderBottomColor: colors.border,
        paddingTop: insets.top,
      }}
    >
      <View className="flex-row items-center justify-between mt-2">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={onClose} className="mr-3 p-1">
            <Text className="text-xl" style={{ color: colors.text }}>
              ←
            </Text>
          </TouchableOpacity>
          <View>
            <Text className="text-lg font-black" style={{ color: colors.text }}>
              {title}
            </Text>
            {subtitle && (
              <Text
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: colors.textSecondary }}
              >
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        {children}
        <View className="flex-row items-center">
          <Text className="text-xl font-black tracking-tighter" style={{ color: '#4CBB17' }}>
            rev
          </Text>
          <Text className="text-xl font-black tracking-tighter" style={{ color: colors.text }}>
            DSM
          </Text>
        </View>
      </View>
    </View>
  );
};

export const PremiumCard = ({ children, style }: { children: React.ReactNode; style?: any }) => {
  const { colors, isDark } = useTheme();
  return (
    <View
      className="rounded-[24px] border shadow-sm p-5 mb-4"
      style={[
        {
          borderColor: colors.border,
          backgroundColor: isDark ? colors.surface : colors.background,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

export const ActionButton = ({ title, icon, color, onPress, style }: any) => (
  <TouchableOpacity
    onPress={onPress}
    className="h-14 rounded-2xl items-center justify-center shadow-lg flex-row px-6"
    style={[{ backgroundColor: color }, style]}
  >
    {icon && <Text className="text-white mr-2 text-lg">{icon}</Text>}
    <Text className="text-white text-[11px] font-black uppercase tracking-widest">{title}</Text>
  </TouchableOpacity>
);
