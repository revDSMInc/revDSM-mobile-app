import { normalizePropertyResponse } from '../../src/utils/property-util';

describe('normalizePropertyResponse', () => {
  test('returns null for null/undefined', () => {
    expect(normalizePropertyResponse(null)).toBeNull();
    expect(normalizePropertyResponse(undefined)).toBeNull();
  });

  test('returns first element of an array', () => {
    const result = normalizePropertyResponse([{ id: 'prop-1', address: '123 Main' }]);
    expect(result).toEqual({ id: 'prop-1', address: '123 Main' });
  });

  test('returns data[0] when response has data array', () => {
    const result = normalizePropertyResponse({ data: [{ id: 'prop-1' }] });
    expect(result).toEqual({ id: 'prop-1' });
  });

  test('returns data object when data is non-array object', () => {
    const result = normalizePropertyResponse({ data: { id: 'prop-1' } });
    expect(result).toEqual({ id: 'prop-1' });
  });

  test('returns the object itself when no data wrapper', () => {
    const result = normalizePropertyResponse({ id: 'prop-1', address: '456 Oak' });
    expect(result).toEqual({ id: 'prop-1', address: '456 Oak' });
  });

  test('returns null for empty array', () => {
    expect(normalizePropertyResponse([])).toBeNull();
  });

  test('returns null for empty data array', () => {
    expect(normalizePropertyResponse({ data: [] })).toBeNull();
  });
});
