/**
 * Every way a request can die WITHOUT the server answering.
 *
 * ⚠️ This list is the difference between a queued log kept and a queued log DELETED, so an
 * omission here is a lost log, not a cosmetic issue. The activity-log queue spends an attempt only
 * on a `'rejected'` classification; five of those drop the log (`MAX_LOG_ATTEMPTS`). A cellular
 * socket that dies mid-flight is the log UNDELIVERED and must come back `'transport'`.
 *
 * ⚠️ The cellular wordings below were the missing ones, and they are why rollout logs survived
 * a Wi-Fi sync and vanished on mobile data: `aborted` / `econn` / `timeout` already matched the
 * common cases, but okhttp and RN's cellular stack also report plain `connection reset`,
 * `connection closed`, `connection refused`, `stream was reset`, `broken pipe`, `unexpected end of
 * stream`, `software caused connection abort`, `no address associated with hostname`,
 * `host is unreachable`, `network is unreachable` and `handshake`/`ssl`/`tls` failures. None of
 * those carries an axios `code` on React Native, so without the wording there is nothing else to
 * recognise them by - they fell through to `'rejected'` and burned the log's five attempts.
 *
 * Wi-Fi essentially never produces them, which is the whole reason this only ever showed on 4G.
 */
const NETWORK_MESSAGE_RE =
  /network error|network request failed|timeout|timed out|aborted|abort|econn|enotfound|eai_again|ehostunreach|enetunreach|epipe|unable to resolve host|no address associated with hostname|host is unreachable|network is unreachable|socket|connection reset|connection closed|connection refused|connection failure|stream was reset|broken pipe|unexpected end of stream|software caused connection|handshake|ssl|tls|canceled|cancelled/i;

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
