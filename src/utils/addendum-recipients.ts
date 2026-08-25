/**
 * Rules for the "PENDING ADDENDUM" card — who an outstanding addendum was sent to, and
 * what the rep may do about it from the Contract Details screen.
 *
 * Pure and RN-free on purpose, for the same reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` exist: the card that renders this pulls in React Native
 * and is untestable under jest here, so every rule that can be got wrong lives here.
 *
 * Four endpoints back the card, and they do NOT share a contract:
 *   GET   lead/v1/{leadId}/pending-addendums          the banner's own source of truth
 *   POST  lead/v1/job-builder-draft/{draftId}/resend  per draft, body `{ customerPhone, customerEmail? }`
 *   POST  lead/v1/job-builder-draft/{draftId}/cancel  per draft, NO body
 *   PATCH lead/v1/job-builder-draft/{draftId}/contact per draft, BOTH fields, E.164 phone
 */
import { validateEmail } from './validation';
import { toE164USPhone } from './phone-util';

/**
 * Bare 10 digits — strip all formatting, then strip a leading US `1`.
 *
 * ⚠️ TWO phone shapes are in play and they are not interchangeable. Do not consolidate:
 *   display  `(415) 987-6543`  `formatRecipientPhone`  — the mask, never sent
 *   wire     `4159876543`      `toPhoneDigits`         — BOTH the resend body and the
 *                                                        customer PATCH
 *
 * ⚠️ This is NOT `getRawPhoneNumber` (`14159876543`), which the Edit Customer modal
 * sends to the same customer endpoint. This card's contract is the bare ten.
 */
export const toPhoneDigits = (value: any): string => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits.length > 10 && digits.startsWith('1') ? digits.slice(1) : digits;
};

/**
 * Display form: `(415) 987-6543`. Takes the LAST ten digits, so a stored
 * `+14159876543` / `14159876543` / raw / already-formatted value all render the same.
 */
export const formatRecipientPhone = (raw: any): string => {
  const local = toPhoneDigits(raw).slice(-10);
  if (!local) return '';
  if (local.length <= 3) return `(${local}`;
  if (local.length <= 6) return `(${local.substring(0, 3)}) ${local.substring(3)}`;
  return `(${local.substring(0, 3)}) ${local.substring(3, 6)}-${local.substring(6)}`;
};

// ── GET lead/v1/{leadId}/pending-addendums ───────────────────────────────────

export interface PendingAddendum {
  draftId: string;
  createdAt: string;
}

export interface PendingAddendumsSnapshot {
  leadId: string;
  pendingCount: number;
  /** LEAD-LEVEL contact — one customer record, shared by every pending addendum. */
  customer: { phone: string; email: string };
  addendums: PendingAddendum[];
}

const EMPTY_SNAPSHOT: PendingAddendumsSnapshot = {
  leadId: '',
  pendingCount: 0,
  customer: { phone: '', email: '' },
  addendums: [],
};

/**
 * Normalize the pending-addendums payload (read as `response.data.data`), or the
 * identical snapshot the `pending-addendum` socket event pushes.
 *
 * ⚠️ An EMPTY `addendums` is a REAL state — the last one was signed or cancelled — and
 * must hide the banner. So this never falls back to "keep what we had"; a malformed or
 * absent payload yields the empty snapshot, which reads as "nothing pending".
 *
 * ⚠️ `pendingCount` is taken from the payload but FLOORED at the list length: the two
 * are separate fields and a stale count would otherwise print "2 addendums awaiting"
 * above a single row.
 */
export const normalizePendingAddendums = (source: any): PendingAddendumsSnapshot => {
  const data = source?.data?.data ?? source?.data ?? source;
  if (!data || typeof data !== 'object') return EMPTY_SNAPSHOT;

  const addendums: PendingAddendum[] = (Array.isArray(data.addendums) ? data.addendums : [])
    .map((a: any) => ({
      // This list is the ONLY source of draft ids — the lead payload carries a count
      // but no ids.
      draftId: String(a?.draftId || a?._id || a?.id || ''),
      createdAt: String(a?.createdAt || ''),
    }))
    // Every action is keyed by draftId, so an id-less row would render dead buttons.
    .filter((a: PendingAddendum) => Boolean(a.draftId));

  const rawCount = Number(data.pendingCount);
  return {
    leadId: String(data.leadId || ''),
    pendingCount: Number.isFinite(rawCount)
      ? Math.max(rawCount, addendums.length)
      : addendums.length,
    customer: {
      phone: String(data.customer?.phone || ''),
      email: String(data.customer?.email || ''),
    },
    addendums,
  };
};

