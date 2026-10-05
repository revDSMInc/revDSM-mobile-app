import React, { useRef, useEffect, forwardRef, memo } from 'react';
import { View, Text, TextInput, TextInputProps, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../theme/ThemeProvider';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
  containerStyle?: ViewStyle;
  inputContainerStyle?: ViewStyle;
  /** Overrides the default 12pt input text size (and the label indent is dropped with `flushLabel`). */
  fontSize?: number;
  /** Drop the label's 4pt left indent so it lines up with sibling section labels. */
  flushLabel?: boolean;
}

export const CustomInput = memo(
  forwardRef<TextInput, Props>(
    ({ label, error, style, rightIcon, onRightIconPress, secureTextEntry, containerStyle, inputContainerStyle, fontSize, flushLabel, ...props }, ref) => {
      const { colors, isDark } = useTheme();
      const internalRef = useRef<TextInput>(null);
      const inputRef = (ref as React.RefObject<TextInput>) ?? internalRef;
      const initialSecure = useRef(secureTextEntry);

      useEffect(() => {
        inputRef.current?.setNativeProps({
          style: [styles.input, fontSize ? { fontSize } : null, { color: colors.text }],
        });
      }, [colors.text, fontSize]);

      const iconColor = isDark ? 'rgba(255,255,255,0.45)' : '#637381';
      const hasRightIcon = Boolean(rightIcon);

      return (
        <View style={styles.container}>
          {label && (
            <Text
              className={flushLabel ? 'text-sm font-semibold mb-2' : 'text-sm font-semibold mb-2 ml-1'}
              style={{ color: colors.text }}
            >
              {label}
            </Text>
          )}
          <View
            className="h-[50px] rounded-xl border flex-row items-center overflow-hidden"
            style={[
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F5F5F5',
                borderColor: error ? colors.error.main : isDark ? colors.border : '#919EAB33',
              },
              containerStyle,
              inputContainerStyle,
            ]}
          >
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                fontSize ? { fontSize } : null,
                { color: colors.text, paddingRight: hasRightIcon ? 4 : 16 },
                style,
              ]}
              secureTextEntry={secureTextEntry}
              placeholderTextColor={isDark ? 'rgba(255,255,255,0.35)' : '#919EAB'}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              {...props}
            />
            {hasRightIcon &&
              (onRightIconPress ? (
                <TouchableOpacity
                  onPress={onRightIconPress}
                  style={styles.iconButton}
                  activeOpacity={1}
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
              className="text-[10px] font-bold  tracking-wider mt-1.5 ml-1"
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
  container: { marginBottom: 16 },
  input: { flex: 1, fontSize: 12, paddingLeft: 12, paddingVertical: 4, textAlignVertical: 'center' },
  iconButton: { width: 44, height: '100%', justifyContent: 'center', alignItems: 'center' },
});

(CustomInput as any).displayName = 'CustomInput';
