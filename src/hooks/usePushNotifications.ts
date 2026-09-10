import { useEffect, useRef } from 'react';
import { navigationRef } from '../navigation';
import { queryClient } from '../services/api/queryClient';
import { LeadService, resolveLeadCalculatorId } from '../services/api/leads';
import { getNativePush } from '../services/push-native';
import {
  resolvePushRoute,
  shouldSuppressForeground,
  isRenderable,
  channelForEvent,
  invalidationKeysFor,
  type PushData,
} from '../utils/push-routing';
import { isLeadResulted } from '../utils/lead-result-status';

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
      const instance = np.messagingInstance;
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

      const instance = np.messagingInstance;

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

/**
 * Resolve the lead a deep link names.
 *
 * ⚠️ `getLeadDetailsById` (`lead/v1/details/{id}`), NOT `getSalesDealById`
 * (`demo/v1/leads/sales/{id}`). A push carries only a lead id and the lead may not
 * be a sales deal at all — issued, cancelled, or one whose agreement was just
 * signed — so the sales-deal route is the wrong lookup for this entry point.
 */
async function fetchLead(leadId: string): Promise<any | null> {
  try {
    const res = await LeadService.getLeadDetailsById(leadId);
    const body: any = res?.data;
    const lead = body?.data?.lead || body?.data || body?.lead || body;
    if (!lead || !(lead._id || lead.id)) {
      console.warn('[Push] lead not found for deep link:', leadId);
      return null;
    }
    return lead;
  } catch (err) {
    console.warn('[Push] lead fetch failed for deep link:', leadId, err);
    return null;
  }
}

/**
 * Resolve the calculator (and its appointment) whose saved build the Job Builder
 * should open.
 *
 * ⚠️ TWO SOURCES, and the second one is why this exists. `lead/v1/details` does
 * NOT carry the selected calculator — a device trace on a real
 * `agreement-signed` tap logged `calculatorId=NONE` from it. The richer
 * `demo/v1/leads/sales-portal/{id}` payload does, which is why
 * `LeadCenter.handleEditDeal` resolves it successfully from the lead IT holds.
 *
 * So: try the lead we already have, and fall back to the sales-portal read only
 * when that misses. The returned `lead` is whichever record actually answered, so
 * the screen gets the richer object when we had to fetch it.
 *
 * ⚠️ The sales-portal route 404s when the lead is not the caller's own (the server
 * matches `assignedRepId`/`assignedShadowRepId`), so a miss is an expected outcome
 * here, not an error.
 */
