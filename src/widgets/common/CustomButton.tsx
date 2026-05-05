import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

interface Props {
  onPress: () => void;
  title: string;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle | TextStyle[];
  variant?: 'primary' | 'secondary' | 'error';
}

export const CustomButton: React.FC<Props> = ({
  onPress,
  title,
  loading,
  disabled,
  style,
  textStyle,
  variant = 'primary',
}) => {
  const { colors } = useTheme();

  const getBgColor = () => {
    if (disabled || loading) return colors.textSecondary + '40';
    if (variant === 'secondary') return colors.secondary.main;
    if (variant === 'error') return colors.error.main;
    return colors.primary.main;
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[styles.btn, { backgroundColor: getBgColor() }, style as any]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text className="text-white text-sm font-bold" style={textStyle}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
});
