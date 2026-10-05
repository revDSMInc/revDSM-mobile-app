/**
 * @format
 */

import React from 'react';
import { AppRegistry, Text, TextInput, StyleSheet, Dimensions, Platform } from 'react-native';
import App from './App';
import { resolveFontPatch } from './src/utils/default-font';
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

/**
 * Android foreground service that keeps queued uploads draining after the app leaves the screen.
 *
 * ⚠️ MODULE SCOPE, for the same reason as the FCM handler above: notifee looks the runner up when
 * the service starts, and a process restarted into a headless context has no React tree to
 * register it from. Required lazily and guarded, so a stale native binary degrades to "no
 * background service" instead of taking the bundle down. A no-op on iOS.
 */
try {
  require('./src/services/background/androidUploadService').registerAndroidUploadRunner();
} catch (e) {
  console.warn('[background] upload service runner not registered:', e?.message || e);
}

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

/**
 * How far the OS text-size setting may grow the app's type.
 *
 * ⚠️ NOT 1.0 / `allowFontScaling={false}`. Ignoring the setting outright is an
 * accessibility regression — a rep who has raised their phone's text size did so
 * because they need it, and this app is used outdoors on a doorstep. A cap keeps the
 * layout intact (the Lead Center's two-column rows, the Job Builder's step strip and
 * the measurement grids all break well before 2x) while still honouring the setting.
 *
 * ⚠️ This is the SIZE setting only. A device font-FAMILY change (Samsung/Pixel "font
 * style") is already defeated by `resolveFontPatch`, which names a Public Sans face on
 * every Text — but only because those faces are actually bundled on Android, which
 * they were not until the fonts were linked into
 * `android/app/src/main/assets/fonts`. If Android ever goes back to the device font,
 * check that directory FIRST: the manifest can claim the assets are linked while the
 * directory does not exist.
 *
 * Individual call sites may still pass a lower cap; an explicit prop wins over this.
 */
const MAX_FONT_SCALE = 1.25;

// Create wrapper for Text component
const ScaledText = React.forwardRef((props, ref) => {
  const { style, maxFontSizeMultiplier, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style);
  const fontPatch = resolveFontPatch(flatStyle);
  // A call site that already states its own cap keeps it.
  const cap = maxFontSizeMultiplier ?? MAX_FONT_SCALE;

  if (!isTablet()) {
    return (
      <OriginalText
        ref={ref}
        maxFontSizeMultiplier={cap}
        style={fontPatch ? [style, fontPatch] : style}
        {...rest}
      />
    );
  }

  const baseFontSize =
    flatStyle && typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 14;

  const scaledStyle = { fontSize: baseFontSize + 2 };

  if (flatStyle && typeof flatStyle.lineHeight === 'number') {
    scaledStyle.lineHeight = flatStyle.lineHeight + 2;
  }

  return (
    <OriginalText
      ref={ref}
      maxFontSizeMultiplier={cap}
      style={[style, fontPatch, scaledStyle]}
      {...rest}
    />
  );
});

// Create wrapper for TextInput component
const ScaledTextInput = React.forwardRef((props, ref) => {
  const { style, maxFontSizeMultiplier, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style);
  const fontPatch = resolveFontPatch(flatStyle);
  const cap = maxFontSizeMultiplier ?? MAX_FONT_SCALE;

  if (!isTablet()) {
    return (
      <OriginalTextInput
        ref={ref}
        maxFontSizeMultiplier={cap}
        style={fontPatch ? [style, fontPatch] : style}
        {...rest}
      />
    );
  }

  const baseFontSize =
    flatStyle && typeof flatStyle.fontSize === 'number' ? flatStyle.fontSize : 14;

  const scaledStyle = { fontSize: baseFontSize + 2 };

  return (
    <OriginalTextInput
      ref={ref}
      maxFontSizeMultiplier={cap}
      style={[style, fontPatch, scaledStyle]}
      {...rest}
    />
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
