import { AppState, type AppStateStatus } from 'react-native';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { isOnline, subscribeConnectivity } from '../connectivity';

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

/**
 * Teach React Query what the rest of the app already knows.
 *
 * Without this, `onlineManager` falls back to its own web-oriented default and effectively believes
 * the app is always online: retries burn through their budget against a dead link, and — the part
 * that matters — nothing refetches when signal comes back, because nothing told it signal came back.
 */
onlineManager.setEventListener((setOnline) => {
  setOnline(isOnline());
  return subscribeConnectivity(setOnline);
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Resume on reconnect. This is the whole point of wiring `onlineManager` above.
      refetchOnReconnect: true,
      /**
       * ⚠️ `offlineFirst`, deliberately — NOT the `online` default.
       *
       * Under `online`, a query is PAUSED while we believe we are offline and the request never
       * goes out. That would be a behaviour change with two bad edges: our detection can be wrong
       * (captive portal, a stale debounce), and a screen with no cached data would render an empty
       * state having never actually tried.
       *
       * `offlineFirst` always attempts the FIRST request — so today's behaviour is preserved
       * exactly, error handling included — and only pauses the RETRIES until connectivity returns.
       * That is the gain with none of the regression.
       */
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      // Same reasoning: a write must still be attempted, so a button never sits silently pending
      // because we mis-read connectivity.
      networkMode: 'offlineFirst',
    },
  },
});
