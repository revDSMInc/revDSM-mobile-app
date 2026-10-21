import React from 'react';
import { AppRegistry, Text, TextInput, Modal, StyleSheet, Dimensions, Platform } from 'react-native';
import App from './App';
import { resolveFontPatch } from './src/utils/default-font';
import { NumPadProvider } from './src/widgets/common/keyboard/NumPad';
import { useNumPadField } from './src/widgets/common/keyboard/NumPad/useNumPadField';
import { name as appName } from './app.json';
import { installNetworkErrorDowngrade } from './src/utils/console-noise';

// A dropped connection must not raise the red LogBox screen: transport failures passed to console.error are logged quietly.
installNetworkErrorDowngrade();

try {
  // eslint-disable-next-line global-require
  const { getApp } = require('@react-native-firebase/app');
  // eslint-disable-next-line global-require
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');

  setBackgroundMessageHandler(getMessaging(getApp()), async (message) => {
    console.log('[Push] background message:', message?.data?.eventType);
  });
} catch (e) {
  console.warn('[Push] background handler not registered:', e?.message || e);
}

try {
  require('./src/services/background/androidUploadService').registerAndroidUploadRunner();
} catch (e) {
  console.warn('[background] upload service runner not registered:', e?.message || e);
}

const isTablet = () => {
  const { width, height } = Dimensions.get('window');
  return Platform.OS === 'ios' ? Platform.isPad : Math.min(width, height) >= 600;
};

const OriginalText = Text;
const OriginalTextInput = TextInput;
const OriginalModal = Modal;

const MAX_FONT_SCALE = 1.25;

const ScaledText = React.forwardRef((props, ref) => {
  const { style, maxFontSizeMultiplier, ...rest } = props;
  const flatStyle = StyleSheet.flatten(style);
  const fontPatch = resolveFontPatch(flatStyle);
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

const ScaledTextInput = React.forwardRef((props, ref) => {
  const numPadProps = useNumPadField(props);
  const { style, maxFontSizeMultiplier, numPad: _numPad, ...rest } = props;
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
        {...numPadProps}
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
      {...numPadProps}
    />
  );
});

const NumPadModal = React.forwardRef((props, ref) => (
  <OriginalModal ref={ref} {...props}>
    <NumPadProvider fill>{props.children}</NumPadProvider>
  </OriginalModal>
));
Object.assign(NumPadModal, OriginalModal);
NumPadModal.displayName = 'Modal';

Object.assign(ScaledText, OriginalText);
ScaledText.displayName = 'Text';

Object.assign(ScaledTextInput, OriginalTextInput);
ScaledTextInput.displayName = 'TextInput';

try {
  const rn = require('react-native');

  Object.defineProperty(rn, 'Text', {
    get() {
      return ScaledText;
    },
    configurable: true,
  });

  Object.defineProperty(rn, 'Modal', {
    get() {
      return NumPadModal;
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
