/**
 * Turning transport failures into something a rep can act on.
 *
 * ⚠️ WHY THIS EXISTS. `normalizeApiError` (services/api/index.ts) ALWAYS populates `.message`,
 * so the ~48 call sites written as
 *
 *     FlashMessage.error('Error', err?.message || 'Could not save the deal')
 *
 * can never reach their fallback: `||` only fires on an empty value, and there is never one. On
 * a timeout `.message` is axios's own `"timeout of 15000ms exceeded"`, so that is what the rep
 * saw - a millisecond count and a stack-trace register, on a phone showing two bars of LTE. The
 * client's words were "I don't want to see this stuff. It's lowers confidence in app".
 *
 * Scrubbing at the single `emit()` chokepoint in `config/message.ts` fixes every one of those
 * sites at once, including the ones nobody has found yet, and keeps working for sites added
 * later. Doing it here rather than there is what makes it testable: `config/message.ts` imports
 * react-native-flash-message and cannot load under jest (CLAUDE.md §6).
 *
 * ⚠️ This is a PRESENTATION rule, not an error-handling one. The error object is untouched, so
 * retry/queue decisions (`shouldAnnounceFailure`, `isNetworkError`, the upload policies) still
 * see the real transport failure. Only the words on the glass change.
 */

/**
 * Phrases that mean "the request never completed", in the wording the libraries actually emit.
 * Matched case-insensitively against the description.
 */
const TRANSPORT_PHRASES: readonly string[] = [
  'timeout of',            // axios: "timeout of 15000ms exceeded"
  'timeout exceeded',
  'exceeded',              // defensive: other axios timeout spellings
  'network error',         // axios on a dead socket
  'network request failed', // RN fetch
  'econnaborted',
  'econnreset',
  'econnrefused',
  'enotfound',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'socket hang up',
  'aborted',
  'failed to fetch',
  'request failed with status code', // axios's generic, never useful to a rep
  'unable to resolve host',
  'ssl',
  'tls',
  'certificate',
];

/**
 * Does this description describe a CONNECTION failure rather than something the server said?
 *
 * ⚠️ Deliberately matches on the message text, not on the error object. By the time a string
 * reaches `emit()` the object is long gone - the call site already reduced it to `err.message`.
 * That is exactly why this has to be a text rule.
 */
export const isTransportCopy = (text: string | null | undefined): boolean => {
  if (!text) return false;
  const t = String(text).toLowerCase();
  if (/\btimeout\b/.test(t)) return true;
  if (/\d+\s*ms\b/.test(t)) return true; // any raw millisecond count is machine wording
  return TRANSPORT_PHRASES.some((p) => t.includes(p));
};

/**
 * What a rep should read instead.
 *
 * ⚠️ Says what happened to THEIR WORK, not what happened to the socket. "Timed out" tells a rep
 * nothing they can act on; "still saved on this device" is the fact that decides whether they
 * keep going or start again. The connection strip already names the link state, so this line
 * does not repeat it.
 */
export const TRANSPORT_FALLBACK = "Couldn't reach the server. Your work is saved on this device.";

/**
 * The title that goes with it. "Error" (40 sites use exactly that) names a category, not a
 * problem - NN/g call out non-informative titles directly. "Connection" says which kind.
 */
export const TRANSPORT_TITLE = 'Connection';

export interface FlashCopy {
  title: string;
  description: string;
}

/**
 * Should a transport toast be SHOWN AT ALL?
 *
 * ⚠️ NO - never. The client's objection is the right one and it is not conditional: *"we already
 * showing the offline banner so why we need to show this? it looks to the user something bad on
 * the app"*. A red card announcing a connection problem is alarm without an action; nothing the
 * rep can do about the link is served by it, and their work is already queued either way.
 *
 * ⚠️ THIS WAS FIRST GATED ON THE STRIP BEING VISIBLE, AND THAT WAS WRONG TWICE over:
 *
 *  1. The strip lives in `MainHeader`, which NOT every screen renders - the Lead Center in the
 *     client's screenshot has its own header, so there was no strip to defer to and the toast
 *     came back.
 *  2. Even where the strip does render, it LAGS. A transport error needs
 *     `FAILURES_BEFORE_LEAVING_ONLINE` failures and `MIN_DWELL_MS` (5 s) before the status moves,
 *     and the toast fires on the FIRST failure - so the check ran while the state still said
 *     `online` and let it through anyway.
 *
 * Making the suppression unconditional removes both races. The connection is communicated by the
 * strip where it renders, and by each screen's own inline state (cached content, a disabled
 * button, a queued badge) everywhere else - all of it calmer and more specific than a red card.
 *
 * ⚠️ Scoped to TRANSPORT copy. A server's own rejection ("This deal has already been submitted")
 * is ALWAYS shown - it is a real answer the rep must act on, and nothing else on screen carries
 * it. Only the "we could not reach anyone" class is silent.
 *
 * ⚠️ This suppresses the TOAST, never the failure. The error still rejects, the queue still
 * holds the work, and the screen's own inline state still renders.
 */
export const shouldShowTransportToast = (copy: FlashCopy): boolean =>
  !isTransportCopy(copy.description) && !isTransportCopy(copy.title);

/**
 * Rewrite a flash message when its description is raw transport wording.
 *
 * Returns the input unchanged for everything else - a 400's "Valid lead id is required", a
 * server's own validation text, a success note. Those are real answers and the rep should see
 * them verbatim.
 *
 * ⚠️ The TITLE is only replaced when it carries no information of its own ("Error", "", or the
 * same transport junk). A caller that titled its toast "Could not upload photo" chose better
 * words than this module has, and overwriting them would lose the one bit of context the rep
 * needs - WHICH action failed.
 */
export const scrubTransportCopy = (copy: FlashCopy): FlashCopy => {
  const descriptionIsTransport = isTransportCopy(copy.description);
  const titleIsTransport = isTransportCopy(copy.title);

  if (!descriptionIsTransport && !titleIsTransport) return copy;

  const titleIsGeneric =
    !copy.title.trim() || /^(error|errors?|failed|failure|oops)$/i.test(copy.title.trim());

  return {
    title: titleIsTransport || titleIsGeneric ? TRANSPORT_TITLE : copy.title,
    description: descriptionIsTransport || !copy.description.trim()
      ? TRANSPORT_FALLBACK
      : copy.description,
  };
};
