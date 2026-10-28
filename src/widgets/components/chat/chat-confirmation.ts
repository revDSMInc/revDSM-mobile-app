/**
 * REVDSM-1313 "Require read confirmation": shared colours + helpers for the
 * amber (waiting) / green (confirmed) confirmation UI in channels. The bubble
 * header, the list badge and the under-bubble banner all use the same pair so
 * the states read as one story.
 */
export const ACK_AMBER = {
  light: { bg: '#FFF8E7', border: '#F3D79A', accent: '#B7791F' },
  dark: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', accent: '#FDB748' },
};

export const ACK_GREEN = {
  light: { bg: '#E9F7EE', border: '#BFE3CE', accent: '#218A4B' },
  dark: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.30)', accent: '#86EFAC' },
};

/** First name of the message's sender, for "Lance can see you confirmed." */
export const confirmationSenderFirstName = (message: any): string => {
  const name =
    message?.user?.name ||
    message?.senderDetails?.fullName ||
    message?.senderDetails?.firstName ||
    message?.senderName ||
    '';
  return String(name).trim().split(/\s+/)[0] || 'The sender';
};

/**
 * The time a user confirmed at ("6:02 PM").
 *
 * Takes either an `ackBy` ENTRY or a bare timestamp (string / number / Date), because the two
 * shapes reach the banner from different places - see `confirmationTimeLabel`.
 */
export const confirmationTimeOf = (entry: any): string => {
  const at =
    typeof entry === 'string' || typeof entry === 'number' || entry instanceof Date
      ? entry
      : entry?.ackedAt || entry?.createdAt || entry?.acknowledgedAt || null;
  if (!at) return '';
  try {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    const hours = d.getHours() % 12 || 12;
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  } catch {
    return '';
  }
};

/**
 * The "Confirmed - <time>" time for the VIEWER, whatever shape the message arrived in.
 *
 * ⚠️ `message.acknowledgedAt` is a RAW ISO STRING and was printed verbatim. Reported:
 * confirming showed "Confirmed - 5:10 PM", but leaving the channel and coming back showed
 * "Confirmed - 2026-10-28T11:58:48...". The two paths explain it exactly - the freshly
 * confirmed message has no `acknowledgedAt` yet, so it fell through to the formatted `ackBy`
 * entry; the reloaded one carries `acknowledgedAt` from the server and that won.
 *
 * ⚠️ Keep BOTH sources going through `confirmationTimeOf`. `acknowledgedAt` is the personal
 * flag from the messages API and `ackBy` is the fuller manager/creator payload; either can be
 * the only one present, so neither may be dropped - they just have to be formatted the same.
 */
export const confirmationTimeLabel = (message: any, currentUserId: string): string => {
  const me = String(currentUserId || '');
  const ackBy: any[] = Array.isArray(message?.ackBy) ? message.ackBy : [];
  return (
    confirmationTimeOf(message?.acknowledgedAt) ||
    confirmationTimeOf(ackBy.find((a) => String(a?.userId) === me))
  );
};

export type AckVisualState = 'pending' | 'confirmed';

/**
 * Which visual state the read-confirmation UI takes for the viewer, or null when
 * the message has nothing to confirm (unsent, waiting for approval, system cards)
 * or is the viewer's own post (that bubble only carries the header strip).
 * Mirrors the branches of the under-bubble banner so the bubble header and the
 * banner always agree.
 */
export const ackVisualState = (message: any, currentUserId: string): AckVisualState | null => {
  const messageId = String(message?._id || message?.id || '');
  if (!messageId || messageId.startsWith('temp_') || message?.pendingApproval) return null;

  const ackBy: any[] = Array.isArray(message?.ackBy) ? message.ackBy : [];
  const me = String(currentUserId || '');
  const senderId = String(message?.user?._id || message?.senderId || '');
  const isSender = !!me && senderId === me;
  // Personal flag from the messages API, with the fuller `ackBy` as fallback.
  const confirmedByMe = !!me && (message?.acknowledgedByMe === true || ackBy.some((a) => String(a?.userId) === me));

  if (!isSender) return confirmedByMe ? 'confirmed' : 'pending';
  return 'confirmed';
};
