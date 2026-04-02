import './global.css';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as ReduxProvider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './src/redux/store';
import { ThemeProvider } from './src/theme/ThemeProvider';
import RootNavigator from './src/navigation';
import { useAppInitialization } from './src/hooks/useAppInitialization';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function AppContent() {
  useAppInitialization();
  return (
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
      <FlashMessage position="top" />
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ReduxProvider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <ThemeProvider>
            <AppContent />
          </ThemeProvider>
        </PersistGate>
      </ReduxProvider>
    </SafeAreaProvider>
  );
}
