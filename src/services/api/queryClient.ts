import { AppState, type AppStateStatus } from 'react-native';
import { QueryClient, focusManager } from '@tanstack/react-query';

/**
 * React Query's "window focus" concept is a browser idea; on RN nothing drives it
 * unless `focusManager` is told about `AppState`. Without this a query that opts
 * into `refetchOnWindowFocus` never revalidates when the app returns from the
 * background — which matters for the portal-authored job-builder config, since the
 * rep can background the app, the config can be edited, and they come back to a
 * screen that never remounted and so never refetched.
 *
 * ⚠️ This only ENABLES focus refetching; it does not turn it on anywhere. The
 * default below stays `refetchOnWindowFocus: false`, so a query refetches on
 * foreground only if it opts in explicitly (today: `jobBuilderProductsConfig`).
 */
AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active');
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});
