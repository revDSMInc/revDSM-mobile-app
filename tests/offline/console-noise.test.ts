import { isTransportNoise } from '../../src/utils/console-noise';

describe('isTransportNoise', () => {
  it('the reported errors are transport noise', () => {
    expect(isTransportNoise(['Failed to resolve secure URLs', { message: 'Network Error' }])).toBe(true);
    expect(isTransportNoise(['[Reports] S3 Resolve Error:', { message: 'Network Error' }])).toBe(true);
    expect(isTransportNoise(['x', new Error('timeout of 15000ms exceeded')])).toBe(true);
    expect(isTransportNoise(['y', { code: 'ECONNABORTED' }])).toBe(true);
    expect(isTransportNoise(['Network request failed'])).toBe(true);
  });
  it('a server answer is NOT noise, even if it mentions the network', () => {
    expect(isTransportNoise(['x', { httpStatus: 500, message: 'Network Error upstream' }])).toBe(false);
    expect(isTransportNoise(['x', { response: { status: 503 }, message: 'Network Error' }])).toBe(false);
  });
  it('ordinary errors and plain strings are untouched', () => {
    expect(isTransportNoise(['boom', new Error('Cannot read property x of undefined')])).toBe(false);
    expect(isTransportNoise(['just a message'])).toBe(false);
    expect(isTransportNoise([])).toBe(false);
  });
  it('a transport error next to a real error is kept loud', () => {
    expect(isTransportNoise([{ message: 'Network Error' }, new Error('real bug')])).toBe(false);
  });
});
