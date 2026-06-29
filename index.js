/**
 * @format
 */

import React from 'react';
import { AppRegistry, Text, TextInput, StyleSheet, Dimensions, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Detect tablet device dynamically
const isTablet = () => {
  const { width, height } = Dimensions.get('window');
  return Platform.OS === 'ios' ? Platform.isPad : Math.min(width, height) >= 600;
};

// Store original components
const OriginalText = Text;
const OriginalTextInput = TextInput;

// Create wrapper for Text component
const ScaledText = React.forwardRef((props, ref) => {
  const { style, ...rest } = props;

  if (!isTablet()) {
    return <OriginalText ref={ref} style={style} {...rest} />;
  }

  const flatStyle = StyleSheet.flatten(style);
  const baseFontSize =
    flatStyle && typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 14;

  const scaledStyle = { fontSize: baseFontSize + 2 };

  if (flatStyle && typeof flatStyle.lineHeight === 'number') {
    scaledStyle.lineHeight = flatStyle.lineHeight + 2;
  }

  return <OriginalText ref={ref} style={[style, scaledStyle]} {...rest} />;
});

// Create wrapper for TextInput component
const ScaledTextInput = React.forwardRef((props, ref) => {
  const { style, ...rest } = props;

  if (!isTablet()) {
    return <OriginalTextInput ref={ref} style={style} {...rest} />;
  }

  const flatStyle = StyleSheet.flatten(style);
  const baseFontSize =
    flatStyle && typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 14;

  const scaledStyle = { fontSize: baseFontSize + 2 };

  return <OriginalTextInput ref={ref} style={[style, scaledStyle]} {...rest} />;
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
