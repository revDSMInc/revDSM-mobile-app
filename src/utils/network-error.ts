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
