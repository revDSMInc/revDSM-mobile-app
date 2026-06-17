import './global.css';
import React from 'react';
import { Text, TextInput, View, StyleSheet, StatusBar, Platform } from 'react-native';

// Professional Global Font Injection for RN 0.84+
// This ensures Public Sans is the baseline for EVERYTHING.
const applyGlobalFont = (Component: any) => {
  const target = Component.render || Component.type?.render;
  if (!target) return;

  const oldRender = target;
  const newRender = function (this: any, ...args: any) {
    const origin = oldRender.call(this, ...args);
    if (!origin) return origin;
    return React.cloneElement(origin, {
      style: [{ fontFamily: 'PublicSans-Regular' }, origin.props.style],
    });
  };

  if (Component.render) Component.render = newRender;
  else if (Component.type?.render) Component.type.render = newRender;
};

applyGlobalFont(Text);
applyGlobalFont(TextInput);
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Provider as ReduxProvider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './src/redux/store';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import RootNavigator from './src/navigation';
import { useAppInitialization } from './src/hooks/useAppInitialization';
import { useSocketManager } from './src/hooks/useSocketManager';
import { QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { queryClient } from './src/services/api/queryClient';


function AppContent() {
  useAppInitialization();
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Connect the global socket once — persists across all screens
  useSocketManager();

  const statusBarBg = isDark ? colors.background : '#101828';

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={statusBarBg}
      />
      {Platform.OS === 'ios' && (
        <View
          style={{
            height: insets.top,
            backgroundColor: statusBarBg,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
          }}
        />
      )}
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
      <FlashMessage position="top" />
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <GestureHandlerRootView style={styles.root}>
          <ReduxProvider store={store}>
            <PersistGate loading={null} persistor={persistor}>
              <ThemeProvider>
                <AppContent />
              </ThemeProvider>
            </PersistGate>
          </ReduxProvider>
        </GestureHandlerRootView>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
});
