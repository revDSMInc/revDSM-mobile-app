import React, { useRef, useEffect, forwardRef, memo } from 'react';
import { View, Text, TextInput, TextInputProps, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../../theme/ThemeProvider';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
}

/**
 * CustomInput - Final Optimized Version
 *
 * 1. textContentType="oneTimeCode" prevents iOS from shifting the keyboard layout for password suggestions.
 * 2. Stable 'secureTextEntry' prop via useRef.
 * 3. memo() wrapper to prevent unnecessary parent re-renders from affecting the internal TextInput.
 */
export const CustomInput = memo(
  forwardRef<TextInput, Props>(
    ({ label, error, style, rightIcon, onRightIconPress, secureTextEntry, ...props }, ref) => {
      const { colors, isDark } = useTheme();
      const internalRef = useRef<TextInput>(null);
      const inputRef = (ref as React.RefObject<TextInput>) ?? internalRef;

      // Stable secure baseline. React will always diff this as the initial value.
      const initialSecure = useRef(secureTextEntry);

      // Native-side toggle. This is the only place we flip the security.
      useEffect(() => {
        inputRef.current?.setNativeProps({
          secureTextEntry: secureTextEntry,
          // Re-enforcing the font as iOS dots sometimes have a different width/height.
          style: [styles.input, { color: colors.text }],
        });
      }, [secureTextEntry, colors.text]);

      const iconColor = isDark ? 'rgba(255,255,255,0.45)' : '#919EAB';
      const hasRightIcon = Boolean(rightIcon);

      return (
        <View style={styles.container}>
          {label && (
            <Text className="text-sm font-semibold mb-2 ml-1" style={{ color: colors.text }}>
              {label}
            </Text>
          )}

          <View
            className="h-12 rounded-xl border flex-row items-center overflow-hidden"
            style={{
              backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F4F6F8',
              borderColor: error ? colors.error.main : isDark ? colors.border : '#E5E8EB',
            }}
          >
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                {
                  color: colors.text,
                  // Fixed fixed padding to prevent layout shift
                  paddingRight: hasRightIcon ? 4 : 16,
                },
                style,
              ]}
              secureTextEntry={initialSecure.current}
              placeholderTextColor={isDark ? 'rgba(255,255,255,0.35)' : '#919EAB'}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              // Prevents iOS from popping up the "Strong Password" suggestion which causes layout jumps
              textContentType="oneTimeCode"
              {...props}
            />

            {hasRightIcon &&
              (onRightIconPress ? (
                <TouchableOpacity
                  onPress={onRightIconPress}
                  style={styles.iconButton}
                  activeOpacity={1} // Static feel
                >
                  <Icon name={rightIcon!} size={20} color={iconColor} />
                </TouchableOpacity>
              ) : (
                <View style={styles.iconButton}>
                  <Icon name={rightIcon!} size={18} color={iconColor} />
                </View>
              ))}
          </View>

          {error && (
            <Text
              className="text-[10px] font-bold uppercase tracking-wider mt-1.5 ml-1"
              style={{ color: colors.error.main }}
            >
              {error}
            </Text>
          )}
        </View>
      );
    }
  )
);

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  input: {
    flex: 1,
    fontSize: 14,
    height: '100%',
    paddingLeft: 16,
  },
  iconButton: {
    width: 44,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

CustomInput.displayName = 'CustomInput';
