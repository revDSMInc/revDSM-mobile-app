import './global.css';
import React, { useState } from 'react';
import { Text, TextInput, View, StyleSheet, StatusBar, Platform, Animated } from 'react-native';

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
import RootNavigator, { navigationRef } from './src/navigation';
import { useAppInitialization } from './src/hooks/useAppInitialization';
import { useSocketManager } from './src/hooks/useSocketManager';
import { QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { queryClient } from './src/services/api/queryClient';
import SplashScreen from './src/screens/Splash';
import { useAuth } from './src/hooks/useAuth';

// How long the splash will keep waiting for auth bootstrap after the animation
// has finished, before handing over to the navigator's own loading state.
const MAX_BOOTSTRAP_WAIT_MS = 8000;


function AppContent() {
  useAppInitialization();
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Connect the global socket once — persists across all screens
  useSocketManager();
  const { loading, isInitialized } = useAuth();

  // Splash: play the logo animation, then continue into the normal navigation.
  // We hold it a moment longer if auth bootstrap hasn't resolved yet, so the
  // animation isn't followed by the navigator's bare spinner.
  const [animationDone, setAnimationDone] = useState(false);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const bootstrapReady = isInitialized && !loading;
  const showSplash = !animationDone || !(bootstrapReady || bootstrapTimedOut);

  React.useEffect(() => {
    if (!animationDone) return;
    const timer = setTimeout(() => setBootstrapTimedOut(true), MAX_BOOTSTRAP_WAIT_MS);
    return () => clearTimeout(timer);
  }, [animationDone]);

  // Splash dismissal is a FADE, not an instant cut: keep the overlay mounted
  // (`splashMounted`) and, once it's ready to go away (animation done + bootstrap
  // resolved, i.e. `showSplash` flips false), animate its opacity to 0 so the
  // home screen behind it is revealed smoothly, then unmount.
  const [splashMounted, setSplashMounted] = useState(true);
  const splashOpacity = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (showSplash || !splashMounted) return;
    Animated.timing(splashOpacity, {
      toValue: 0,
      duration: 450,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setSplashMounted(false);
    });
  }, [showSplash, splashMounted, splashOpacity]);

  const [currentRouteName, setCurrentRouteName] = useState<string | null>(null);

  const statusBarBg = isDark ? colors.background : '#0E2A1C';

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={statusBarBg}
      />
      {(Platform.OS === 'ios' || Platform.OS === 'android') && (
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
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          const route = navigationRef.getCurrentRoute();
          setCurrentRouteName(route?.name || null);
        }}
        onStateChange={(state) => {
          if (!state) return;
          let route: any = state.routes[state.index];
          while (route.state) {
            const stateIndex = route.state.index;
            if (typeof stateIndex === 'number' && route.state.routes) {
              route = route.state.routes[stateIndex];
            } else {
              break;
            }
          }
          setCurrentRouteName(route.name);
        }}
      >
        <RootNavigator currentRouteName={currentRouteName} />
      </NavigationContainer>
      <FlashMessage position="top" />
      {splashMounted && (
        <Animated.View
          // Once fading (showSplash false), let touches through to the app below.
          pointerEvents={showSplash ? 'auto' : 'none'}
          style={[StyleSheet.absoluteFill, { zIndex: 10000, opacity: splashOpacity }]}
        >
          <SplashScreen onFinish={() => setAnimationDone(true)} />
        </Animated.View>
      )}
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
