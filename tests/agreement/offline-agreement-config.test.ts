import {
  agreementProductIds,
  descriptionSchemaMissingOffline,
} from '../../src/utils/offline-agreement-config';

describe('agreementProductIds', () => {
  it('uses productId, falls back to id, drops blanks and duplicates', () => {
    expect(
      agreementProductIds([{ productId: 'p1', id: 'v1' }, { id: 'v2' }, { productId: 'p1' }, { id: '' }, null, {}]),
    ).toEqual(['p1', 'v2']);
  });
  it('is empty for nothing', () => {
    expect(agreementProductIds(undefined)).toEqual([]);
    expect(agreementProductIds(null)).toEqual([]);
  });
});

describe('descriptionSchemaMissingOffline', () => {
  const base = { renderLocally: true, schemaLoading: false, schema: null, schemaError: new Error('x'), hasProvidedScope: false };
  it('is true for a local agreement whose schema fetch failed and nothing was cached', () => {
    expect(descriptionSchemaMissingOffline(base)).toBe(true);
  });
  it('is false while loading, once a schema exists, or when a scope was handed in', () => {
    expect(descriptionSchemaMissingOffline({ ...base, schemaLoading: true })).toBe(false);
    expect(descriptionSchemaMissingOffline({ ...base, schema: { primaryMappings: [] } })).toBe(false);
    expect(descriptionSchemaMissingOffline({ ...base, hasProvidedScope: true })).toBe(false);
  });
  it('is false when the product simply has no schema (the query succeeded with null)', () => {
    expect(descriptionSchemaMissingOffline({ ...base, schemaError: null })).toBe(false);
  });
  it('is false for a server-rendered agreement', () => {
    expect(descriptionSchemaMissingOffline({ ...base, renderLocally: false })).toBe(false);
  });
});
