import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';

interface Props {
  onPress: () => void;
  title: string;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  variant?: 'primary' | 'secondary' | 'error';
}

export const CustomButton: React.FC<Props> = ({ 
  onPress, 
  title, 
  loading, 
  disabled, 
  style, 
  textStyle, 
  variant = 'primary' 
}) => {
  const { colors } = useTheme();

  const getBackgroundColor = () => {
    if (disabled || loading) return colors.textSecondary + '50';
    if (variant === 'secondary') return colors.secondary.main;
    if (variant === 'error') return colors.error.main;
    return colors.primary.main;
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        { backgroundColor: getBackgroundColor() },
        style,
      ]}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={[styles.text, { color: '#fff' }, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  text: {
    fontSize: 15,
    fontWeight: '700',
  },
});