export interface AddendumRecipientRow {
  draftId: string;
  /** 1-based position, matching the order the endpoint returns. */
  number: number;
  createdAt: string;
}

/** The rows the card renders. Contact is NOT per row — it is the shared customer. */
export const pendingRecipientRows = (
  snapshot: PendingAddendumsSnapshot | null | undefined
): AddendumRecipientRow[] =>
  (snapshot?.addendums || []).map((a, idx) => ({
    draftId: a.draftId,
    number: idx + 1,
    createdAt: a.createdAt,
  }));

/**
 * ⚠️ The socket event is COMPANY-WIDE (`company:{companyId}` room), so a snapshot for
 * another lead must be DISCARDED rather than replacing this lead's state.
 *
 * A snapshot carrying no `leadId` is rejected too: accepting it would let an
 * unattributed push blank the banner for whichever lead happens to be open.
 */
export const isSnapshotForLead = (
  snapshot: PendingAddendumsSnapshot | null | undefined,
  leadId: string
): boolean =>
  Boolean(leadId) && Boolean(snapshot?.leadId) && String(snapshot?.leadId) === String(leadId);

// ── POST .../resend ───────────────────────────────────────────────────────────

/**
 * Body for `POST /lead/v1/job-builder-draft/{draftId}/resend`. ONE call covers BOTH
 * channels — SMS and email go out together, so whichever address works gets through.
 *
 * ⚠️ `customerEmail` is OMITTED, not blanked, when there is no email. Omitting a field
 * keeps whatever the draft already holds, so sending `''` would overwrite a good stored
 * address with nothing.
 */
export const buildResendContact = (contact: {
  phone?: string;
  email?: string;
}): { customerPhone: string; customerEmail?: string } => {
  const customerPhone = toPhoneDigits(contact?.phone);
  const customerEmail = String(contact?.email || '').trim();
  return customerEmail ? { customerPhone, customerEmail } : { customerPhone };
};

export interface ResendResult {
  /** Every channel the server reported came back `sent`. */
  ok: boolean;
  /** Channels that did NOT report `sent`, e.g. `['email']`. */
  failed: string[];
  /** Channels that reported `sent`. */
  sent: string[];
}

/**
 * Read `{ notifications: { sms, email } }` off the resend response.
 *
 * ⚠️ Any value other than `'sent'` is a PARTIAL FAILURE and must be surfaced — the call
 * still resolves 2xx, so treating a 2xx as success would tell the rep the customer was
 * notified when the SMS bounced.
 *
 * A response with no `notifications` block is treated as OK: inventing a failure there
 * would be worse than silence.
 */
export const describeResendResult = (response: any): ResendResult => {
  const data = response?.data?.data || response?.data;
  const notifications = data?.notifications;
  if (!notifications || typeof notifications !== 'object') {
    return { ok: true, failed: [], sent: [] };
  }
  const sent: string[] = [];
  const failed: string[] = [];
  Object.keys(notifications).forEach((channel) => {
    if (String(notifications[channel]).toLowerCase() === 'sent') sent.push(channel);
    else failed.push(channel);
  });
  return { ok: failed.length === 0, failed, sent };
};

/** `sms` / `email` → the label the partial-failure flash shows. */
export const channelLabel = (channel: string): string => {
  const c = String(channel).toLowerCase();
  if (c === 'sms') return 'SMS';
  if (c === 'email') return 'email';
  return String(channel);
};

// ── PATCH lead/v1/job-builder-draft/{draftId}/contact ────────────────────────

