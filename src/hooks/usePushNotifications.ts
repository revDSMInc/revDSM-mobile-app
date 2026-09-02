import { useEffect, useRef } from 'react';
import { navigationRef } from '../navigation';
import { queryClient } from '../services/api/queryClient';
import { LeadService } from '../services/api/leads';
import { getNativePush } from '../services/push-native';
import {
  resolvePushRoute,
  shouldSuppressForeground,
  isRenderable,
  channelForEvent,
  invalidationKeysFor,
  type PushData,
} from '../utils/push-routing';

/**
 * usePushNotifications — the React layer of the push stack.
 *
 * Owns three things and nothing else: displaying a notification while the app is
 * in the FOREGROUND (neither platform does this for you), handling a TAP from all
 * three arrival paths, and refreshing the caches the destination screen reads.
 *
 * Token binding lives in `services/PushNotificationService.ts`; the routing rules
 * live in `utils/push-routing.ts`. Mount this ONCE, at app level.
 *
 * ⚠️ Reads the `queryClient` SINGLETON rather than `useQueryClient()`. This hook is
 * called from `AppContent`, which RENDERS `QueryClientProvider` rather than sitting
 * inside it — the context hook would throw.
 *
 * ⚠️ Every native call goes through `getNativePush()`. A build whose native modules
 * are missing must render the app normally with push simply inert — this hook is
 * mounted at the root, so a throw here is a white screen.
 */
export function usePushNotifications(
  currentRouteName: string | null,
  openChatId: string | null
) {
  /**
   * Refs, not effect dependencies. Re-subscribing `onMessage` on every navigation
   * would drop a notification that lands during the re-bind, and this hook is
   * mounted for the whole app lifetime — the listener must be registered once.
   */
  const routeRef = useRef(currentRouteName);
  const chatRef = useRef(openChatId);
  routeRef.current = currentRouteName;
  chatRef.current = openChatId;

  // ── Foreground: the OS deliberately renders nothing here, so Notifee does ───
  useEffect(() => {
    const np = getNativePush();
    if (!np) return undefined;

    let unsubscribe: (() => void) | undefined;
    try {
      const instance = np.messaging.getMessaging(np.app.getApp());
      unsubscribe = np.messaging.onMessage(instance, async (message: any) => {
        const data = (message?.data || {}) as PushData;

        // `go-back` is a control event the backend never writes to history;
        // rendering it would show a banner that exists nowhere in the app.
        if (!isRenderable(data)) return;

        // Refresh even when the banner is suppressed — the rep is looking at the
        // screen this event changed.
        applyInvalidations(data);

        if (shouldSuppressForeground(data, routeRef.current, chatRef.current)) return;

        await np.notifee
          .displayNotification({
            title: message?.notification?.title || 'revDSM',
            body: message?.notification?.body || '',
            // Notifee's `data` rejects `undefined` values. Rule 2 of the contract
            // means an optional key is absent rather than null, so dropping
            // undefined here is the same normalisation, not a loss.
            data: toNotifeeData(data),
            android: {
              channelId: channelForEvent(data),
              // TODO: replace with a monochrome `ic_stat_notification` drawable.
              // Android 5+ renders a full-colour launcher icon as a white square.
              smallIcon: 'ic_launcher',
              color: '#4CBB17',
              importance: np.AndroidImportance?.HIGH,
              pressAction: { id: 'default' },
            },
            ios: { sound: 'default' },
          })
          .catch((err: any) => console.warn('[Push] displayNotification failed:', err));
      });
    } catch (err) {
      // Firebase present but not configured — iOS without GoogleService-Info.plist.
      console.warn('[Push] onMessage subscribe failed:', err);
    }
    return () => unsubscribe?.();
  }, []);

  /**
   * ── Taps ────────────────────────────────────────────────────────────────────
   * THREE arrival paths, and all three must be handled or a tap silently does
   * nothing:
   *   1. Notifee      — the banner WE drew while the app was in the foreground
   *   2. FCM opened   — drawn by the OS while the app was alive but backgrounded
   *   3. FCM initial  — drawn by the OS while the app was dead (cold start)
   */
  useEffect(() => {
    const np = getNativePush();
    if (!np) return undefined;

    let unsubNotifee: (() => void) | undefined;
    let unsubOpened: (() => void) | undefined;

    try {
      unsubNotifee = np.notifee.onForegroundEvent(({ type, detail }: any) => {
        if (type === np.EventType?.PRESS) {
          void openFromPush(detail?.notification?.data as PushData);
        }
      });

      const instance = np.messaging.getMessaging(np.app.getApp());

      unsubOpened = np.messaging.onNotificationOpenedApp(instance, (message: any) => {
        void openFromPush(message?.data as PushData);
      });

      void np.messaging
        .getInitialNotification(instance)
        .then((message: any) => {
          if (message) void openFromPush(message.data as PushData);
        })
        .catch((err: any) => console.warn('[Push] getInitialNotification failed:', err));
    } catch (err) {
      console.warn('[Push] tap handlers subscribe failed:', err);
    }

    return () => {
      unsubNotifee?.();
      unsubOpened?.();
    };
  }, []);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Notifee's `data` field accepts `string | number | object`, never `undefined`.
 * Every FCM value is already a string (rule 1) and absent keys are simply missing
 * (rule 2), so dropping undefined here normalises rather than discards.
 */
function toNotifeeData(data: PushData): Record<string, string> {
  const out: Record<string, string> = {};
  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    if (typeof value === 'string') out[key] = value;
  });
  return out;
}

