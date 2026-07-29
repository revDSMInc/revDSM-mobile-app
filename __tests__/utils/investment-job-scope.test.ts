import {
  buildInvestmentJobScope,
  stripScopeLine,
} from '../../src/screens/DynamicDealCenter/utils/investment-job-scope';

// The Investment Center "Includes the Following" list. Web/backend parity: the
// backend computes each calculator's job scope by running the agreement
// description-schema engine and stores it on `lfcalculator.descriptions`. Mobile
// must surface THAT array (footages/colors stripped) — the old bug was that it
// never hydrated `descriptions` and fell through to the product/category name
// ("Soffit"), so the on-screen list didn't match the response data.

describe('stripScopeLine', () => {
  test('drops footages (sq / ea / dash-separated) but keeps inch sizes', () => {
    expect(stripScopeLine('Install soffit — 12 sq')).toBe('Install soffit');
    expect(stripScopeLine('Remove 4 ea downspouts')).toBe('Remove downspouts');
    // Inch sizes denote product size, not footage → preserved.
    expect(stripScopeLine('Install J Channel every 12"')).toBe('Install J Channel every 12"');
  });

  test('collapses blank color/value substitutions', () => {
    expect(stripScopeLine('Paint fascia []')).toBe('Paint fascia');
    expect(stripScopeLine('Reseal (  ) joints')).toBe('Reseal joints');
  });

  test('leaves clean backend product descriptions unchanged', () => {
    expect(stripScopeLine('Install Soffit')).toBe('Install Soffit');
    expect(stripScopeLine('Installation: Install J Channel on structure every 12", cut and install soffit')).toBe(
      'Installation: Install J Channel on structure every 12", cut and install soffit',
    );
    expect(stripScopeLine('Gutter Tune-Up: Remove debris from gutter and downspouts to ground')).toBe(
      'Gutter Tune-Up: Remove debris from gutter and downspouts to ground',
    );
  });
});

describe('buildInvestmentJobScope — backend descriptions are authoritative', () => {
  const descriptions = [
    'Install Soffit',
    'Installation: Install J Channel on structure every 12", cut and install soffit',
    'Gutter Tune-Up: Remove debris from gutter and downspouts to ground',
  ];

  test('uses the calculator descriptions verbatim (footages stripped)', () => {
    const out = buildInvestmentJobScope({
      entries: {},
      calculatorSchemas: [],
      // Even with a job-builder config + schemas present, the backend descriptions win.
      jobBuilderConfig: { verticals: [] },
      descriptionSchemas: [{ primaryMappings: [] }],
      calculatorDescriptions: descriptions,
    });
    expect(out).toEqual(descriptions);
  });

  test('does not fall through to schema re-derivation when descriptions exist', () => {
    const out = buildInvestmentJobScope({
      entries: {},
      calculatorSchemas: [],
      jobBuilderConfig: { verticals: [] },
      descriptionSchemas: [{ descriptions: ['SHOULD NOT APPEAR'] }],
      calculatorDescriptions: ['Install Soffit'],
    });
    expect(out).toEqual(['Install Soffit']);
    expect(out).not.toContain('SHOULD NOT APPEAR');
  });

  test('ignores blank/non-string description entries', () => {
    const out = buildInvestmentJobScope({
      entries: {},
      calculatorSchemas: [],
      jobBuilderConfig: null,
      descriptionSchemas: [],
      calculatorDescriptions: ['Install Soffit', '', '  ', null as any, 42 as any],
    });
    expect(out).toEqual(['Install Soffit']);
  });

  test('returns [] when there are no descriptions and nothing configured', () => {
    const out = buildInvestmentJobScope({
      entries: {},
      calculatorSchemas: [],
      jobBuilderConfig: null,
      descriptionSchemas: [],
      calculatorDescriptions: undefined,
    });
    expect(out).toEqual([]);
  });
});
