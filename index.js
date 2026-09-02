/**
 * @format
 */

import React from 'react';
import { AppRegistry, Text, TextInput, StyleSheet, Dimensions, Platform } from 'react-native';
import App from './App';
import { resolveFontPatch } from './src/utils/default-font';
import { name as appName } from './app.json';

// Detect tablet device dynamically
const isTablet = () => {
  const { width, height } = Dimensions.get('window');
  return Platform.OS === 'ios' ? Platform.isPad : Math.min(width, height) >= 600;
};

// Store original components
const OriginalText = Text;
const OriginalTextInput = TextInput;

// Public Sans is the design system's font, but a <Text> only gets it when something
// NAMES a face -- the NativeWind `font-*` classes do, the ~850 inline
// `style={{ fontWeight: '700' }}` sites do not -- so those fell back to each
// platform's system font, which on Android is whatever the user picked in the device
// font setting. `resolveFontPatch` returns the face that already carries the style's
// weight and slant (see src/utils/default-font.ts for why it also pins fontWeight to
// 'normal', which italic depends on, and for the one thing it leaves alone: icon fonts).
//
// This is applied HERE, on the same wrappers the tablet scaling already uses, rather
// than at 201 call sites -- and because these patch the `react-native` exports below,
// text rendered inside third-party components (navigation headers, chat, pickers)
// picks it up too. Without this wiring the util is inert and every unclassed <Text>
// goes back to following the device font.

// Create wrapper for Text component
const ScaledText = React.forwardRef((props, ref) => {
  const { style, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style);
  const fontPatch = resolveFontPatch(flatStyle);

  if (!isTablet()) {
    return (
      <OriginalText ref={ref} style={fontPatch ? [style, fontPatch] : style} {...rest} />
    );
  }

  const baseFontSize =
    flatStyle && typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 14;

  const scaledStyle = { fontSize: baseFontSize + 2 };

  if (flatStyle && typeof flatStyle.lineHeight === 'number') {
    scaledStyle.lineHeight = flatStyle.lineHeight + 2;
  }

  return <OriginalText ref={ref} style={[style, fontPatch, scaledStyle]} {...rest} />;
});

// Create wrapper for TextInput component
const ScaledTextInput = React.forwardRef((props, ref) => {
  const { style, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style);
  const fontPatch = resolveFontPatch(flatStyle);

  if (!isTablet()) {
    return (
      <OriginalTextInput ref={ref} style={fontPatch ? [style, fontPatch] : style} {...rest} />
    );
  }

  const baseFontSize =
    flatStyle && typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 14;

  const scaledStyle = { fontSize: baseFontSize + 2 };

  return (
    <OriginalTextInput ref={ref} style={[style, fontPatch, scaledStyle]} {...rest} />
  );
});

// Copy all static properties and set display names for debugging/React internals
Object.assign(ScaledText, OriginalText);
ScaledText.displayName = 'Text';

Object.assign(ScaledTextInput, OriginalTextInput);
ScaledTextInput.displayName = 'TextInput';

// Patch the react-native module exports so all files importing from 'react-native' use our versions
try {
  const rn = require('react-native');

  Object.defineProperty(rn, 'Text', {
    get() {
      return ScaledText;
    },
    configurable: true,
  });

  Object.defineProperty(rn, 'TextInput', {
    get() {
      return ScaledTextInput;
    },
    configurable: true,
  });
} catch (e) {
  console.warn('[FontScale] Failed to patch react-native Text/TextInput exports:', e);
}

AppRegistry.registerComponent(appName, () => App);
