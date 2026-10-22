import { isNetworkError, isTimeoutError, httpStatusOf } from '../../src/utils/network-error';

/**
 * The activity-log queue keeps a log forever on a 'transport' failure and spends one of its five
 * attempts on a 'rejected' one. So every wording a dying CELLULAR socket can produce has to be
 * recognised here, or the log is deleted after five bad moments on 4G - the rollout-log loss that
 * never reproduced on Wi-Fi.
 */
const classify = (e: any) => (isNetworkError(e) ? 'transport' : 'rejected');

describe('isNetworkError: a request that never got an answer', () => {
  it.each([
    ['axios timeout', { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }],
    ['RN fetch drop', { message: 'Network Error' }],
    ['RN fetch failure', { message: 'Network request failed' }],
    ['okhttp reset', { message: 'Connection reset' }],
    ['okhttp reset by peer', { message: 'Connection reset by peer' }],
    ['closed by peer', { message: 'Connection closed by peer' }],
    ['refused', { message: 'Connection refused' }],
    ['h2 stream reset', { message: 'stream was reset: PROTOCOL_ERROR' }],
    ['broken pipe', { message: 'Broken pipe' }],
    ['truncated body', { message: 'unexpected end of stream' }],
    ['cellular abort', { message: 'Software caused connection abort' }],
    ['dns on cell', { message: 'No address associated with hostname' }],
    ['host unreachable', { message: 'Host is unreachable' }],
    ['net unreachable', { message: 'Network is unreachable' }],
    ['tls mid-handover', { message: 'SSL handshake aborted' }],
    ['tls generic', { message: 'TLS connection failure' }],
    ['code ERR_NETWORK', { code: 'ERR_NETWORK', message: '' }],
    ['code ETIMEDOUT', { code: 'ETIMEDOUT', message: '' }],
  ])('%s is transport, so the log is KEPT', (_label, err) => {
    expect(classify(err)).toBe('transport');
  });

  it.each([
    ['a real 400', { httpStatus: 400, message: 'Request failed with status code 400' }],
    ['a real 404', { httpStatus: 404, message: 'Not found' }],
    ['a real 422', { httpStatus: 422, message: 'Validation failed' }],
    ['a real 500', { httpStatus: 500, message: 'Internal Server Error' }],
    ['a raw axios 502', { response: { status: 502 }, message: 'Request failed with status code 502' }],
  ])('%s is a real answer: still rejected', (_label, err) => {
    expect(classify(err)).toBe('rejected');
  });

  it('a status always wins over the wording', () => {
    // the body of a 400 could itself say "socket"; the status is the truth
    expect(classify({ httpStatus: 400, message: 'socket' })).toBe('rejected');
    expect(httpStatusOf({ httpStatus: 400 })).toBe(400);
  });

  it('isTimeoutError stays narrow - it must not inherit the widened wording', () => {
    expect(isTimeoutError({ message: 'timeout of 15000ms exceeded' })).toBe(true);
    expect(isTimeoutError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTimeoutError({ message: 'Connection reset' })).toBe(false);
    expect(isTimeoutError({ message: 'SSL handshake aborted' })).toBe(false);
  });
});