/**
 * Body for `PATCH lead/v1/job-builder-draft/{draftId}/contact`.
 *
 * ⚠️ BOTH fields go every time, unlike the customer PATCH which sent only the edited
 * one. So the untouched channel is sent at its CURRENT value — passing only the edited
 * field would blank the other.
 *
 * ⚠️ E.164 for the phone (`+15551234567`), per the documented payload. That is a THIRD
 * shape on this screen; see `toPhoneDigits` for the other two.
 */
export const buildDraftContactPayload = (
  contact: { phone?: string; email?: string },
  patch?: { phone?: string; email?: string }
): { customerPhone: string; customerEmail: string } => ({
  customerPhone: toE164USPhone(patch?.phone ?? contact?.phone ?? ''),
  customerEmail: String(patch?.email ?? contact?.email ?? '').trim(),
});
/**
 * The customer's contact as stored on the LEAD — the seed for the deal-edit wizard's
 * "Send Addendum To" fields, which the rep may then override.
 *
 * ⚠️ FIXED candidate chains, never a guess — the same discipline as
 * the endpoint helpers. A lead reaches that screen from several sources (the sales
 * portal list, My Deals, an outcome record) and they do not all nest the customer the
 * same way, which is why reading `customerDetails.email` ALONE left the Email field
 * blank on leads that plainly had one.
 */
export const readLeadPhone = (lead: any): string =>
  String(
    lead?.customerDetails?.phone ||
      lead?.customerDetails?.phoneNumber ||
      lead?.customer?.phone ||
      lead?.phone ||
      ''
  ).trim();

export const readLeadEmail = (lead: any): string =>
  String(
    lead?.customerDetails?.email ||
      lead?.customerDetails?.emailAddress ||
      lead?.customer?.email ||
      lead?.email ||
      ''
  ).trim();

/**
 * The contact stored ON THE DRAFT itself — `customerPhone` / `customerEmail` at the
 * root of each row of `GET lead/v1/{leadId}/job-builder-drafts`.
 *
 * This is where a rep's OVERRIDE lands: the deal-edit wizard sends these two fields at
 * root level on the draft-create POST, so an addendum deliberately sent somewhere other
 * than the customer record carries that address here.
 */
export const readDraftContact = (draft: any): { phone: string; email: string } => ({
  phone: String(draft?.customerPhone || '').trim(),
  email: String(draft?.customerEmail || '').trim(),
});

/** Index the drafts list by every id spelling, for lookup by a row's `draftId`. */
export const indexDraftsById = (drafts: any[] | null | undefined): Record<string, any> => {
  const out: Record<string, any> = {};
  (Array.isArray(drafts) ? drafts : []).forEach((d) => {
    [d?.draftId, d?._id, d?.id].forEach((id) => {
      if (id) out[String(id)] = d;
    });
  });
  return out;
};

/**
 * What the card shows — and what a resend sends — for ONE addendum.
 *
 * ⚠️ The fallback is PER FIELD, not all-or-nothing. A draft can carry an overridden
 * phone and no email at all; taking the whole contact from one source would then blank
 * an email the customer record plainly has.
 *
 * Order, per field:
 *   1. `override` — a contact the rep just saved in this session (see below)
 *   2. the DRAFT's own `customerPhone`/`customerEmail` — where an override landed
 *   3. the customer block on the pending-addendums snapshot
 *   4. the lead's own customer details
 *
 * ⚠️ (1) exists because "Edit Phone"/"Edit Email" write to the CUSTOMER record, which
 * ranks BELOW the draft. Without the override, editing the contact of an addendum that
 * carries its own would appear to do nothing — and the next resend would still go to
 * the old address.
 */
export const resolveRowContact = (
  draft: any,
  snapshotCustomer: { phone?: string; email?: string } | null | undefined,
  lead: any,
  override?: { phone?: string; email?: string }
): { phone: string; email: string } => {
  const d = readDraftContact(draft);
  return {
    phone: override?.phone ?? (d.phone || String(snapshotCustomer?.phone || '') || readLeadPhone(lead)),
    email: override?.email ?? (d.email || String(snapshotCustomer?.email || '') || readLeadEmail(lead)),
  };
};

