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

export const isTimeoutError = (err: any): boolean =>
  err?.code === 'ECONNABORTED' ||
  err?.code === 'ETIMEDOUT' ||
  /timeout|timed out/i.test(messageOf(err));

export const shouldAnnounceFailure = (err: any, isWrite: boolean): boolean =>
  !isNetworkError(err) || isWrite;
