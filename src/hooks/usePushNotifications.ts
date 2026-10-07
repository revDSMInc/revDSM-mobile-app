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

export function usePushNotifications(
  currentRouteName: string | null,
  openChatId: string | null
) {
  const routeRef = useRef(currentRouteName);
  const chatRef = useRef(openChatId);
  routeRef.current = currentRouteName;
  chatRef.current = openChatId;

  useEffect(() => {
    const np = getNativePush();
    if (!np) return undefined;

    let unsubscribe: (() => void) | undefined;
    try {
      const instance = np.messagingInstance;
      unsubscribe = np.messaging.onMessage(instance, async (message: any) => {
        const data = (message?.data || {}) as PushData;

        if (!isRenderable(data)) return;

        applyInvalidations(data);

        if (shouldSuppressForeground(data, routeRef.current, chatRef.current)) return;

        await np.notifee
          .displayNotification({
            title: message?.notification?.title || 'revDSM',
            body: message?.notification?.body || '',
            data: toNotifeeData(data),
            android: {
              channelId: channelForEvent(data),
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
      console.warn('[Push] onMessage subscribe failed:', err);
    }
    return () => unsubscribe?.();
  }, []);

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

function toNotifeeData(data: PushData): Record<string, string> {
  const out: Record<string, string> = {};
  Object.keys(data || {}).forEach((key) => {
    const value = data[key];
    if (typeof value === 'string') out[key] = value;
  });
  return out;
}

function applyInvalidations(data: PushData | undefined) {
  try {
    invalidationKeysFor(data).forEach((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
  } catch (err) {
    console.warn('[Push] invalidation failed:', err);
  }
}

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
  if (!route) return;

  applyInvalidations(data);

  if (!(await waitForNavigation())) return;

  try {
    if (route.kind === 'leadList') {
      navigationRef.navigate('Leads');
      return;
    }

    if (route.kind === 'jobBuilder') {
      const lead = await fetchLead(route.leadId);
      if (!lead) return;

      if (isLeadResulted(lead)) {
        if (__DEV__) console.log('[Push] agreement-signed → lead already resulted → LeadCenter');
        navigationRef.navigate('LeadCenter', { lead });
        return;
      }

      if (route.isDynamic === false) {
        if (__DEV__) console.log('[Push] agreement-signed → push says not dynamic → job_docs');
        navigationRef.navigate('LeadCenter', { lead, tab: 'job_docs' });
        return;
      }

      const ids = await resolveBuildIds(lead);
      if (__DEV__) {
        console.log(
          `[Push] agreement-signed → JobBuilder calculatorId=${ids.calculatorId ?? 'NONE'} ` +
            `appointmentId=${ids.appointmentId ?? 'NONE'} (via ${ids.source})`
        );
      }

      if (!ids.calculatorId) {
        navigationRef.navigate('LeadCenter', { lead, tab: 'job_docs' });
        return;
      }

      navigationRef.navigate('DynamicDealCenter', {
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
      const lead = await fetchLead(route.leadId);
      if (!lead) return;
      navigationRef.navigate('LeadCenter', { lead, tab: route.tab });
      return;
    }

    if (route.kind === 'chat') {
      navigationRef.navigate('ChatDetail', {
        chatId: route.chatId,
        leadId: route.leadId,
        customerName: '',
        chatType: route.chatType,
      });
    }
  } catch (err) {
    console.warn('[Push] navigation failed:', err);
  }
}

export default usePushNotifications;
