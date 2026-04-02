import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export const CustomInput: React.FC<Props> = ({ label, error, style, ...props }) => {
  const { colors, isDark } = useTheme();

  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: isDark ? colors.surface : '#F4F6F8',
            color: colors.text,
            borderColor: error ? colors.error.main : (isDark ? colors.border : '#E5E8EB'),
          },
          style,
        ]}
        placeholderTextColor={colors.textSecondary}
        {...props}
      />
      {error && <Text style={[styles.error, { color: colors.error.main }]}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 14,
    borderWidth: 1,
  },
  error: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
});