/**
 * Validation for the inline editor.
 *
 * ⚠️ An EMPTY value is VALID. A customer may have only one of the two on record, and
 * clearing a field is how an address is taken off. Only a PARTIAL value is rejected.
 */
export const recipientPhoneError = (value: string): string => {
  const digits = toPhoneDigits(value);
  if (!digits) return '';
  return digits.length === 10 ? '' : 'Enter a 10-digit number';
};

export const recipientEmailError = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return validateEmail(trimmed) ? '' : 'Enter a valid email address';
};

export const recipientEditError = (field: 'phone' | 'email', value: string): string =>
  field === 'phone' ? recipientPhoneError(value) : recipientEmailError(value);

/** The wire value for a field — bare digits for a phone, trimmed for an email. */
export const normalizeContactValue = (field: 'phone' | 'email', value: string): string =>
  field === 'phone' ? toPhoneDigits(value) : String(value || '').trim();

/**
 * The PATCH body for an edit, or `null` when nothing actually changed.
 *
 * ⚠️ ONE field per request — the dialog writes only the channel on screen. Sending the
 * Edit Customer modal's full shape from here would write back firstName / address /
 * coBuyers from a possibly stale copy of the lead.
 *
 * ⚠️ `null` for an unchanged value is what disables Save and sends nothing. Comparison
 * is on the NORMALIZED values, so re-typing `(415) 987-6543` over a stored
 * `4159876543` is correctly no change.
 */
export const resolveContactEditPatch = (
  field: 'phone' | 'email',
  value: string,
  original: string
): { phone?: string; email?: string } | null => {
  const next = normalizeContactValue(field, value);
  if (next === normalizeContactValue(field, original)) return null;
  return field === 'phone' ? { phone: next } : { email: next };
};

/**
 * Whether the card may paint yet.
 *
 * ⚠️ TWO sources feed one line of text and they land at different times:
 * `pending-addendums` resolves first but knows only the LEAD-level customer, while
 * the drafts list knows the address this addendum actually went to. Painting on the
 * first alone showed the customer contact for a beat and then swapped it — a visible
 * flicker, and on a deliberately overridden addendum the first value was WRONG.
 *
 * So: nothing renders until BOTH have settled. `draftsSettled` means resolved OR
 * failed — not "returned rows" — otherwise a lead with no drafts would hang forever.
 */
export const canRenderRecipientCard = (
  pendingLoading: boolean,
  draftsSettled: boolean,
  rowCount: number
): boolean => !pendingLoading && draftsSettled && rowCount > 0;

// ── action guards ─────────────────────────────────────────────────────────────

export type RecipientAction = 'ignore' | 'invalid' | 'send';

/**
 * Whether a tap on Resend may go through.
 *
 * ⚠️ The in-flight guard exists because `/resend` sends a real SMS/email — a double tap
 * means the homeowner is notified twice about one addendum.
 */
export const resolveResendAction = (
  row: { draftId?: string },
  busyDraftId: string | null
): RecipientAction => {
  if (!row?.draftId) return 'ignore';
  if (busyDraftId) return 'ignore';
  return 'send';
};

/** Whether a Cancel Request may go through. Same guards — it voids a real addendum. */
export const resolveCancelAction = (
  row: { draftId?: string },
  busyDraftId: string | null
): RecipientAction => resolveResendAction(row, busyDraftId);

/**
 * Whether an inline contact edit may be saved.
 *
 * ⚠️ The in-flight guard OUTRANKS validation, deliberately — the same ordering as
 * `resolveAddendumTap`. Reversing it would let a second tap slip a write through while
 * one is already running.
 *
 * An UNCHANGED value is `ignore`, not `invalid`: nothing is wrong with it, there is
 * simply nothing to send.
 */
export const resolveContactSaveAction = (
  draftId: string,
  field: 'phone' | 'email',
  value: string,
  original: string,
  busyDraftId: string | null
): RecipientAction => {
  // Every write is keyed by draft id, so without one there is nothing to PATCH.
  if (!draftId) return 'ignore';
  if (busyDraftId) return 'ignore';
  if (recipientEditError(field, value)) return 'invalid';
  if (!resolveContactEditPatch(field, value, original)) return 'ignore';
  return 'send';
};
