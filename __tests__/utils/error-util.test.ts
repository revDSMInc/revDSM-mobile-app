import { parseApiError } from '../../src/utils/error-util';

describe('parseApiError', () => {
  test('returns 404 message for 404 status', () => {
    const error = { response: { status: 404 } };
    expect(parseApiError(error)).toContain('404');
  });

  test('returns 500 message for 500 status', () => {
    const error = { response: { status: 500 } };
    expect(parseApiError(error)).toContain('500');
  });

  test('returns 502 message for 502 status', () => {
    const error = { response: { status: 502 } };
    expect(parseApiError(error)).toContain('502');
  });

  test('returns generic server error for 5xx', () => {
    const error = { response: { status: 503 } };
    expect(parseApiError(error)).toContain('Server Error');
    expect(parseApiError(error)).toContain('503');
  });

  test('returns response data message when available', () => {
    const error = { response: { status: 400, data: { message: 'Bad Request' } } };
    expect(parseApiError(error)).toBe('Bad Request');
  });

  test('returns response data error when message missing', () => {
    const error = { response: { status: 400, data: { error: 'Validation failed' } } };
    expect(parseApiError(error)).toContain('Validation failed');
  });

  test('returns status code fallback for 4xx without data', () => {
    const error = { response: { status: 403 } };
    expect(parseApiError(error)).toContain('403');
  });

  test('returns network error for ERR_NETWORK code', () => {
    const error = { code: 'ERR_NETWORK' };
    expect(parseApiError(error)).toContain('Network Error');
  });

  test('returns network error for network error message', () => {
    const error = { message: 'network error occurred' };
    expect(parseApiError(error)).toContain('Network Error');
  });

  test('returns network error for connection disruption', () => {
    const error = { message: 'Connection lost' };
    expect(parseApiError(error)).toContain('Network Error');
  });

  test('returns network error when no response object', () => {
    const error = { message: 'Something broke' };
    expect(parseApiError(error)).toContain('Network Error');
  });

  test('returns network error for empty error with no response', () => {
    expect(parseApiError({})).toContain('Network Error');
  });

  test('returns custom message from response data for 4xx', () => {
    const error = { response: { status: 400, data: { message: 'Custom error' } } };
    expect(parseApiError(error)).toBe('Custom error');
  });
});
