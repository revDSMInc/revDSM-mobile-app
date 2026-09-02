/**
 * @format
 */

import React from 'react';
import { AppRegistry, Text, TextInput, StyleSheet, Dimensions, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

/**
 * FCM background handler.
 *
 * ⚠️ MUST be registered at MODULE SCOPE, outside any component, and before
 * `AppRegistry.registerComponent`. When the app has been killed there is no React
 * tree to register it from — this is the single most common reason a push works
 * in the foreground and appears to vanish in the background.
 *
 * The backend sends a `notification` block alongside `data`, so the OS has already
 * drawn the banner by the time this runs. It exists only for cheap side effects.
 *
 * ⚠️ Do NOT fetch here. This is a headless JS task with a hard time budget, and on
 * a cold start no session header has been restored yet — a hung request gets the
 * process killed.
 */
try {
  // Required lazily, NOT imported at the top. @notifee and @react-native-firebase
  // resolve their native modules at IMPORT time and throw when those are missing,
  // which is exactly what a JS-only reload against a stale native binary gives
  // you. A static import here would take the entire bundle down at startup.
  // eslint-disable-next-line global-require
  const { getApp } = require('@react-native-firebase/app');
  // eslint-disable-next-line global-require
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');

  setBackgroundMessageHandler(getMessaging(getApp()), async (message) => {
    console.log('[Push] background message:', message?.data?.eventType);
  });
} catch (e) {
  // Missing native modules (needs a rebuild), or iOS before
  // GoogleService-Info.plist is added to the Xcode target.
  console.warn('[Push] background handler not registered:', e?.message || e);
}

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
