/**
 * Transport-failure detection for rejections coming out of `services/api`.
 *
 * `normalizeApiError` attaches `httpStatus` whenever the server actually answered, so
 * its ABSENCE is the reliable signal that nothing came back at all — airplane mode,
 * dead wifi, DNS failure, a timeout. In that case axios' own untranslated message
 * ("Network Error", "timeout of 15000ms exceeded") is what lands in `message`, which is
 * not something to show a user; callers should substitute their own wording.
 */

const NETWORK_MESSAGE_RE = /network error|network request failed|timeout|timed out|aborted|econn|enotfound|unable to resolve host|socket/i;

const messageOf = (err: any): string =>
  (typeof err?.message === 'string' && err.message) || '';

/**
 * The HTTP status of a rejection, wherever it ended up.
 *
 * ⚠️ The trap this exists for, and it cost a real bug: **`normalizeApiError` rejects with a PLAIN
 * OBJECT built from the response body — it has no `.response` at all.** Every
 * `err.response?.status === 404` in this app is therefore permanently `undefined === 404`, i.e.
 * dead code that reads as a working check. In `ChatService.getChatByLeadId` that silently disabled
 * the create-on-404 fallback, so a lead with no thread showed an empty chat the rep could not use.
 *
 * ⚠️ `httpStatus`, never `status`. The chat 404's own body is
 * `{code: 404, message: "Chat not found for this lead", data: {}}` — spread onto the rejection, a
 * body's own `code`/`status` field would be read as the transport status. `httpStatus` is the one
 * key `normalizeApiError` reserves for the real thing, which is exactly why it picked that name.
 *
 * `.response?.status` is still read as a fallback, for a raw axios error that never passed through
 * the interceptor (a direct `axios.get`, or a third-party client).
 */
export const httpStatusOf = (err: any): number | undefined => {
  const status = err?.httpStatus ?? err?.response?.status;
  return typeof status === 'number' ? status : undefined;
};

/** Did the server answer with this exact status? */
export const isHttpStatus = (err: any, status: number): boolean => httpStatusOf(err) === status;

/** True when the request never got an HTTP response back. */
export const isNetworkError = (err: any): boolean => {
  if (err?.httpStatus !== undefined || err?.response?.status !== undefined) return false;
  const code = typeof err?.code === 'string' ? err.code : '';
  return (
    code === 'ECONNABORTED' ||
    code === 'ERR_NETWORK' ||
    code === 'ETIMEDOUT' ||
    NETWORK_MESSAGE_RE.test(messageOf(err))
  );
};

/** Narrower case of the above: the connection existed but ran out of time. */
export const isTimeoutError = (err: any): boolean =>
  err?.code === 'ECONNABORTED' ||
  err?.code === 'ETIMEDOUT' ||
  /timeout|timed out/i.test(messageOf(err));

/**
 * Should this failure be shown to the rep at all?
 *
 * ⚠️ The case this exists for: a red **"Funding — Network Error"** over the funding sheet while
 * the rep was completing a job at a door. The sheet works offline — the whole Result Lead flow is
 * device-side and queues — so the only thing that banner did was tell a rep mid-sale that the app
 * was broken, in axios' own untranslated wording.
 *
 * The rule, and it generalises past funding:
 *
 *   - a transport failure on a **read** is SILENT. Nothing was lost, the screen already holds what
 *     it needs, and `OfflineBanner` is already saying "you are offline" once, app-wide. A second,
 *     redder message saying the same thing in worse words only undermines a screen that is working.
 *   - a transport failure on a **write** is ANNOUNCED, because the rep believes something
 *     happened. It must name the action and say nothing was sent.
 *
 * ⚠️ Keyed off the ERROR, never off `isOnline()`. A request that dies in a tunnel is the same
 * event whatever the connectivity model believed when it was sent, and the absence of an HTTP
 * status is the honest signal — see `isNetworkError`.
 */
export const shouldAnnounceFailure = (err: any, isWrite: boolean): boolean =>
  !isNetworkError(err) || isWrite;