export async function resolveBuildIds(lead: any): Promise<{
  lead: any;
  calculatorId: string | null;
  appointmentId: string | null;
  source: string;
}> {
  const pick = (l: any) => ({
    calculatorId: resolveLeadCalculatorId(l),
    appointmentId:
      l?.selectedAppointmentId ||
      l?.jobBuilder?.appointmentId ||
      l?.outcome?.selectedAppointmentId ||
      l?.leadData?.selectedAppointmentId ||
      l?.appointmentId ||
      null,
  });

  const fromDetails = pick(lead);
  if (fromDetails.calculatorId) {
    return { lead, ...fromDetails, source: 'lead/v1/details' };
  }

  try {
    const res = await LeadService.getSalesPortalLeadById(lead?._id || lead?.id);
    const body: any = res?.data;
    const richer = body?.data?.lead || body?.data || body?.lead || body;
    const fromPortal = pick(richer);
    if (fromPortal.calculatorId) {
      return { lead: richer || lead, ...fromPortal, source: 'sales-portal' };
    }
  } catch (err) {
    console.warn('[Push] sales-portal lead lookup failed:', err);
  }

  return { lead, calculatorId: null, appointmentId: null, source: 'none' };
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

    /**
     * `agreement-signed` — the customer has signed, so the job can now be
     * submitted. Land the rep on the Job Builder Summary, one tap from
     * Complete Job.
     *
     * ⚠️ Navigates to `DynamicDealCenter`, NOT to the builder. The builder is a
     * STEP inside that screen and needs nine props it assembles from four hooks;
     * `openJobBuilder` makes it seed `flowStep` once that data has loaded.
     *
     * ⚠️ Falls back to Job Docs for a LEGACY lead or one with no resolvable
     * calculator — there is no dynamic builder to open, and an empty summary is
     * worse than the documents.
     */
    if (route.kind === 'jobBuilder') {
      const lead = await fetchLead(route.leadId);
      if (!lead) return;

      /**
       * ⚠️ A RESULTED lead goes to its own screen, NOT the Job Builder.
       *
       * The `isDynamic` branch below exists because signing the agreement is what
       * UNBLOCKS submitting the job, so the rep's next action is normally
       * "Complete Job". Once the lead is resulted that is no longer true — the
       * deal is on the Lead Center, which is where the agreement, the contract
       * details and the addendums all live — and dropping the rep into a builder
       * for a job that is already done reads as though the app has lost the
       * submission.
       *
       * ⚠️ Kept in step with the Notification Center row
       * (`screens/Notifications/index.tsx`), which runs the same check against the
       * same helper. A banner and the row it wrote must never land on different
       * screens.
       */
      if (isLeadResulted(lead)) {
        if (__DEV__) console.log('[Push] agreement-signed → lead already resulted → LeadCenter');
        // No `tab`, so the screen opens on its own default.
        navigationRef.navigate('LeadCenter', { lead });
        return;
      }

      /**
       * ⚠️ ONLY an EXPLICIT `isDynamic: "false"` diverts to the documents.
       *
       * This first shipped gated on `calculatorId && isDynamic` and fell through
       * to Job Docs every time — the device log read
       * `calculatorId=NONE isDynamic=false (push=undefined)`. Both halves were
       * wrong for the same underlying reason: at `agreement-signed` time the job
       * has NOT been submitted, so the lead record carries neither a selected
       * calculator nor a dynamic marker yet. Gating on the lead asks it for facts
       * it cannot have.
       */
      if (route.isDynamic === false) {
        if (__DEV__) console.log('[Push] agreement-signed → push says not dynamic → job_docs');
        navigationRef.navigate('LeadCenter', { lead, tab: 'job_docs' });
        return;
      }

      /**
       * ⚠️ The calculator id is REQUIRED, and an earlier version of this comment
       * claiming it was "a preference" was wrong.
       *
       * `DynamicJobBuilderScreen` loads the saved build with
       * `getLeadOutcomeByCalculator(leadId, calculatorResultData.calculatorId)`
       * (`DynamicJobBuilderScreen.tsx:230-235`). Without the id there is no outcome
       * GET, so the builder opens on step 1 with every field blank — and worse,
       * `useDynamicCalculators` then bootstraps a NEW appointment and an EMPTY
       * calculator, which is the "Avail 1ft" reading on a job that had real
       * measurements.
       */
      const ids = await resolveBuildIds(lead);
      if (__DEV__) {
        console.log(
          `[Push] agreement-signed → JobBuilder calculatorId=${ids.calculatorId ?? 'NONE'} ` +
            `appointmentId=${ids.appointmentId ?? 'NONE'} (via ${ids.source})`
        );
      }

      // No calculator anywhere means no saved build to open. Job Docs is the
      // honest destination — an empty Summary would look like data loss.
      if (!ids.calculatorId) {
        navigationRef.navigate('LeadCenter', { lead, tab: 'job_docs' });
        return;
      }

      navigationRef.navigate('DynamicDealCenter', {
        /**
         * ⚠️ The appointment id is MERGED ONTO THE LEAD, not just passed in
         * `calculatorResultData` — because that is the only field anything reads.
         * `useDynamicCalculators.resolveAppointmentId` checks `lead.appointmentId`
         * FIRST and otherwise falls back to matching appointments by lead date,
         * then to CREATING one. A created appointment brings a brand-new empty
         * calculator with it, which is what makes the allocation trackers read
         * "Avail 1ft" on a job that has real measurements.
         */
        lead: ids.appointmentId
          ? { ...ids.lead, appointmentId: ids.lead?.appointmentId || ids.appointmentId }
          : ids.lead,
        openJobBuilder: true,
        calculatorResultData: {
          calculatorId: ids.calculatorId,
          appointmentId: ids.appointmentId,
        },
      });
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
       *
       * ⚠️ `getLeadDetailsById` (`lead/v1/details/{id}`), NOT `getSalesDealById`
       * (`demo/v1/leads/sales/{id}`). A push carries only a lead id and the lead
       * may not be a sales deal at all — issued, cancelled, or one whose addendum
       * was just signed — so the sales-deal route is the wrong lookup here.
       */
      const lead = await fetchLead(route.leadId);
      if (!lead) return;
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
