import './global.css';
import React, { useState } from 'react';
import { Text, TextInput, View, StyleSheet, StatusBar, Platform, Animated } from 'react-native';

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
import { LanguageProvider } from './src/i18n/LanguageProvider';
import RootNavigator, { navigationRef } from './src/navigation';
import { useAppInitialization } from './src/hooks/useAppInitialization';
import { useSocketManager } from './src/hooks/useSocketManager';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { NumPadProvider } from './src/widgets/common/keyboard/NumPad';
import { queryClient } from './src/services/api/queryClient';
import SplashScreen from './src/screens/Splash';
import { useAuth } from './src/hooks/useAuth';
import { AnnotationRenderHost } from './src/widgets/common/AnnotationRenderHost';
import { AppErrorBoundary } from './src/widgets/common/AppErrorBoundary';
import { logBreadcrumb, setCrashUser } from './src/services/crashReporting';

const MAX_BOOTSTRAP_WAIT_MS = 8000;


function AppContent() {
  useAppInitialization();
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();
  useSocketManager();
  const { loading, isInitialized, user } = useAuth();

  // Opaque ids only (no email/name) so a crash can be tied to a rep without storing PII; cleared on logout.
  const crashUserId = user?._id || user?.id || null;
  const crashRole = user?.role || user?.roleName || null;
  React.useEffect(() => {
    setCrashUser(crashUserId ? { id: String(crashUserId), role: crashRole && String(crashRole), company: user?.companyId ? String(user.companyId) : null } : null);
  }, [crashUserId, crashRole, user?.companyId]);

  const [animationDone, setAnimationDone] = useState(false);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const bootstrapReady = isInitialized && !loading;
  const showSplash = !animationDone || !(bootstrapReady || bootstrapTimedOut);

  React.useEffect(() => {
    if (!animationDone) return;
    const timer = setTimeout(() => setBootstrapTimedOut(true), MAX_BOOTSTRAP_WAIT_MS);
    return () => clearTimeout(timer);
  }, [animationDone]);

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

  usePushNotifications(currentRouteName, null);

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
      {/* App-wide number pad for every screen; each Modal mounts its own (index.js). */}
      <NumPadProvider fill>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          const route = navigationRef.getCurrentRoute();
          setCurrentRouteName(route?.name || null);
          if (route?.name) logBreadcrumb(`screen: ${route.name}`);
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
          logBreadcrumb(`screen: ${route.name}`);
        }}
      >
        <RootNavigator currentRouteName={currentRouteName} />
      </NavigationContainer>
      </NumPadProvider>
      {/* Canvas for flattening annotated photos in the background, so Save can close the editor at once. */}
      <AnnotationRenderHost />
      <FlashMessage position="top" />
      {splashMounted && (
        <Animated.View
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
    <AppErrorBoundary>
    <SafeAreaProvider>
      <KeyboardProvider>
        <GestureHandlerRootView style={styles.root}>
          <ReduxProvider store={store}>
            <PersistGate loading={null} persistor={persistor}>
              <ThemeProvider>
                {/* Above everything that renders text, so switching language repaints
                    the whole tree in one pass. */}
                <LanguageProvider>
                  <AppContent />
                </LanguageProvider>
              </ThemeProvider>
            </PersistGate>
          </ReduxProvider>
        </GestureHandlerRootView>
      </KeyboardProvider>
    </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
});
