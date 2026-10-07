const NETWORK_MESSAGE_RE = /network error|network request failed|timeout|timed out|aborted|econn|enotfound|unable to resolve host|socket/i;

const messageOf = (err: any): string =>
  (typeof err?.message === 'string' && err.message) || '';

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