// ─── Cache refresh ───────────────────────────────────────────────────────────

function applyInvalidations(data: PushData | undefined) {
  try {
    invalidationKeysFor(data).forEach((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
  } catch (err) {
    console.warn('[Push] invalidation failed:', err);
  }
}

// ─── Navigation ──────────────────────────────────────────────────────────────

/**
 * `getInitialNotification()` resolves during the FIRST render pass, before
 * `NavigationContainer.onReady` has fired. Navigating then is a no-op that looks
 * exactly like a broken deep link, so wait for the ref rather than guessing a
 * delay. `navigationRef` is already exported from `src/navigation/index.tsx`.
 */
async function waitForNavigation(timeoutMs = 10000): Promise<boolean> {
  const startedAt = Date.now();
  while (!navigationRef.isReady()) {
    if (Date.now() - startedAt > timeoutMs) {
      console.warn('[Push] navigation never became ready — dropping deep link');
      return false;
    }
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 100);
    });
  }
  return true;
}

async function openFromPush(data: PushData | undefined) {
  const route = resolvePushRoute(data);
  // Unknown type, control event, or a known type missing the id it needs. The app
  // opens on whatever screen it was on, which is always better than a wrong guess.
  if (!route) return;

  applyInvalidations(data);

  if (!(await waitForNavigation())) return;

  try {
    if (route.kind === 'leadList') {
      // Bulk issue and route dispatch name no single lead — see push-routing.
      navigationRef.navigate('Leads');
      return;
    }

    if (route.kind === 'lead') {
      /**
       * ⚠️ `RootStackParamList` types `LeadCenter` as taking a FULL lead object,
       * not an id, so it has to be resolved before navigating. That costs a round
       * trip on a cold start; the alternative — adding a `leadId?` param and
       * letting the screen self-hydrate — is the better long-term shape. Until
       * then a failed fetch means the tap does nothing rather than opening an
       * empty screen.
       */
      const res = await LeadService.getSalesDealById(route.leadId);
      const lead = (res?.data as any)?.data || res?.data;
      if (!lead) {
        console.warn('[Push] lead not found for deep link:', route.leadId);
        return;
      }
      navigationRef.navigate('LeadCenter', { lead, tab: route.tab });
      return;
    }

    if (route.kind === 'chat') {
      navigationRef.navigate('ChatDetail', {
        chatId: route.chatId,
        leadId: route.leadId,
        // Required by the route's params; the screen resolves the real name from
        // the chat it loads, so an empty seed is correct rather than a placeholder.
        customerName: '',
        chatType: route.chatType,
      });

      /**
       * ⚠️ NOT YET GUARANTEED: being absent from `chat.participants` costs the
       * unread badge, the list refresh AND future pushes for this thread
       * (CHAT-MOBILE-API.md §2.1). `ChatService.ensureParticipant(leadId, userId)`
       * fixes it, but needs the signed-in user's id, which this module does not
       * hold. Wire it when this hook is given the current user alongside
       * `openChatId`.
       */
    }
  } catch (err) {
    console.warn('[Push] navigation failed:', err);
  }
}

export default usePushNotifications;
