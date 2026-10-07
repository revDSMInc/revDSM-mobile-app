export type OfflineReason =
  | 'server-generated'
  | 'expired-link'
  | 'realtime'
  | 'server-record';

export interface OfflineNotice {
  reason: OfflineReason;
  title: string;
  message: string;
}

export const OFFLINE_FEATURES: Record<string, OfflineNotice> = {
  'risk-generate': {
    reason: 'server-generated',
    title: 'Needs a connection',
    message:
      'A risk report is built from weather history on the server, so it needs a connection. Your other tools still work.',
  },
  inspection: {
    reason: 'server-generated',
    title: 'Needs a connection',
    message: 'The inspection report is generated on the server, so it needs a connection.',
  },
  revrender: {
    reason: 'server-generated',
    title: 'Needs a connection',
    message:
      'revRender generates the image on the server, so it needs a connection. Renders you generated earlier are still here.',
  },

  'consent-download': EXPIRED_LINK(),
  'waiver-download': EXPIRED_LINK(),
  'inspection-preview': EXPIRED_LINK(),
  'inspection-download': EXPIRED_LINK(),
  'risk-preview': EXPIRED_LINK(),
  'risk-download': EXPIRED_LINK(),

  chat: {
    reason: 'realtime',
    title: 'Messages need a connection',
    message:
      'Ops chat is live, so it needs a connection. Nothing you send now would reach them — try again once you have signal.',
  },
  'chat-send': {
    reason: 'realtime',
    title: 'Messages need a connection',
    message: 'This message cannot be sent offline. It is not saved — send it again once you have signal.',
  },
  notifications: {
    reason: 'realtime',
    title: 'Notifications need a connection',
    message: 'New notifications arrive from the server. You will see them the moment you reconnect.',
  },

  referral: {
    reason: 'server-record',
    title: 'Needs a connection',
    message: 'A referral is filed on the server, so it needs a connection. Take their details and send it once you are back online.',
  },
  'job-tracker-write': {
    reason: 'server-record',
    title: 'Needs a connection',
    message: 'Job Tracker changes are saved on the server, so they need a connection.',
  },
  addendum: {
    reason: 'server-record',
    title: 'Needs a connection',
    message:
      'An addendum is raised on the server and texts the customer a signing link, so it needs a connection.',
  },
};

function EXPIRED_LINK(): OfflineNotice {
  return {
    reason: 'expired-link',
    title: 'Needs a connection',
    message:
      'This document is on file, but opening it needs a connection — its download link has expired.',
  };
}

export const offlineNoticeFor = (featureId: unknown): OfflineNotice | null => {
  const id = typeof featureId === 'string' ? featureId.trim() : '';
  return (id && OFFLINE_FEATURES[id]) || null;
};

export const isBlockedOffline = (featureId: unknown, online: boolean): boolean =>
  !online && !!offlineNoticeFor(featureId);

export const offlineBlockFor = (featureId: unknown, online: boolean): OfflineNotice | null =>
  online ? null : offlineNoticeFor(featureId);
