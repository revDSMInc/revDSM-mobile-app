/**
 * `agreementSent` — the SMS / email delivery result the backend attaches to a signed
 * agreement, and how it is reported to the rep.
 *
 * Signing an agreement does TWO things server-side: it files the signed PDF as a
 * LeadOutcomeDocument, and it sends the customer a link to their copy. Only the first
 * was ever surfaced on mobile — the rep saw "Agreement signed successfully" whether the
 * customer received it or not. A real trace:
 *
 *   "agreementSent": {
 *     "sms":   { "to": "+1 (454) 684-8848", "status": "failed",
 *                "message": "Unable to create record: Invalid 'To' Phone Number: …" },
 *     "email": { "to": "…@gmail.com", "status": "sent",
 *                "message": "Signed agreement link sent to …@gmail.com" }
 *   }
 *
 * The rep needs the failure: the customer has no copy and the number on the lead is
 * wrong, both of which only they can fix, and both of which are invisible a minute later.
 *
 * ⚠️ There is NO web ref for this — `grep agreementSent` over the sales frontend is
 * empty, so web ignores the block entirely. This is written against the payload.
 *
 * Pure and RN-free, for the reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` exist: the only consumers pull in React Native and are
 * untestable under jest here, and "did it send" must not come to mean two different
 * things on the dynamic and legacy signing surfaces.
 */

export type AgreementDeliveryChannel = 'sms' | 'email';

export interface AgreementDeliveryResult {
  to?: string;
  status?: string;
  message?: string;
}

export interface AgreementSent {
  sms?: AgreementDeliveryResult;
  email?: AgreementDeliveryResult;
}

export interface AgreementDeliveryNotice {
  type: 'success' | 'warning';
  title: string;
  description: string;
  /** ms — a failure carries a provider reason and cannot be read in the 3.5 s default. */
  duration: number;
  sent: AgreementDeliveryChannel[];
  failed: AgreementDeliveryChannel[];
}

/**
 * Statuses that mean the provider ACCEPTED the message.
 *
 * `queued`/`accepted` are Twilio in-flight states, not failures — reporting them as
 * "not sent" would send a rep chasing a text that is about to arrive.
 */
const DELIVERED_STATUSES = new Set(['sent', 'delivered', 'queued', 'accepted', 'ok', 'success']);

const CHANNELS: AgreementDeliveryChannel[] = ['sms', 'email'];

/** How each channel is named to a rep — never "SMS channel" / "email provider". */
const NOUN: Record<AgreementDeliveryChannel, string> = { sms: 'SMS', email: 'email' };
const TAG: Record<AgreementDeliveryChannel, string> = { sms: 'SMS', email: 'Email' };

const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The `agreementSent` block out of whatever the API wrapped it in.
 *
 * Walks a FIXED list of roots rather than guessing a path — an unrecognised shape
 * yields `null` and the caller shows nothing, which is the right failure mode for
 * something whose whole job is to report on a send that already happened.
 *
 * ⚠️ It is a SIBLING of `outcome`, not a field on it (`data.data.agreementSent`
 * beside `data.data.outcome`), so `unwrapOutcome` in `outcome-documents.ts` cannot
 * reach it — that helper returns `body.data.outcome` and the block is left behind.
 */
export function readAgreementSent(response: any): AgreementSent | null {
  const roots = [
    response,
    response?.data,
    response?.data?.data,
    response?.outcome,
    response?.data?.outcome,
  ];
  for (const root of roots) {
    const sent = root?.agreementSent;
    if (sent && typeof sent === 'object') return sent as AgreementSent;
  }
  return null;
}

/** A channel counts as reported only when the backend said something about it. */
const isReported = (r?: AgreementDeliveryResult | null): boolean =>
  !!r && typeof r === 'object' && !!(str(r.to) || str(r.status) || str(r.message));

const isDelivered = (r?: AgreementDeliveryResult | null): boolean =>
  DELIVERED_STATUSES.has(str(r?.status).toLowerCase());

/**
 * Turn an `agreementSent` block into the ONE flash message the rep sees after signing.
 *
 * ⚠️ Deliberately ONE message, not two. `react-native-flash-message` shows a single
 * banner — a second `show()` replaces the first — so appending a delivery notice after
 * the modal's own "Agreement signed successfully" would wipe it ~300 ms in, which reads
 * as a flicker rather than as two facts. This notice therefore carries BOTH: the title
 * always states that the agreement was signed, then what happened to the send.
 *
 * ⚠️ Never `danger`, even when every channel failed. The agreement IS signed and filed;
 * a red banner at that moment reads as "the signature failed" and is worse than the
 * problem it reports.
 *
 * Returns `null` when the block is absent or names no channel — an older backend, or a
 * company with no delivery configured, must leave the existing success message alone
 * rather than gain an empty banner.
 */
export function describeAgreementDelivery(
  sent: AgreementSent | null | undefined
): AgreementDeliveryNotice | null {
  if (!sent || typeof sent !== 'object') return null;

  const reported = CHANNELS.filter((c) => isReported(sent[c]));
  if (!reported.length) return null;

  const ok = reported.filter((c) => isDelivered(sent[c]));
  const failed = reported.filter((c) => !isDelivered(sent[c]));

  // ⚠️ EVERY line is the server's OWN `message`, verbatim — that is the ticket ("the
  // above 2 messages should show in the flashmessage"), and it is also the only text
  // that names the reason a rep can act on ("Invalid 'To' Phone Number"). An earlier
  // pass synthesised the delivered line as "Emailed to <to>" and dropped the server's
  // "Signed agreement link sent to …" — do not reintroduce that.
  //
  // Each line is tagged with its channel, because a bare provider sentence does not say
  // whether it is talking about the text or the email.
  const line = (c: AgreementDeliveryChannel, isFailure: boolean) => {
    const r = sent[c] as AgreementDeliveryResult;
    const msg = str(r.message);
    const to = str(r.to);
    // The recipient is appended to the TAG for a failure only: the provider MASKS the
    // number inside its error (`684-XXXX`), so without it the rep cannot tell which
    // number was wrong — whereas a success message already names the recipient in full.
    const tag = isFailure && to ? `${TAG[c]} to ${to}` : TAG[c];
    const fallback = isFailure ? `Could not be delivered.` : `Sent${to ? ` to ${to}` : ''}.`;
    return `${tag} — ${msg || fallback}`;
  };

  // Failures first: the actionable half must not sit below the reassuring half.
  const description = [
    ...failed.map((c) => line(c, true)),
    ...ok.map((c) => line(c, false)),
  ].join('\n');

  if (!failed.length) {
    return {
      type: 'success',
      title: 'Agreement signed & sent',
      description,
      duration: 4000,
      sent: ok,
      failed,
    };
  }

  const title =
    failed.length === reported.length
      ? 'Agreement signed — not delivered'
      : `Agreement signed — ${NOUN[failed[0]]} not sent`;

  return {
    type: 'warning',
    title,
    description,
    duration: 7000,
    sent: ok,
    failed,
  };
}

/** Read a response and describe it in one step — what every call site actually wants. */
export function describeAgreementDeliveryFromResponse(
  response: any
): AgreementDeliveryNotice | null {
  return describeAgreementDelivery(readAgreementSent(response));
}
