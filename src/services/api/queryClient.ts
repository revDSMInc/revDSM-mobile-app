import { AppState, type AppStateStatus } from 'react-native';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { isOnline, subscribeConnectivity } from '../connectivity';

AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active');
});

onlineManager.setEventListener((setOnline) => {
  setOnline(isOnline());
  return subscribeConnectivity(setOnline);
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
});
